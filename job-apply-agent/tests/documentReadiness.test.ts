import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadCvRoutingConfig } from '../src/config/loadConfig'
import {
  assertCvUploadAllowed,
  DocumentGateError,
  evaluateDocumentReadiness,
} from '../src/documents/documentReadiness'
import type { DocumentManifest, PrivateMarketsStats } from '../src/documents/types'
import { loadProfile } from '../src/profile/loadProfile'
import type { CandidateProfile } from '../src/profile/types'

const root = fileURLToPath(new URL('..', import.meta.url))
const cvRouting = loadCvRoutingConfig(path.join(root, 'config/cv_routing.yaml'))
const fixtureProfile = loadProfile(path.join(root, 'tests/fixtures/candidate_profile.fixture.yaml'))

const EXPECTED_STATS: PrivateMarketsStats = {
  live_investment_deals: 2,
  direct_investments: 1,
  fund_investments: 1,
  series_h_investment_usd_millions: 100,
  series_h_round_size_usd_billions: 1,
  series_h_company_descriptor: 'example technology company',
}

/** A profile with every document-related issue resolved. */
function cleanProfile(): CandidateProfile {
  const profile: CandidateProfile = structuredClone(fixtureProfile)
  profile.unresolved_items = []
  for (const exp of profile.experiences) {
    if (/temasek/i.test(exp.id)) exp.end_date = '2026-07'
  }
  return profile
}

/** A manifest with every declared document in its corrected state. */
function cleanManifest(): DocumentManifest {
  return {
    expected_application_email: fixtureProfile.candidate.preferred_application_email,
    national_service_status: 'resolved',
    required_cv_keys: ['omers_public_equities', 'temasek_private_markets'],
    expected_private_markets_stats: { ...EXPECTED_STATS },
    documents: [
      {
        key: 'omers_public_equities',
        kind: 'cv',
        human_label: 'Public CV',
        path: 'documents/public.pdf',
        cv_bucket: 'public_equities_markets_research',
        email_shown: fixtureProfile.candidate.preferred_application_email,
        experiences_shown: [{ experience_id: 'temasek_innovation', end_date_shown: '2026-07' }],
      },
      {
        key: 'temasek_private_markets',
        kind: 'cv',
        human_label: 'Private CV',
        path: 'documents/private.pdf',
        cv_bucket: 'private_markets_ibd_deals',
        email_shown: fixtureProfile.candidate.preferred_application_email,
        experiences_shown: [{ experience_id: 'temasek_innovation', end_date_shown: '2026-07' }],
        private_markets_stats_shown: { ...EXPECTED_STATS },
      },
    ],
  }
}

const fileAlwaysExists = () => true

describe('document readiness gate', () => {
  let manifest: DocumentManifest
  let profile: CandidateProfile

  beforeEach(() => {
    manifest = cleanManifest()
    profile = cleanProfile()
  })

  it('everything resolved → CV upload allowed, final submit still false', () => {
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers).toEqual([])
    expect(readiness.ready_for_cv_upload).toBe(true)
    expect(readiness.ready_for_final_submit).toBe(false)
    expect(() => assertCvUploadAllowed(readiness)).not.toThrow()
  })

  it('CV email mismatch blocks upload', () => {
    manifest.documents[0]!.email_shown = 'alex.tan@business.example.edu'
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.ready_for_cv_upload).toBe(false)
    expect(readiness.blockers.map((b) => b.code)).toContain('cv_email_mismatch')
    expect(() => assertCvUploadAllowed(readiness)).toThrow(DocumentGateError)
  })

  it('Temasek end date still "Present" on a CV blocks upload', () => {
    manifest.documents[0]!.experiences_shown = [
      { experience_id: 'temasek_innovation', end_date_shown: 'Present' },
    ]
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('temasek_end_date_stale')
    expect(readiness.ready_for_cv_upload).toBe(false)
  })

  it('CV showing a different Temasek end date than the resolved profile blocks upload', () => {
    manifest.documents[0]!.experiences_shown = [
      { experience_id: 'temasek_innovation', end_date_shown: '2026-06' },
    ]
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('temasek_end_date_stale')
  })

  it('unresolved Temasek end month in the profile blocks upload even with clean CVs', () => {
    const staleProfile = cleanProfile()
    const temasek = staleProfile.experiences.find((exp) => /temasek/i.test(exp.id))!
    temasek.end_date = 'TBD'
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile: staleProfile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('temasek_end_month_unresolved')
    expect(readiness.ready_for_cv_upload).toBe(false)
  })

  it('private CV without corrections applied blocks upload', () => {
    manifest.documents[1]!.private_markets_stats_shown = null
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('private_cv_correction_needed')
  })

  it('private CV with wrong deal figures blocks upload and names the mismatch', () => {
    manifest.documents[1]!.private_markets_stats_shown = {
      ...EXPECTED_STATS,
      live_investment_deals: 5,
    }
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    const blocker = readiness.blockers.find((b) => b.code === 'private_cv_correction_needed')
    expect(blocker).toBeDefined()
    expect(blocker!.message).toContain('live_investment_deals')
  })

  it('missing expected stats for a private CV blocks upload (cannot verify)', () => {
    delete manifest.expected_private_markets_stats
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('private_cv_expected_stats_missing')
  })

  it('missing document file blocks upload', () => {
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: (p) => p !== 'documents/private.pdf',
    })
    const blocker = readiness.blockers.find((b) => b.code === 'document_file_missing')
    expect(blocker?.documentKey).toBe('temasek_private_markets')
  })

  it('a routed CV missing from the manifest blocks upload', () => {
    manifest.required_cv_keys = ['omers_public_equities']
    manifest.documents = manifest.documents.filter((d) => d.key !== 'temasek_private_markets')
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('routed_cv_missing_from_manifest')
  })

  it('profile CV-blocking unresolved items block upload (Phase 3 parity)', () => {
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile: fixtureProfile, // still carries temasek_end_date etc.
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.blockers.map((b) => b.code)).toContain('profile_unresolved_item')
    expect(readiness.ready_for_cv_upload).toBe(false)
  })

  it('unknown National Service status is manual-review, not an upload blocker', () => {
    manifest.national_service_status = 'unknown'
    const readiness = evaluateDocumentReadiness({
      manifest,
      profile,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.manualReviewItems.map((i) => i.code)).toContain('national_service_status_unknown')
    expect(readiness.ready_for_cv_upload).toBe(true)
    expect(readiness.manualReviewItems[0]!.message).toContain('PAUSE')
  })

  it('no profile → warns and stays conservative on profile-based checks', () => {
    const readiness = evaluateDocumentReadiness({
      manifest,
      cvRouting,
      fileExists: fileAlwaysExists,
    })
    expect(readiness.warnings.join(' ')).toMatch(/No candidate profile provided/)
  })
})
