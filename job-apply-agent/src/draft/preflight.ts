import { existsSync } from 'node:fs'
import { accountKeyFor, portalFromHint } from '../accounts/accountSetupPlan'
import type { AccountStatusFile } from '../accounts/types'
import { isBarclaysWorkdayJob } from '../workday/WorkdayDraftAdapter'
import type { DocumentReadiness } from '../documents/types'
import type { CvRoutingConfig, JobRecord, Warning } from '../intelligence/types'
import type { ApplicationPacket } from '../packets/types'
import { validateProfile } from '../profile/validateProfile'
import type { AnswerBank, CandidateProfile } from '../profile/types'
import type { DraftFlags, PreflightCheck, PreflightResult } from './types'

/** The one account status that unlocks any live mutation. */
export const VERIFIED_ACCOUNT_STATUS = 'login_verified_manually'

export interface PreflightInput {
  job: JobRecord
  packet: ApplicationPacket
  profile: CandidateProfile
  answerBank: AnswerBank
  accountStatusFile: AccountStatusFile
  documentReadiness: DocumentReadiness
  cvRouting: CvRoutingConfig
  flags: DraftFlags
  /** Injectable for tests; defaults to the real filesystem. */
  fileExists?: (p: string) => boolean
}

/**
 * Every gate the draft engine must clear BEFORE a browser opens. Fail-closed:
 * a capability is granted only when its full chain of requirements passed.
 * canSubmitFinal is the literal false — no input can change it.
 */
export function runDraftPreflight(input: PreflightInput): PreflightResult {
  const { job, packet, flags } = input
  const fileExists = input.fileExists ?? existsSync
  const blockers: Warning[] = []
  const warnings: Warning[] = []
  const checks: PreflightCheck[] = []
  const check = (id: string, ok: boolean, detail: string): boolean => {
    checks.push({ id, ok, detail })
    return ok
  }

  // --- Platform scope: Barclays Workday only ---------------------------------
  const portal = portalFromHint(job.platformHint)
  const workdayOk = check(
    'job_is_barclays_workday',
    isBarclaysWorkdayJob(job),
    `platform=${portal}, company=${job.company}`,
  )
  if (!workdayOk) {
    blockers.push({
      code: 'not_barclays_workday',
      message:
        `Job "${job.id}" (${job.company} via ${portal}) is out of scope: Phase 6 drafts ` +
        'Barclays Workday applications ONLY. All other platforms stay read-only.',
    })
  }

  // --- Packet / CV routing ----------------------------------------------------
  const cvRouted = check(
    'bucket_resolves_to_cv',
    packet.selectedCvKey !== null && packet.selectedCvPath !== null,
    `bucket=${packet.bucket}, cv=${packet.selectedCvKey ?? 'none'}`,
  )
  if (!cvRouted) {
    blockers.push({
      code: 'no_cv_routed',
      message: `Bucket "${packet.bucket}" resolves to no CV — manual review before any drafting.`,
    })
  }
  const routedCv = input.cvRouting.buckets[packet.bucket]?.cv ?? null
  const routeMatches = check(
    'cv_route_matches_bucket',
    routedCv === packet.selectedCvKey,
    `routing says ${routedCv ?? 'none'}, packet selected ${packet.selectedCvKey ?? 'none'}`,
  )
  if (!routeMatches) {
    blockers.push({
      code: 'cv_route_mismatch',
      message: 'Selected CV does not match the routing table for this bucket.',
    })
  }
  check(
    'packet_final_submit_false',
    packet.readiness.ready_for_final_submit === false,
    'packet.readiness.ready_for_final_submit is structurally false',
  )

  // --- Profile semantic validation --------------------------------------------
  const profileReport = validateProfile(input.profile)
  check('profile_validates', profileReport.ok, `${profileReport.warnings.length} warning(s)`)
  if (profileReport.blockingItems.length > 0) {
    warnings.push({
      code: 'profile_blocking_items',
      message: `Profile carries ${profileReport.blockingItems.length} blocking unresolved item(s) — CV upload stays blocked.`,
    })
  }

  // --- Account status -----------------------------------------------------------
  const accountKey = accountKeyFor(job.company, portal)
  const account = input.accountStatusFile.accounts[accountKey]
  const accountStatus = account?.status ?? 'missing'
  const accountVerified = check(
    'account_login_verified_manually',
    accountStatus === VERIFIED_ACCOUNT_STATUS,
    `account ${accountKey}: ${accountStatus}`,
  )

  // --- Document readiness ---------------------------------------------------------
  const docsClean = check(
    'document_readiness_clean',
    input.documentReadiness.ready_for_cv_upload,
    input.documentReadiness.ready_for_cv_upload
      ? 'no document blockers'
      : `${input.documentReadiness.blockers.length} document blocker(s)`,
  )
  if (!docsClean) {
    for (const blocker of input.documentReadiness.blockers) {
      warnings.push({ code: `document_${blocker.code}`, message: blocker.message })
    }
  }

  // --- Headed requirement for live runs --------------------------------------------
  const headedOk = check(
    'live_runs_headed',
    flags.provider !== 'live' || flags.headed,
    flags.provider === 'live' ? `headed=${flags.headed}` : 'fixture mode',
  )
  if (!headedOk) {
    blockers.push({
      code: 'headless_live_refused',
      message: 'Live drafting must run HEADED so a human watches every action.',
    })
  }

  // --- Flag dependency rules ---------------------------------------------------------
  if (flags.fillConfirmedFields && !flags.fillSafeFields) {
    blockers.push({
      code: 'confirmed_requires_safe',
      message: '--fill-confirmed-fields requires --fill-safe-fields.',
    })
  }
  const anyMutationRequested =
    flags.fillSafeFields || flags.fillConfirmedFields || flags.allowCvUpload
  if (anyMutationRequested && !accountVerified) {
    blockers.push({
      code: 'account_not_verified',
      message:
        `Fill/upload refused: account "${accountKey}" status is "${accountStatus}", not ` +
        `"${VERIFIED_ACCOUNT_STATUS}". Log in yourself, then record it: ` +
        `npm run accounts:record -- --account ${accountKey} --status ${VERIFIED_ACCOUNT_STATUS}`,
    })
  }

  // --- CV upload chain ------------------------------------------------------------------
  let cvFileOk = false
  if (flags.allowCvUpload) {
    if (!docsClean) {
      blockers.push({
        code: 'upload_blocked_documents',
        message:
          'CV upload refused: document readiness is BLOCKED. Fix the documents and re-run ' +
          'npm run documents:readiness until it is clean.',
      })
    }
    cvFileOk =
      packet.selectedCvPath !== null && fileExists(packet.selectedCvPath)
    check(
      'selected_cv_file_exists',
      cvFileOk,
      packet.selectedCvPath ?? 'no CV path',
    )
    if (!cvFileOk) {
      blockers.push({
        code: 'cv_file_missing',
        message: `CV upload refused: selected CV file not found at ${packet.selectedCvPath ?? '(none)'}.`,
      })
    }
  }

  // --- Capability grants (fail-closed) -------------------------------------------------
  const baseOk = workdayOk && headedOk
  const canInspect = baseOk // inspect-only may proceed with doc blockers and unverified accounts
  const fillChainOk =
    baseOk && cvRouted && routeMatches && accountVerified && !flags.inspectOnly
  const canFillSafeFields = flags.fillSafeFields && fillChainOk
  const canFillConfirmedFields = flags.fillConfirmedFields && flags.fillSafeFields && fillChainOk
  const canUploadCv = flags.allowCvUpload && fillChainOk && docsClean && cvFileOk

  const manualReviewRequired =
    packet.manualReviewRequired ||
    !docsClean ||
    input.documentReadiness.manualReviewItems.length > 0

  if (canInspect && !docsClean) {
    warnings.push({
      code: 'inspect_with_document_blockers',
      message: 'Inspect-only may proceed, but CV upload stays blocked until documents are fixed.',
    })
  }

  return {
    canInspect,
    canFillSafeFields,
    canFillConfirmedFields,
    canUploadCv,
    canSubmitFinal: false,
    accountKey,
    accountStatus,
    blockers,
    warnings,
    manualReviewRequired,
    checks,
  }
}
