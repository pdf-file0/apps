import { existsSync } from 'node:fs'
import type { CvRoutingConfig } from '../intelligence/types'
import type { CandidateProfile } from '../profile/types'
import type {
  DocumentBlocker,
  DocumentCheckLine,
  DocumentCheckResult,
  DocumentEntry,
  DocumentManifest,
  DocumentValidationReport,
  PrivateMarketsStats,
} from './types'

const TEMASEK_ID_PATTERN = /temasek/i
const RESOLVED_MONTH_PATTERN = /^\d{4}-\d{2}$/

/**
 * Profile unresolved-item ids that block CV upload — the same set Phase 3's
 * packet readiness uses, so the two gates can never disagree.
 */
export const PROFILE_CV_BLOCKING_IDS: ReadonlySet<string> = new Set([
  'temasek_end_date',
  'cv_email_mismatch',
  'private_cv_temasek_corrections',
])

export interface ValidateDocumentsInput {
  manifest: DocumentManifest
  /** Optional: enables profile-based checks (Temasek end month, unresolved items). */
  profile?: CandidateProfile
  /** Optional: cross-checks that every routed CV exists in the manifest. */
  cvRouting?: CvRoutingConfig
  /** Injectable for tests; defaults to the real filesystem. */
  fileExists?: (path: string) => boolean
}

const normalizeDescriptor = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim()

function comparePrivateStats(
  expected: PrivateMarketsStats,
  shown: PrivateMarketsStats,
): string[] {
  const mismatches: string[] = []
  const numericFields = [
    'live_investment_deals',
    'direct_investments',
    'fund_investments',
    'series_h_investment_usd_millions',
    'series_h_round_size_usd_billions',
  ] as const
  for (const field of numericFields) {
    if (shown[field] !== expected[field]) {
      mismatches.push(`${field}: CV shows ${shown[field]}, expected ${expected[field]}`)
    }
  }
  if (
    normalizeDescriptor(shown.series_h_company_descriptor) !==
    normalizeDescriptor(expected.series_h_company_descriptor)
  ) {
    mismatches.push(
      `series_h_company_descriptor: CV shows "${shown.series_h_company_descriptor}", ` +
        `expected "${expected.series_h_company_descriptor}"`,
    )
  }
  return mismatches
}

/**
 * Compare the manifest's declared document contents against the source of
 * truth. Every failed check becomes either a blocker (CV upload stays
 * impossible) or a manual-review item (a human takes over if a portal asks).
 */
export function validateDocuments(input: ValidateDocumentsInput): DocumentValidationReport {
  const { manifest, profile, cvRouting } = input
  const fileExists = input.fileExists ?? existsSync
  const blockers: DocumentBlocker[] = []
  const manualReviewItems: DocumentBlocker[] = []
  const warnings: string[] = []
  const perDocument: DocumentCheckResult[] = []

  const expectedEmail = profile?.candidate.preferred_application_email ?? manifest.expected_application_email
  if (profile && profile.candidate.preferred_application_email !== manifest.expected_application_email) {
    warnings.push(
      `Manifest expected_application_email (${manifest.expected_application_email}) differs from the ` +
        `profile's preferred_application_email (${profile.candidate.preferred_application_email}) — ` +
        'using the profile value as the source of truth.',
    )
  }

  // --- Temasek end month resolution (profile-level) -------------------------
  const temasekExperiences = profile?.experiences.filter((exp) => TEMASEK_ID_PATTERN.test(exp.id)) ?? []
  const resolvedTemasekEnd =
    temasekExperiences.find((exp) => RESOLVED_MONTH_PATTERN.test(exp.end_date))?.end_date ?? null
  if (profile) {
    const unresolvedTemasek = temasekExperiences.find((exp) => !RESOLVED_MONTH_PATTERN.test(exp.end_date))
    if (unresolvedTemasek) {
      blockers.push({
        id: `temasek_end_month_unresolved:${unresolvedTemasek.id}`,
        code: 'temasek_end_month_unresolved',
        severity: 'blocks_cv_upload',
        documentKey: null,
        message:
          `Exact Temasek end month/year is unresolved: experience "${unresolvedTemasek.id}" has ` +
          `end_date "${unresolvedTemasek.end_date}".`,
        resolution:
          'Confirm the real end month/year and set end_date to "YYYY-MM" in ' +
          'profiles/candidate_profile.local.yaml (and clear the matching unresolved_items entry).',
      })
    }
  } else {
    warnings.push(
      'No candidate profile provided — profile-based checks (Temasek end month, unresolved items) were skipped.',
    )
  }

  // --- Per-document checks ---------------------------------------------------
  for (const doc of manifest.documents) {
    const checks: DocumentCheckLine[] = []
    checkFile(doc, fileExists, blockers, checks)
    if (doc.kind === 'cv') {
      checkEmail(doc, expectedEmail, blockers, checks)
      checkExperiencesShown(doc, profile, resolvedTemasekEnd, blockers, warnings, checks)
      if (doc.cv_bucket === 'private_markets_ibd_deals') {
        checkPrivateStats(doc, manifest.expected_private_markets_stats, blockers, checks)
      }
    }
    perDocument.push({ key: doc.key, kind: doc.kind, path: doc.path, checks })
  }

  // --- CV-routing cross-check: every routed CV must be declared --------------
  if (cvRouting) {
    const manifestKeys = new Set(manifest.documents.map((doc) => doc.key))
    for (const [bucket, route] of Object.entries(cvRouting.buckets)) {
      if (route?.cv && !manifestKeys.has(route.cv)) {
        blockers.push({
          id: `routed_cv_missing_from_manifest:${route.cv}`,
          code: 'routed_cv_missing_from_manifest',
          severity: 'blocks_cv_upload',
          documentKey: route.cv,
          message: `cv_routing routes bucket "${bucket}" to CV "${route.cv}", but the manifest declares no such document.`,
          resolution: `Add a document entry with key "${route.cv}" to the document manifest.`,
        })
      }
    }
  }

  // --- Profile unresolved items that block CVs (Phase 3 parity) --------------
  if (profile) {
    for (const item of profile.unresolved_items) {
      if (item.severity === 'blocking_before_final_upload' && PROFILE_CV_BLOCKING_IDS.has(item.id)) {
        blockers.push({
          id: `profile_unresolved_item:${item.id}`,
          code: 'profile_unresolved_item',
          severity: 'blocks_cv_upload',
          documentKey: null,
          message: `Profile unresolved item [${item.id}]: ${item.message}`,
          resolution:
            'Fix the underlying document/profile issue, then remove the entry from unresolved_items ' +
            'in profiles/candidate_profile.local.yaml.',
        })
      }
    }
  }

  // --- National Service status -------------------------------------------------
  const nsUnknownInProfile = profile?.unresolved_items.some(
    (item) => item.id === 'national_service_status',
  )
  if (manifest.national_service_status === 'unknown' || nsUnknownInProfile) {
    manualReviewItems.push({
      id: 'national_service_status_unknown',
      code: 'national_service_status_unknown',
      severity: 'manual_review_if_asked',
      documentKey: null,
      message:
        'National Service status is unknown — PAUSE and hand over to the human the moment any portal asks about it.',
      resolution:
        'Confirm the NS status, then set national_service_status: "resolved" in the manifest ' +
        '(and clear the profile unresolved item).',
    })
  }

  return { blockers, manualReviewItems, warnings, perDocument }
}

function checkFile(
  doc: DocumentEntry,
  fileExists: (path: string) => boolean,
  blockers: DocumentBlocker[],
  checks: DocumentCheckLine[],
): void {
  const exists = fileExists(doc.path)
  checks.push({
    check: 'file_exists',
    ok: exists,
    detail: exists ? doc.path : `not found: ${doc.path}`,
  })
  if (!exists) {
    blockers.push({
      id: `document_file_missing:${doc.key}`,
      code: 'document_file_missing',
      severity: 'blocks_cv_upload',
      documentKey: doc.key,
      message: `Document "${doc.key}" not found at ${doc.path}.`,
      resolution: 'Place the file at the declared path (documents/ is gitignored) or fix the manifest path.',
    })
  }
}

function checkEmail(
  doc: DocumentEntry,
  expectedEmail: string,
  blockers: DocumentBlocker[],
  checks: DocumentCheckLine[],
): void {
  if (!doc.email_shown) return // schema guarantees presence for CVs; guard for other kinds
  const ok = doc.email_shown === expectedEmail
  checks.push({
    check: 'email_matches_application_email',
    ok,
    detail: ok ? doc.email_shown : `CV shows ${doc.email_shown}, expected ${expectedEmail}`,
  })
  if (!ok) {
    blockers.push({
      id: `cv_email_mismatch:${doc.key}`,
      code: 'cv_email_mismatch',
      severity: 'blocks_cv_upload',
      documentKey: doc.key,
      message: `CV "${doc.key}" shows ${doc.email_shown}, but the application email should be ${expectedEmail}.`,
      resolution:
        'Re-export the CV with the correct email, then update email_shown in the document manifest.',
    })
  }
}

function checkExperiencesShown(
  doc: DocumentEntry,
  profile: CandidateProfile | undefined,
  resolvedTemasekEnd: string | null,
  blockers: DocumentBlocker[],
  warnings: string[],
  checks: DocumentCheckLine[],
): void {
  for (const shown of doc.experiences_shown ?? []) {
    const isTemasek = TEMASEK_ID_PATTERN.test(shown.experience_id)
    if (isTemasek) {
      const stillOpenEnded = shown.end_date_shown === 'Present' || shown.end_date_shown === 'TBD'
      const mismatchesResolved =
        resolvedTemasekEnd !== null && shown.end_date_shown !== resolvedTemasekEnd
      const ok = !stillOpenEnded && !mismatchesResolved
      checks.push({
        check: `temasek_end_date (${shown.experience_id})`,
        ok,
        detail: ok
          ? shown.end_date_shown
          : stillOpenEnded
            ? `CV still shows "${shown.end_date_shown}" — the role has ended`
            : `CV shows "${shown.end_date_shown}", profile says "${resolvedTemasekEnd}"`,
      })
      if (!ok) {
        blockers.push({
          id: `temasek_end_date_stale:${doc.key}:${shown.experience_id}`,
          code: 'temasek_end_date_stale',
          severity: 'blocks_cv_upload',
          documentKey: doc.key,
          message: stillOpenEnded
            ? `CV "${doc.key}" still shows the Temasek experience ending "${shown.end_date_shown}" ` +
              '(e.g. "Jan 2026 – Present") — the role has ended.'
            : `CV "${doc.key}" shows the Temasek end date as "${shown.end_date_shown}", but the ` +
              `profile's confirmed end date is "${resolvedTemasekEnd}".`,
          resolution:
            'Update the CV with the confirmed end month/year, then update end_date_shown in the manifest.',
        })
      }
      continue
    }
    // Non-Temasek experiences: mismatch with a resolved profile date is a
    // warning, not a blocker.
    const profileExp = profile?.experiences.find((exp) => exp.id === shown.experience_id)
    if (
      profileExp &&
      RESOLVED_MONTH_PATTERN.test(profileExp.end_date) &&
      shown.end_date_shown !== profileExp.end_date
    ) {
      warnings.push(
        `Document "${doc.key}": experience "${shown.experience_id}" shows end date ` +
          `"${shown.end_date_shown}" but the profile says "${profileExp.end_date}".`,
      )
    }
  }
}

function checkPrivateStats(
  doc: DocumentEntry,
  expected: PrivateMarketsStats | undefined,
  blockers: DocumentBlocker[],
  checks: DocumentCheckLine[],
): void {
  if (!expected) {
    checks.push({
      check: 'private_markets_stats',
      ok: false,
      detail: 'expected_private_markets_stats missing from manifest — corrections cannot be verified',
    })
    blockers.push({
      id: `private_cv_expected_stats_missing:${doc.key}`,
      code: 'private_cv_expected_stats_missing',
      severity: 'blocks_cv_upload',
      documentKey: doc.key,
      message:
        `"${doc.key}" is a private-markets CV but the manifest declares no ` +
        'expected_private_markets_stats, so its corrections cannot be verified.',
      resolution:
        'Add expected_private_markets_stats (the corrected deal figures) to the local document manifest.',
    })
    return
  }
  const shown = doc.private_markets_stats_shown
  if (shown === null || shown === undefined) {
    checks.push({
      check: 'private_markets_stats',
      ok: false,
      detail: 'corrections not yet applied (private_markets_stats_shown is null)',
    })
    blockers.push({
      id: `private_cv_correction_needed:${doc.key}`,
      code: 'private_cv_correction_needed',
      severity: 'blocks_cv_upload',
      documentKey: doc.key,
      message: `Private-markets CV "${doc.key}" does not yet show the corrected deal statistics.`,
      resolution:
        'Correct the CV to the expected figures, then declare them under private_markets_stats_shown.',
    })
    return
  }
  const mismatches = comparePrivateStats(expected, shown)
  const ok = mismatches.length === 0
  checks.push({
    check: 'private_markets_stats',
    ok,
    detail: ok ? 'matches expected figures' : mismatches.join('; '),
  })
  if (!ok) {
    blockers.push({
      id: `private_cv_correction_needed:${doc.key}`,
      code: 'private_cv_correction_needed',
      severity: 'blocks_cv_upload',
      documentKey: doc.key,
      message: `Private-markets CV "${doc.key}" shows stale deal statistics: ${mismatches.join('; ')}.`,
      resolution:
        'Correct the CV to the expected figures, then update private_markets_stats_shown in the manifest.',
    })
  }
}
