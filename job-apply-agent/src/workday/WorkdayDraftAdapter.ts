import { readFileSync } from 'node:fs'
import type { Page } from 'playwright-core'
import { companyKey, portalFromHint } from '../accounts/accountSetupPlan'
import { BrowserSession } from '../browser/BrowserSession'
import { scanPage } from '../browser/pageText'
import { captureScreenshot } from '../browser/screenshots'
import { clickCtaAndObserve } from '../browser/safeClick'
import { ConfigError } from '../config/loadConfig'
import type { JobRecord } from '../intelligence/types'
import { findApplyCta, findCookieDeclineCta } from '../reconnaissance/findApplyCta'
import { scanWorkdayPage, scanWorkdayPageFromHtml } from './WorkdayFieldScanner'
import type { WorkdayPageScan } from './types'

/** Phase 6 is Barclays-Workday-only. Every other job/platform is refused. */
export function isBarclaysWorkdayJob(job: JobRecord): boolean {
  return portalFromHint(job.platformHint) === 'workday' && companyKey(job.company) === 'barclays'
}

export interface OpenCheckpointResult {
  finalUrl: string
  applyCtaClicked: boolean
  cookieBannerDeclined: boolean
  notes: string[]
}

export interface WorkdayDraftTarget {
  readonly kind: 'live' | 'fixture'
  /** Navigate to the checkpoint. Fixture targets just load their HTML. */
  openCheckpoint(url: string, options: { clickApply: boolean }): Promise<OpenCheckpointResult>
  scan(): Promise<WorkdayPageScan>
  screenshot(filePath: string): Promise<boolean>
  /** The live Playwright page for fill/upload executors; null for fixtures. */
  livePage(): Page | null
  close(): Promise<void>
}

/** Offline target: parses a local Workday-like HTML page. No browser. */
export class FixtureWorkdayTarget implements WorkdayDraftTarget {
  readonly kind = 'fixture'
  private url = 'fixture://workday'

  constructor(private readonly htmlPath: string) {}

  async openCheckpoint(url: string): Promise<OpenCheckpointResult> {
    this.url = url
    return {
      finalUrl: url,
      applyCtaClicked: false,
      cookieBannerDeclined: false,
      notes: [`fixture page: ${this.htmlPath}`],
    }
  }

  async scan(): Promise<WorkdayPageScan> {
    return scanWorkdayPageFromHtml(readFileSync(this.htmlPath, 'utf8'), this.url)
  }

  async screenshot(): Promise<boolean> {
    return false // no browser — screenshots recorded as absent, never fabricated
  }

  livePage(): Page | null {
    return null
  }

  async close(): Promise<void> {}
}

/**
 * Live target: one headed browser page. Navigation reuses the existing safe
 * primitives — decline-only cookie handling and the exact-label Apply-CTA
 * allowlist from Phase 2. Nothing else is ever clicked.
 */
export class LiveWorkdayTarget implements WorkdayDraftTarget {
  readonly kind = 'live'

  private constructor(
    private readonly session: BrowserSession,
    private page: Page,
  ) {}

  static async launch(profileDir = '.browser-profile'): Promise<LiveWorkdayTarget> {
    const session = await BrowserSession.launch({ headed: true, profileDir })
    return new LiveWorkdayTarget(session, await session.newPage())
  }

  async openCheckpoint(url: string, options: { clickApply: boolean }): Promise<OpenCheckpointResult> {
    const notes: string[] = []
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    } catch (err) {
      const detail = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
      throw new ConfigError(`Could not open checkpoint URL: ${detail}`)
    }

    let view = { url: this.page.url(), ...(await scanPage(this.page)) }
    let cookieBannerDeclined = false
    const declineCta = findCookieDeclineCta(view.ctas, view.text)
    if (declineCta) {
      const outcome = await clickCtaAndObserve(this.page, declineCta)
      cookieBannerDeclined = outcome.clicked
      notes.push(`cookie banner: declined non-essential ("${declineCta.text}")`)
      view = { url: this.page.url(), ...(await scanPage(this.page)) }
    }

    let applyCtaClicked = false
    if (options.clickApply) {
      const applyScan = findApplyCta(view.ctas)
      notes.push(...applyScan.warnings)
      if (applyScan.safeCta) {
        const outcome = await clickCtaAndObserve(this.page, applyScan.safeCta)
        applyCtaClicked = outcome.clicked
        if (outcome.postPage && outcome.postPage !== this.page) {
          this.page = outcome.postPage
        }
        notes.push(
          outcome.clicked
            ? `apply CTA clicked ("${applyScan.safeCta.text}"); stopped immediately after`
            : `apply CTA click failed: ${outcome.error ?? 'unknown'}`,
        )
      } else {
        notes.push('no safe apply CTA found — nothing was clicked')
      }
    }

    return { finalUrl: this.page.url(), applyCtaClicked, cookieBannerDeclined, notes }
  }

  async scan(): Promise<WorkdayPageScan> {
    return scanWorkdayPage(this.page)
  }

  async screenshot(filePath: string): Promise<boolean> {
    return captureScreenshot(this.page, filePath)
  }

  livePage(): Page | null {
    return this.page
  }

  async close(): Promise<void> {
    await this.session.close()
  }
}
