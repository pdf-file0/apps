import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WorkdayAdapter } from '../src/adapters/WorkdayAdapter'
import { TalNetAdapter } from '../src/adapters/TalNetAdapter'
import { OracleRecruitingAdapter } from '../src/adapters/OracleRecruitingAdapter'
import { ImpressAiAdapter } from '../src/adapters/ImpressAiAdapter'
import { detectEntryOptions } from '../src/flow/detectEntryOptions'
import type { EntryOption, PageSnapshot } from '../src/flow/types'
import { parseHtmlPage } from '../src/providers/FixtureJobContentProvider'
import { detectExtendedPageState } from '../src/reconnaissance/detectPageState'

const snapshot = (file: string, url: string, phase: PageSnapshot['phase'] = 'post_click'): PageSnapshot => {
  const html = readFileSync(fileURLToPath(new URL(`../test-pages/${file}`, import.meta.url)), 'utf8')
  return { ...parseHtmlPage(html, url), phase }
}

const byLabel = (options: EntryOption[], label: string): EntryOption | undefined =>
  options.find((o) => o.label.toLowerCase() === label.toLowerCase())

describe('detectEntryOptions — Workday start-application page', () => {
  const snap = snapshot('workday-start-application.html', 'https://barclays.wd3.myworkdayjobs.com/apply')
  const options = detectEntryOptions(snap)

  it('detects the application_entry_chooser state', () => {
    expect(detectExtendedPageState(snap).state).toBe('application_entry_chooser')
  })

  it('blocks every Workday entry option in Phase 4', () => {
    expect(byLabel(options, 'Autofill with Resume')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Autofill with Resume')?.kind).toBe('resume_autofill')
    expect(byLabel(options, 'Apply Manually')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Apply Manually')?.kind).toBe('apply_manually')
    expect(byLabel(options, 'Create Account')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Sign In')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Use My Last Application')?.safety).toBe('blocked_phase_4')
  })

  it('WorkdayAdapter reports resume/account/login checkpoints', () => {
    const checkpoints = new WorkdayAdapter().detectManualCheckpoints(snap)
    expect(checkpoints).toContain('account_creation_required')
    expect(checkpoints).toContain('login_required')
    expect(checkpoints).toContain('resume_upload_choice')
  })
})

describe('detectEntryOptions — TAL.net login/register page', () => {
  const snap = snapshot('talnet-login-register.html', 'https://bankcampuscareers.tal.net/candidate')
  const options = detectEntryOptions(snap)

  it('detects account creation state (register + password field)', () => {
    expect(detectExtendedPageState(snap).state).toBe('account_creation')
  })

  it('blocks Sign in and Register, and marks the password field never_auto', () => {
    expect(byLabel(options, 'Sign in')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Register')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Register')?.kind).toBe('register')
    expect(byLabel(options, '(password field)')?.safety).toBe('never_auto')
  })

  it('TalNetAdapter reports account/login/campus checkpoints', () => {
    const checkpoints = new TalNetAdapter().detectManualCheckpoints(snap)
    expect(checkpoints).toEqual(
      expect.arrayContaining(['account_creation_required', 'login_required', 'campus_profile_required']),
    )
  })
})

describe('detectEntryOptions — Oracle application entry page', () => {
  const snap = snapshot('oracle-application-entry.html', 'https://egsp.fa.us2.oraclecloud.com/hcmUI/CandidateExperience')
  const options = detectEntryOptions(snap)

  it('blocks account, sign-in, apply-manually, and resume options', () => {
    expect(byLabel(options, 'Sign In')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Create Account')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Apply Manually')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Upload Resume')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Upload Resume')?.kind).toBe('upload_resume')
  })

  it('OracleRecruitingAdapter reports account/login/resume checkpoints', () => {
    const checkpoints = new OracleRecruitingAdapter().detectManualCheckpoints(snap)
    expect(checkpoints).toEqual(
      expect.arrayContaining(['account_creation_required', 'login_required', 'resume_upload_choice']),
    )
  })
})

describe('detectEntryOptions — Impress.ai chatbot entry page', () => {
  const snap = snapshot('impress-ai-chatbot-entry.html', 'https://gic.impress.ai/candidate/start')
  const options = detectEntryOptions(snap)

  it('detects the chatbot state', () => {
    expect(detectExtendedPageState(snap).state).toBe('chatbot')
  })

  it('blocks starting or answering the chat', () => {
    expect(byLabel(options, 'Start')?.kind).toBe('chatbot_start')
    expect(byLabel(options, 'Start')?.safety).toBe('blocked_phase_4')
    expect(byLabel(options, 'Begin')?.safety).toBe('blocked_phase_4')
  })

  it('ImpressAiAdapter reports chatbot checkpoints', () => {
    const checkpoints = new ImpressAiAdapter().detectManualCheckpoints(snap)
    expect(checkpoints).toEqual(
      expect.arrayContaining(['chatbot_application_flow', 'user_input_required', 'resume_upload_possible']),
    )
  })
})

describe('detectEntryOptions — apply CTA safety by phase', () => {
  it('marks a safe apply CTA clickable only on the pre-click job page', () => {
    const pre = snapshot('barclays-job.html', 'https://search.jobs.barclays/job/x', 'pre_click')
    const applyPre = detectEntryOptions(pre).find((o) => o.kind === 'apply_cta' && o.safety === 'safe_apply_click_only')
    expect(applyPre?.label).toBe('Apply now')

    const post = snapshot('barclays-job.html', 'https://search.jobs.barclays/job/x', 'post_click')
    const applyPost = detectEntryOptions(post).filter((o) => o.kind === 'apply_cta')
    expect(applyPost.every((o) => o.safety === 'blocked_phase_4')).toBe(true)
  })
})
