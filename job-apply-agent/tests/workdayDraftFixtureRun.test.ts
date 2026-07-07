import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadAccountStatusFile } from '../src/accounts/accountStatus'
import type { AccountStatusFile } from '../src/accounts/types'
import { loadCvRoutingConfig, loadJobsConfig } from '../src/config/loadConfig'
import { buildDraftPlan } from '../src/draft/buildDraftPlan'
import { runDraftPreflight } from '../src/draft/preflight'
import type { DraftFlags } from '../src/draft/types'
import { writeDraftRun } from '../src/draft/writeDraftRun'
import { evaluateDocumentReadiness } from '../src/documents/documentReadiness'
import { loadDocumentManifest } from '../src/documents/loadDocumentManifest'
import { buildApplicationPacket } from '../src/packets/buildApplicationPacket'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'
import type { CandidateProfile } from '../src/profile/types'
import { scanWorkdayPageFromHtml } from '../src/workday/WorkdayFieldScanner'
import { mapWorkdayFields } from '../src/workday/WorkdayFieldMapper'
import { evaluateWorkdayPageGuards } from '../src/workday/WorkdayPageGuards'

const root = fileURLToPath(new URL('..', import.meta.url))
const jobsConfig = loadJobsConfig(path.join(root, 'config/jobs.yaml'))
const cvRouting = loadCvRoutingConfig(path.join(root, 'config/cv_routing.yaml'))
const profile = loadProfile(path.join(root, 'tests/fixtures/candidate_profile.fixture.yaml'))
const answerBank = loadAnswerBank(path.join(root, 'tests/fixtures/answer_bank.fixture.yaml'))
const accounts = loadAccountStatusFile(path.join(root, 'tests/fixtures/account_status.fixture.yaml'))
const manifest = loadDocumentManifest(
  path.join(root, 'tests/fixtures/document_manifest.clean.fixture.yaml'),
)
const blockedReadiness = evaluateDocumentReadiness({ manifest, profile, cvRouting })

const researchJob = jobsConfig.jobs.find((j) => j.id === 'barclays_research_2027_sg')!
const packet = buildApplicationPacket({
  jobId: researchJob.id,
  jobsConfig,
  cvRoutingConfig: cvRouting,
  profile,
  answerBank,
})

const baseFlags: DraftFlags = {
  provider: 'fixture',
  headed: true,
  inspectOnly: false,
  fillSafeFields: false,
  fillConfirmedFields: false,
  fillDraftAnswers: false,
  fillDemographics: false,
  allowCvUpload: false,
  clickApply: false,
}

function unverifiedAccounts(): AccountStatusFile {
  const clone: AccountStatusFile = structuredClone(accounts)
  clone.accounts['barclays_workday']!.status = 'created'
  return clone
}

function cleanProfile(): CandidateProfile {
  const clone: CandidateProfile = structuredClone(profile)
  clone.unresolved_items = []
  for (const exp of clone.experiences) {
    if (/temasek/i.test(exp.id)) exp.end_date = '2026-07'
  }
  return clone
}

const preflight = (over: {
  flags?: Partial<DraftFlags>
  accountsFile?: AccountStatusFile
  job?: typeof researchJob
  clean?: boolean
  fileExists?: (p: string) => boolean
}) => {
  const job = over.job ?? researchJob
  const useProfile = over.clean ? cleanProfile() : profile
  return runDraftPreflight({
    job,
    packet:
      job === researchJob
        ? packet
        : buildApplicationPacket({ jobId: job.id, jobsConfig, cvRoutingConfig: cvRouting, profile: useProfile, answerBank }),
    profile: useProfile,
    answerBank,
    accountStatusFile: over.accountsFile ?? accounts,
    documentReadiness: over.clean
      ? evaluateDocumentReadiness({ manifest, profile: cleanProfile(), cvRouting })
      : blockedReadiness,
    cvRouting,
    flags: { ...baseFlags, ...over.flags },
    ...(over.fileExists ? { fileExists: over.fileExists } : {}),
  })
}

describe('draft preflight', () => {
  it('allows inspect-only even with document blockers and an unverified account', () => {
    const result = preflight({
      flags: { inspectOnly: true },
      accountsFile: unverifiedAccounts(),
    })
    expect(result.canInspect).toBe(true)
    expect(result.canFillSafeFields).toBe(false)
    expect(result.canUploadCv).toBe(false)
    expect(result.manualReviewRequired).toBe(true)
  })

  it('refuses fill when the account is not login_verified_manually', () => {
    const result = preflight({
      flags: { fillSafeFields: true },
      accountsFile: unverifiedAccounts(),
    })
    expect(result.canFillSafeFields).toBe(false)
    expect(result.blockers.map((b) => b.code)).toContain('account_not_verified')
  })

  it('refuses CV upload while document readiness is blocked', () => {
    const result = preflight({
      flags: { fillSafeFields: true, allowCvUpload: true },
      fileExists: () => true,
    })
    expect(result.canUploadCv).toBe(false)
    expect(result.blockers.map((b) => b.code)).toContain('upload_blocked_documents')
  })

  it('allows CV upload only when documents are clean, the file exists, and the account is verified', () => {
    const denied = preflight({
      flags: { allowCvUpload: true },
      clean: true,
      fileExists: () => false,
    })
    expect(denied.canUploadCv).toBe(false)
    expect(denied.blockers.map((b) => b.code)).toContain('cv_file_missing')

    const granted = preflight({
      flags: { allowCvUpload: true },
      clean: true,
      fileExists: () => true,
    })
    expect(granted.canUploadCv).toBe(true)
  })

  it('refuses non-Workday jobs entirely', () => {
    const gic = jobsConfig.jobs.find((j) => j.id === 'gic_internship_programme')!
    const result = preflight({ job: gic, flags: { inspectOnly: true } })
    expect(result.canInspect).toBe(false)
    expect(result.blockers.map((b) => b.code)).toContain('not_barclays_workday')
  })

  it('refuses headless live runs', () => {
    const result = preflight({ flags: { provider: 'live', headed: false, inspectOnly: true } })
    expect(result.canInspect).toBe(false)
    expect(result.blockers.map((b) => b.code)).toContain('headless_live_refused')
  })

  it('canSubmitFinal is always false, in every configuration', () => {
    for (const result of [
      preflight({ flags: { inspectOnly: true } }),
      preflight({ flags: { fillSafeFields: true, fillConfirmedFields: true } }),
      preflight({ flags: { allowCvUpload: true }, clean: true, fileExists: () => true }),
    ]) {
      expect(result.canSubmitFinal).toBe(false)
    }
  })
})

describe('fixture draft run output', () => {
  const runDir = mkdtempSync(path.join(tmpdir(), 'draft-run-test-'))
  afterAll(() => rmSync(runDir, { recursive: true, force: true }))

  it('writes a full draft run whose redacted outputs contain no PII', () => {
    const flags: DraftFlags = { ...baseFlags, fillSafeFields: true }
    const scan = scanWorkdayPageFromHtml(
      readFileSync(path.join(root, 'test-pages', 'workday-my-information.html'), 'utf8'),
      'fixture://my-information',
    )
    const guard = evaluateWorkdayPageGuards(scan, { uploadRequested: false })
    const pre = preflight({ flags: { fillSafeFields: true } })
    expect(pre.canFillSafeFields).toBe(true) // fixture account is login_verified_manually
    const plan = buildDraftPlan({
      job: researchJob,
      packet,
      answerBank,
      documentReadiness: blockedReadiness,
      mappedFields: mapWorkdayFields({
        fields: scan.fields,
        packet,
        answerBank,
        company: researchJob.company,
        jobId: researchJob.id,
        bucket: packet.bucket,
      }),
      guard,
      preflight: pre,
      flags,
    })
    expect(plan.plannedActions.length).toBeGreaterThan(0)

    const paths = writeDraftRun({
      runDir,
      plan,
      scan,
      outcomes: [],
      flags,
      notes: ['fixture run'],
      screenshots: [],
      startedAt: '2026-07-07T00:00:00.000Z',
    })
    expect(existsSync(paths.summaryPath)).toBe(true)
    expect(existsSync(path.join(paths.jobDir, 'draft-plan.md'))).toBe(true)
    expect(existsSync(path.join(paths.jobDir, 'planned-actions.json'))).toBe(true)
    expect(existsSync(path.join(paths.jobDir, 'blocked-actions.json'))).toBe(true)
    expect(existsSync(path.join(paths.jobDir, 'manual-review-items.json'))).toBe(true)

    // Redacted outputs: no email, phone, or address PII anywhere.
    const piiStrings = ['alex.tan@example.edu', '+65 1234 5678', '1 Example Street', '000000']
    for (const file of [
      paths.redactedSummaryPath,
      path.join(paths.jobDir, 'draft-plan.redacted.json'),
      path.join(paths.jobDir, 'draft-plan.md'),
    ]) {
      const content = readFileSync(file, 'utf8')
      for (const pii of piiStrings) {
        expect(content, `${path.basename(file)} must not contain "${pii}"`).not.toContain(pii)
      }
    }

    // The redacted summary still records the invariant.
    const redacted = JSON.parse(readFileSync(paths.redactedSummaryPath, 'utf8'))
    expect(redacted.canSubmitFinal).toBe(false)
    expect(redacted.plan.readiness.ready_for_final_submit).toBe(false)
  })
})
