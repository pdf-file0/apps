import type { Page } from 'playwright-core'
import { BrowserSession } from '../browser/BrowserSession'
import { scanPage } from '../browser/pageText'
import { captureScreenshot } from '../browser/screenshots'
import { clickCtaAndObserve } from '../browser/safeClick'
import type {
  BrowserLaunchOptions,
  ClickOutcome,
  CtaCandidate,
  OpenResult,
  PageView,
} from '../browser/types'
import type { JobRecord } from '../intelligence/types'
import type { ReconJobTarget, ReconProvider } from './JobContentProvider'

class PlaywrightJobTarget implements ReconJobTarget {
  private activePage: Page
  private readonly openedPages: Page[]

  constructor(page: Page) {
    this.activePage = page
    this.openedPages = [page]
  }

  async open(url: string): Promise<OpenResult> {
    try {
      await this.activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await this.activePage.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
      return { ok: true, timedOut: false }
    } catch (err) {
      const message = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
      return { ok: false, timedOut: /timeout/i.test(message), error: message }
    }
  }

  async view(): Promise<PageView> {
    const scan = await scanPage(this.activePage)
    return { url: this.activePage.url(), ...scan }
  }

  async screenshot(filePath: string): Promise<boolean> {
    return captureScreenshot(this.activePage, filePath)
  }

  async clickCta(cta: CtaCandidate): Promise<ClickOutcome> {
    const { postPage, ...outcome } = await clickCtaAndObserve(this.activePage, cta)
    if (postPage && postPage !== this.activePage) {
      // A popup/new tab now shows the post-click state: screenshots and any
      // further observation must target it.
      this.openedPages.push(postPage)
      this.activePage = postPage
    }
    return outcome
  }

  async close(): Promise<void> {
    for (const page of this.openedPages) {
      await page.close().catch(() => {})
    }
  }
}

/**
 * Live browser provider. Launches one shared BrowserSession lazily (so
 * nothing browser-related happens unless a live target is actually created)
 * and opens one page per job.
 */
export class PlaywrightJobContentProvider implements ReconProvider {
  readonly name = 'live'
  private session: BrowserSession | null = null

  constructor(private readonly launchOptions: BrowserLaunchOptions) {}

  async createTarget(_job: JobRecord): Promise<ReconJobTarget> {
    if (!this.session) {
      this.session = await BrowserSession.launch(this.launchOptions)
    }
    return new PlaywrightJobTarget(await this.session.newPage())
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.close()
      this.session = null
    }
  }
}
