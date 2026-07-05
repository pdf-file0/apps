import type { PageView } from '../browser/types'

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
