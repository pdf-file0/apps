import type { PageView } from '../browser/types'
import type { PageSnapshot, PageStateKind, PageStateResult } from '../flow/types'
import { normalizeLabel, SAFE_APPLY_LABELS } from './findApplyCta'

export interface PageState {
  captcha: boolean
  loginOrAccount: boolean
  applicationForm: boolean
  evidence: string[]
}

/**
 * Detect whether a page is a captcha wall, a login/account-creation page, or
 * an ATS application form — the states where reconnaissance must stop.
 *
 * Deliberately structural rather than text-based for login detection: job
 * detail pages routinely have "Sign in" links in the header, so mere text
 * mentions must NOT flag the page. Password fields, login-ish URLs/titles,
 * and file-upload inputs are the trusted signals.
 */
export function detectPageState(view: PageView): PageState {
  const evidence: string[] = []
  const url = view.url.toLowerCase()
  const title = view.title.toLowerCase()
  const text = view.text.toLowerCase()

  const captcha =
    view.signals.captchaDetected ||
    /recaptcha|hcaptcha|turnstile|are you a robot|prove you are human|verify you are human/.test(
      text,
    )
  if (captcha) evidence.push('captcha challenge detected')

  let loginOrAccount = false
  if (view.signals.passwordFieldCount > 0) {
    loginOrAccount = true
    evidence.push(`page has ${view.signals.passwordFieldCount} password field(s)`)
  }
  if (/(^|[/.])(login|signin|sign-in|register|createaccount|create-account)([/?#.]|$)/.test(url)) {
    loginOrAccount = true
    evidence.push('url looks like a login/registration page')
  }
  if (/\b(sign in|log in|create account|create an account|register)\b/.test(title)) {
    loginOrAccount = true
    evidence.push(`page title suggests login/account creation: "${view.title}"`)
  }

  let applicationForm = false
  if (view.signals.fileInputCount > 0) {
    applicationForm = true
    evidence.push(`page has ${view.signals.fileInputCount} file-upload input(s)`)
  }
  if (/upload (your )?(resume|resumé|cv)|attach (your )?(resume|resumé|cv)/.test(text)) {
    applicationForm = true
    evidence.push('page text asks for a resume/CV upload')
  }
  if (/\bmy information\b/.test(text) && view.signals.formFieldCount >= 3) {
    applicationForm = true
    evidence.push('page shows an ATS "My Information" form section')
  }

  return { captcha, loginOrAccount, applicationForm, evidence }
}

/**
 * Phase 4 extension: classify the page into one of the extended states used
 * by flow mapping. Checks run in danger order — a page that is a captcha or
 * final-submit screen must never be reported as something more benign.
 */
export function detectExtendedPageState(snapshot: PageSnapshot): PageStateResult {
  const text = snapshot.text.toLowerCase()
  const labels = snapshot.ctas.filter((c) => c.visible).map((c) => normalizeLabel(c.text))
  const has = (...wanted: string[]): boolean => labels.some((l) => wanted.includes(l))
  const basic = detectPageState(snapshot)
  const found = (state: PageStateKind, evidence: string[]): PageStateResult => ({ state, evidence })

  if (basic.captcha) return found('captcha', ['captcha challenge detected'])
  if (
    (has('submit', 'submit application', 'complete application') || has('certify')) &&
    /review your application|certify|declaration|information is true/.test(text)
  ) {
    return found('final_submit', ['submit control plus review/certification language'])
  }
  if (/terms and conditions|terms of use/.test(text) && has('accept', 'i agree', 'accept all')) {
    return found('terms', ['terms text with an accept control'])
  }
  if (basic.loginOrAccount) {
    if (/create account|create an account|register|sign up/.test(text) || has('create account', 'register', 'sign up')) {
      return found('account_creation', [...basic.evidence, 'account-creation wording present'])
    }
    return found('login', basic.evidence)
  }
  if (/chatbot|virtual assistant|impress\.ai/.test(text)) {
    return found('chatbot', ['chatbot/virtual-assistant wording'])
  }
  if (
    has('autofill with resume', 'apply manually', 'use my last application') ||
    /start your application/.test(text)
  ) {
    return found('application_entry_chooser', ['application entry options visible'])
  }
  if (snapshot.signals.fileInputCount > 0 || /upload (your )?(resume|resumé|cv)/.test(text)) {
    return found('resume_upload', ['file input or resume-upload wording'])
  }
  if (/\bmy information\b/.test(text) && snapshot.signals.formFieldCount >= 3) {
    return found('profile_form', ['ATS "My Information" form section'])
  }
  const hasSafeApply = snapshot.ctas.some(
    (c) => c.visible && c.enabled && SAFE_APPLY_LABELS.includes(normalizeLabel(c.text)),
  )
  if (snapshot.phase === 'pre_click' && hasSafeApply) {
    return found('job_landing_page', ['original job page with a safe apply CTA'])
  }
  if (snapshot.phase === 'post_click') {
    return found('external_apply_entry', ['post-apply page with no stronger signal'])
  }
  return found('unknown', [])
}
