import { describe, expect, it } from 'vitest'
import {
  accountKeyFor,
  buildAccountSetupPlan,
  NEVER_ACTIONS,
  portalFromHint,
} from '../src/accounts/accountSetupPlan'
import type { AccountStatusFile } from '../src/accounts/types'
import type { DocumentReadiness } from '../src/documents/types'
import type { JobRecord } from '../src/intelligence/types'

const workdayJob: JobRecord = {
  id: 'barclays_ib_2027_sg',
  url: 'https://search.jobs.barclays/job/example',
  company: 'Barclays',
  platformHint: 'Workday',
  fixture: 'tests/fixtures/barclays_ib.txt',
}

const statusFile: AccountStatusFile = {
  accounts: {
    barclays_workday: {
      company: 'Barclays',
      portal: 'workday',
      email: 'alex.tan@example.edu',
      entry_url: 'https://example.wd3.myworkdayjobs.com/entry',
      status: 'not_created',
      history: [],
    },
  },
}

const readyReadiness: DocumentReadiness = {
  ready_for_cv_upload: true,
  ready_for_final_submit: false,
  blockers: [],
  manualReviewItems: [],
  warnings: [],
  perDocument: [],
}

const blockedReadiness: DocumentReadiness = {
  ready_for_cv_upload: false,
  ready_for_final_submit: false,
  blockers: [
    {
      id: 'cv_email_mismatch:x',
      code: 'cv_email_mismatch',
      severity: 'blocks_cv_upload',
      documentKey: 'x',
      message: 'CV shows an old email.',
      resolution: 'Fix the CV.',
    },
  ],
  manualReviewItems: [
    {
      id: 'national_service_status_unknown',
      code: 'national_service_status_unknown',
      severity: 'manual_review_if_asked',
      documentKey: null,
      message: 'NS unknown.',
      resolution: 'Confirm NS status.',
    },
  ],
  warnings: [],
  perDocument: [],
}

describe('portal and account key derivation', () => {
  it('maps platform hints to portals', () => {
    expect(portalFromHint('Workday')).toBe('workday')
    expect(portalFromHint('Oracle Recruiting')).toBe('oracle_recruiting')
    expect(portalFromHint('Impress.ai')).toBe('impress_ai')
    expect(portalFromHint('TAL.net / campus careers')).toBe('talnet')
    expect(portalFromHint(undefined)).toBe('unknown')
  })

  it('derives account keys consistent with the profile portal_accounts convention', () => {
    expect(accountKeyFor('Barclays', 'workday')).toBe('barclays_workday')
    expect(accountKeyFor('Goldman Sachs', 'oracle_recruiting')).toBe('goldman_sachs_oracle_recruiting')
    expect(accountKeyFor('Bank of America', 'talnet')).toBe('bank_of_america_talnet')
  })
})

describe('buildAccountSetupPlan', () => {
  it('builds a human-first plan with the account entry URL as the checkpoint', () => {
    const plan = buildAccountSetupPlan({
      job: workdayJob,
      statusFile,
      documentReadiness: readyReadiness,
    })
    expect(plan.accountKey).toBe('barclays_workday')
    expect(plan.currentStatus).toBe('not_created')
    expect(plan.accountEmail).toBe('alex.tan@example.edu')
    expect(plan.checkpointUrl).toBe('https://example.wd3.myworkdayjobs.com/entry')
    expect(plan.checkpointSource).toBe('account_entry_url')
    expect(plan.humanSteps.join(' ')).toContain('Create the password yourself')
    expect(plan.neverActions).toEqual([...NEVER_ACTIONS])
  })

  it('falls back to the job URL and lets --url override everything', () => {
    const noAccount = buildAccountSetupPlan({ job: workdayJob, documentReadiness: readyReadiness })
    expect(noAccount.checkpointUrl).toBe(workdayJob.url)
    expect(noAccount.checkpointSource).toBe('job_url')

    const overridden = buildAccountSetupPlan({
      job: workdayJob,
      statusFile,
      overrideUrl: 'https://example.com/checkpoint',
      documentReadiness: readyReadiness,
    })
    expect(overridden.checkpointUrl).toBe('https://example.com/checkpoint')
    expect(overridden.checkpointSource).toBe('override')
  })

  it('agent actions are strictly observational — no click/fill/type/upload verbs', () => {
    const plan = buildAccountSetupPlan({ job: workdayJob, statusFile })
    for (const action of plan.agentActions) {
      expect(action).not.toMatch(/\bclick\b(?!ing)/i)
      expect(action).not.toMatch(/\bfill\b/i)
      expect(action).not.toMatch(/\btype\b/i)
      expect(action).not.toMatch(/\bupload\b/i)
      expect(action).not.toMatch(/\bsubmit\b/i)
    }
  })

  it('includes the NS pause step when NS is unresolved (and by default without readiness)', () => {
    const withBlocked = buildAccountSetupPlan({
      job: workdayJob,
      statusFile,
      documentReadiness: blockedReadiness,
    })
    expect(withBlocked.humanSteps.join(' ')).toContain('National Service')

    const withoutReadiness = buildAccountSetupPlan({ job: workdayJob, statusFile })
    expect(withoutReadiness.humanSteps.join(' ')).toContain('National Service')
  })

  it('omits the NS pause step when readiness says NS is resolved', () => {
    const plan = buildAccountSetupPlan({
      job: workdayJob,
      statusFile,
      documentReadiness: readyReadiness,
    })
    expect(plan.humanSteps.join(' ')).not.toContain('National Service')
  })

  it('carries document blockers into the plan and warns against CV upload', () => {
    const plan = buildAccountSetupPlan({
      job: workdayJob,
      statusFile,
      documentReadiness: blockedReadiness,
    })
    expect(plan.documentWarnings.join(' ')).toContain('cv_email_mismatch')
    expect(plan.humanSteps.join(' ')).toContain('Do NOT upload any CV')
  })

  it('treats missing readiness as blocked (conservative default)', () => {
    const plan = buildAccountSetupPlan({ job: workdayJob, statusFile })
    expect(plan.humanSteps.join(' ')).toContain('Do NOT upload any CV')
    expect(plan.documentWarnings.join(' ')).toContain('treat CV upload as blocked')
  })

  it('never-actions cover the full Phase 5 safety boundary', () => {
    const text = NEVER_ACTIONS.join(' ')
    for (const banned of ['password', 'OTP', 'cookie', 'upload', 'terms', 'captcha', 'Create Account', 'Sign In']) {
      expect(text).toContain(banned)
    }
  })
})
