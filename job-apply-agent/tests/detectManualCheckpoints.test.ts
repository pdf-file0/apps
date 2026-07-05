import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultAdapterRegistry } from '../src/adapters/AdapterRegistry'
import { detectEntryOptions } from '../src/flow/detectEntryOptions'
import { detectManualCheckpoints } from '../src/flow/detectManualCheckpoints'
import type { PageSnapshot } from '../src/flow/types'
import { parseHtmlPage } from '../src/providers/FixtureJobContentProvider'
import { detectExtendedPageState } from '../src/reconnaissance/detectPageState'

const snapshot = (file: string, url: string): PageSnapshot => {
  const html = readFileSync(fileURLToPath(new URL(`../test-pages/${file}`, import.meta.url)), 'utf8')
  return { ...parseHtmlPage(html, url), phase: 'post_click' }
}

const checkpointsFor = (snap: PageSnapshot, platform = 'unknown'): string[] => {
  const adapter = defaultAdapterRegistry.select({
    platform: platform as never,
    confidence: 'high',
    evidence: [],
    warnings: [],
  })
  return detectManualCheckpoints({
    snapshot: snap,
    pageState: detectExtendedPageState(snap).state,
    entryOptions: detectEntryOptions(snap),
    adapterSummary: adapter.buildAdapterSummary(snap),
    platform,
  })
}

describe('detectManualCheckpoints', () => {
  it('captcha fixture yields captcha_detected and a never_auto option', () => {
    const snap = snapshot('captcha-page.html', 'https://example.com/security-check')
    expect(detectExtendedPageState(snap).state).toBe('captcha')
    expect(checkpointsFor(snap)).toContain('captcha_detected')
    const captchaOption = detectEntryOptions(snap).find((o) => o.label === '(captcha challenge)')
    expect(captchaOption?.safety).toBe('never_auto')
  })

  it('final-submit fixture yields final_submit_detected and never_auto submit', () => {
    const snap = snapshot('final-submit-page.html', 'https://example.com/review')
    expect(detectExtendedPageState(snap).state).toBe('final_submit')
    expect(checkpointsFor(snap)).toContain('final_submit_detected')
    const submit = detectEntryOptions(snap).find((o) => o.kind === 'submit')
    expect(submit?.safety).toBe('never_auto')
  })

  it('login/register fixture yields account and login checkpoints', () => {
    const snap = snapshot('talnet-login-register.html', 'https://bankcampuscareers.tal.net/x')
    const checkpoints = checkpointsFor(snap, 'tal_net')
    expect(checkpoints).toEqual(
      expect.arrayContaining(['account_creation_required', 'login_required']),
    )
  })

  it('flags cv_upload_blocked_by_document_warnings from packet readiness', () => {
    const snap = snapshot('workday-start-application.html', 'https://x.myworkdayjobs.com/apply')
    const adapter = defaultAdapterRegistry.select({
      platform: 'workday',
      confidence: 'high',
      evidence: [],
      warnings: [],
    })
    const checkpoints = detectManualCheckpoints({
      snapshot: snap,
      pageState: 'application_entry_chooser',
      entryOptions: detectEntryOptions(snap),
      adapterSummary: adapter.buildAdapterSummary(snap),
      platform: 'workday',
      packet: {
        selectedCvKey: 'omers_public_equities',
        selectedCvHumanLabel: 'OMERS / public equities CV',
        readiness: { ready_for_dry_form_fill: true, ready_for_cv_upload: false, ready_for_final_submit: false },
        unresolvedBlockingItems: ['cv_email_mismatch'],
        manualReviewRequired: false,
      },
    })
    expect(checkpoints).toContain('cv_upload_blocked_by_document_warnings')
    expect(checkpoints).toContain('resume_upload_choice')
  })
})
