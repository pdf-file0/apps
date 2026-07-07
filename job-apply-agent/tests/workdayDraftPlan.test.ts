import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadAccountStatusFile } from '../src/accounts/accountStatus'
import { loadCvRoutingConfig, loadJobsConfig } from '../src/config/loadConfig'
import { buildDraftPlan } from '../src/draft/buildDraftPlan'
import { runDraftPreflight } from '../src/draft/preflight'
import type { DraftFlags } from '../src/draft/types'
import { evaluateDocumentReadiness } from '../src/documents/documentReadiness'
import { loadDocumentManifest } from '../src/documents/loadDocumentManifest'
import { buildApplicationPacket } from '../src/packets/buildApplicationPacket'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'
import { scanWorkdayPageFromHtml } from '../src/workday/WorkdayFieldScanner'
import { mapWorkdayFields } from '../src/workday/WorkdayFieldMapper'
import { evaluateWorkdayPageGuards } from '../src/workday/WorkdayPageGuards'

const root = fileURLToPath(new URL('..', import.meta.url))
const jobsConfig = loadJobsConfig(path.join(root, 'config/jobs.yaml'))
const cvRouting = loadCvRoutingConfig(path.join(root, 'config/cv_routing.yaml'))
const profile = loadProfile(path.join(root, 'tests/fixtures/candidate_profile.fixture.yaml'))
const answerBank = loadAnswerBank(path.join(root, 'tests/fixtures/answer_bank.fixture.yaml'))
const accountStatusFile = loadAccountStatusFile(
  path.join(root, 'tests/fixtures/account_status.fixture.yaml'),
)
const manifest = loadDocumentManifest(
  path.join(root, 'tests/fixtures/document_manifest.clean.fixture.yaml'),
)
const documentReadiness = evaluateDocumentReadiness({ manifest, profile, cvRouting })
const job = jobsConfig.jobs.find((j) => j.id === 'barclays_research_2027_sg')!
const packet = buildApplicationPacket({
  jobId: job.id,
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

function planFor(pageName: string, flags: Partial<DraftFlags>) {
  const mergedFlags: DraftFlags = { ...baseFlags, ...flags }
  const scan = scanWorkdayPageFromHtml(
    readFileSync(path.join(root, 'test-pages', pageName), 'utf8'),
    `fixture://${pageName}`,
  )
  const guard = evaluateWorkdayPageGuards(scan, { uploadRequested: mergedFlags.allowCvUpload })
  const preflight = runDraftPreflight({
    job,
    packet,
    profile,
    answerBank,
    accountStatusFile,
    documentReadiness,
    cvRouting,
    flags: mergedFlags,
  })
  const mappedFields = mapWorkdayFields({
    fields: scan.fields,
    packet,
    answerBank,
    company: job.company,
    jobId: job.id,
    bucket: packet.bucket,
  })
  return buildDraftPlan({
    job,
    packet,
    answerBank,
    documentReadiness,
    mappedFields,
    guard,
    preflight,
    flags: mergedFlags,
  })
}

describe('buildDraftPlan', () => {
  it('inspect-only (the default): zero planned actions, everything recorded', () => {
    const plan = planFor('workday-my-information.html', { inspectOnly: true })
    expect(plan.mode).toBe('inspect_only')
    expect(plan.plannedActions).toHaveLength(0)
    expect(plan.blockedActions.length).toBeGreaterThan(0)
    expect(plan.canSubmitFinal).toBe(false)
  })

  it('--fill-safe-fields plans safe fields only; unmapped and no-exact-option stay blocked', () => {
    const plan = planFor('workday-my-information.html', { fillSafeFields: true })
    const plannedKeys = plan.plannedActions.map((a) => a.normalizedKey)
    expect(plannedKeys).toEqual(
      expect.arrayContaining(['first_name', 'last_name', 'email', 'phone', 'address_line_1', 'postal_code', 'country']),
    )
    // "How did you hear about us?" is unmapped -> manual review, never planned
    expect(plan.manualReviewItems.map((a) => a.fieldId)).toContain('source')
    // "Phone Device Type" bound a value but has no exact option -> blocked
    const phoneType = plan.blockedActions.find((a) => a.fieldId === 'phoneType')!
    expect(phoneType.allowed).toBe(false)
    expect(phoneType.reason).toContain('EXACT option')
    expect(plan.plannedActions.every((a) => a.policy === 'safe_auto_fill')).toBe(true)
  })

  it('confirmed questions plan only with --fill-confirmed-fields on top of --fill-safe-fields', () => {
    const safeOnly = planFor('workday-application-questions.html', { fillSafeFields: true })
    expect(safeOnly.plannedActions.map((a) => a.normalizedKey)).not.toContain('legally_authorized_sg')
    const workAuthBlocked = safeOnly.blockedActions.find((a) => a.normalizedKey === 'legally_authorized_sg')!
    expect(workAuthBlocked.reason).toContain('--fill-confirmed-fields')

    const both = planFor('workday-application-questions.html', {
      fillSafeFields: true,
      fillConfirmedFields: true,
    })
    const workAuth = both.plannedActions.find((a) => a.normalizedKey === 'legally_authorized_sg')!
    expect(workAuth.type).toBe('select_option')
    expect(workAuth.exactOptionMatch).toBe('Yes')
    expect(workAuth.optionTargetKind).toBe('radio')
    expect(both.plannedActions.map((a) => a.normalizedKey)).toContain('requires_sponsorship')
  })

  it('open-ended draft answers never fill by default, and review-gated answers never fill at all', () => {
    const plan = planFor('workday-application-questions.html', {
      fillSafeFields: true,
      fillConfirmedFields: true,
    })
    const essay = plan.manualReviewItems.find((a) => a.normalizedKey === 'open_ended_question')!
    expect(essay.allowed).toBe(false)
    expect(essay.suggestedAnswerId).toBe('why_barclays_research')

    // Even with the explicit flag: every fixture answer is a review-gated
    // draft, so nothing may fill.
    const withFlag = planFor('workday-application-questions.html', {
      fillSafeFields: true,
      fillDraftAnswers: true,
    })
    expect(withFlag.plannedActions.map((a) => a.normalizedKey)).not.toContain('open_ended_question')
    expect(withFlag.warnings.map((w) => w.code)).toContain('draft_answer_review_gated')
  })

  it('demographics stay blocked without the explicit flag; exact match required with it', () => {
    const noFlag = planFor('workday-application-questions.html', { fillSafeFields: true })
    const gender = noFlag.blockedActions.find((a) => a.normalizedKey === 'gender')!
    expect(gender.reason).toContain('--fill-demographics')

    const withFlag = planFor('workday-application-questions.html', {
      fillSafeFields: true,
      fillDemographics: true,
    })
    const planned = withFlag.plannedActions.find((a) => a.normalizedKey === 'gender')!
    expect(planned.exactOptionMatch).toBe('Prefer not to say')
  })

  it('records National Service and salary expectations as manual review', () => {
    const plan = planFor('workday-application-questions.html', {
      fillSafeFields: true,
      fillConfirmedFields: true,
    })
    const manualKeys = plan.manualReviewItems.map((a) => a.normalizedKey)
    expect(manualKeys).toContain('national_service')
    expect(manualKeys).toContain('salary_expectations')
    expect(plan.plannedActions.map((a) => a.normalizedKey)).not.toContain('national_service')
    expect(plan.plannedActions.map((a) => a.normalizedKey)).not.toContain('salary_expectations')
  })

  it('a guarded page (final review) yields no planned actions even with all fill flags', () => {
    const plan = planFor('workday-review-submit.html', {
      fillSafeFields: true,
      fillConfirmedFields: true,
    })
    expect(plan.guard.mutationAllowed).toBe(false)
    expect(plan.plannedActions).toHaveLength(0)
    // the certification checkbox is recorded as never_auto
    expect(plan.neverAutoItems.map((a) => a.fieldId)).toContain('certifyBox')
    expect(plan.canSubmitFinal).toBe(false)
    expect(plan.readiness.ready_for_final_submit).toBe(false)
  })

  it('upload action exists only behind the full upload chain', () => {
    // Fixture profile carries unresolved items -> documents blocked -> no upload.
    const plan = planFor('workday-resume-upload.html', {
      fillSafeFields: true,
      allowCvUpload: true,
    })
    expect(plan.preflight.canUploadCv).toBe(false)
    expect(plan.plannedActions.map((a) => a.type)).not.toContain('upload_cv')
    const blocked = plan.blockedActions.find((a) => a.fieldId === 'resumeFile')!
    expect(blocked.type).toBe('upload_cv')
    expect(blocked.allowed).toBe(false)
  })
})
