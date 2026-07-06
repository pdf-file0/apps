import { BrowserSession } from '../browser/BrowserSession'
import { scanPage } from '../browser/pageText'
import { ConfigError } from '../config/loadConfig'
import type { AccountSetupPlan, AccountSetupRunResult, PostLoginAssessment } from './types'

/**
 * Signals that a portal session is signed in, matched against lowercased page
 * text. Only the LABELS are ever stored or logged — never the page text.
 */
const SIGNED_IN_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(sign|log)[- ]?out\b/, 'sign-out control visible'],
  [/my applications|application status|my submissions|submitted applications/, 'applications area visible'],
  [/candidate home|candidate profile|my profile|my account|account settings/, 'candidate account area visible'],
  [/welcome back|signed in as|logged in as/, 'signed-in greeting visible'],
]

export function assessPostLoginSignals(pageText: string): PostLoginAssessment {
  const lower = pageText.toLowerCase()
  const evidence = SIGNED_IN_SIGNALS.filter(([pattern]) => pattern.test(lower)).map(
    ([, label]) => label,
  )
  return { signedInLikely: evidence.length > 0, evidence }
}

export interface RunAccountSetupOptions {
  plan: AccountSetupPlan
  /** Re-observe the page after the human confirms, to assess signed-in state. */
  capture: boolean
  /** Blocks until the human confirms in the terminal. Injectable for tests. */
  waitForHuman: (message: string) => Promise<void>
  log?: (message: string) => void
  /** Must be true (the default). Passing false throws — a human drives every step. */
  headed?: boolean
  profileDir?: string
}

/**
 * Open a headed browser at the portal checkpoint, then get out of the way.
 *
 * The agent's entire interaction surface here is: goto + read-only page scan.
 * There is deliberately NO click/fill/type/upload call in this module — the
 * human performs account creation, passwords, OTP, terms, and captchas in the
 * same window while the agent waits. Any session state the human creates
 * lives only in the local gitignored .browser-profile.
 */
export async function runAccountSetup(options: RunAccountSetupOptions): Promise<AccountSetupRunResult> {
  if (options.headed === false) {
    throw new ConfigError(
      'Account setup must run HEADED — a human performs every account action; headless setup is not allowed.',
    )
  }
  const log = options.log ?? (() => {})
  const session = await BrowserSession.launch({
    headed: true,
    profileDir: options.profileDir ?? '.browser-profile',
  })
  try {
    const page = await session.newPage()

    let opened = true
    let openError: string | null = null
    let observedTitle: string | null = null
    try {
      await page.goto(options.plan.checkpointUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    } catch (err) {
      opened = false
      openError = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
    }
    if (opened) {
      const scan = await scanPage(page).catch(() => null)
      observedTitle = scan?.title ?? null
    }

    log(
      opened
        ? 'Checkpoint page is open. Complete every account step YOURSELF in the browser window.'
        : `Could not open the checkpoint page (${openError}) — the browser window stays open for you anyway.`,
    )
    await options.waitForHuman(
      'Press Enter here when you have finished (or want to stop) — the browser will then close. ',
    )

    let postLogin: AccountSetupRunResult['postLogin'] = null
    if (options.capture) {
      const scan = await scanPage(page).catch(() => null)
      if (scan) {
        postLogin = { url: page.url(), title: scan.title, ...assessPostLoginSignals(scan.text) }
      } else {
        log('Post-login capture skipped: the tab the agent opened is no longer readable.')
      }
    }

    return {
      checkpointUrl: options.plan.checkpointUrl,
      opened,
      openError,
      observedTitle,
      postLogin,
    }
  } finally {
    await session.close()
  }
}
