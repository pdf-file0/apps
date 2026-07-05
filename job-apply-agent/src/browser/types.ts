/**
 * Shared browser-layer types. Both the live Playwright provider and the
 * offline fixture provider produce these shapes, so the reconnaissance
 * pipeline is identical (and testable) with or without a real browser.
 */

export interface CtaCandidate {
  id: string
  tag: string
  text: string
  href: string | null
  visible: boolean
  enabled: boolean
  ariaRole: string | null
}

export interface PageSignals {
  passwordFieldCount: number
  fileInputCount: number
  captchaDetected: boolean
  formFieldCount: number
}

export interface PageView {
  url: string
  title: string
  text: string
  signals: PageSignals
  ctas: CtaCandidate[]
}

export interface OpenResult {
  ok: boolean
  timedOut: boolean
  error?: string
}

export interface ClickOutcome {
  clicked: boolean
  openedNewTab: boolean
  post: PageView | null
  error?: string
}

export interface BrowserLaunchOptions {
  headed: boolean
  profileDir: string
  navigationTimeoutMs?: number
}
