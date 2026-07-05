import type { BrowserContext, Page } from 'playwright-core'
import type { BrowserLaunchOptions } from './types'

const SETUP_MESSAGE = [
  'Could not launch a browser for live reconnaissance.',
  'Phase 2 uses your locally installed browser via playwright-core (no browser downloads).',
  'Tried channels: chrome, msedge.',
  'Fix: install Google Chrome (https://www.google.com/chrome/) or Microsoft Edge, then re-run.',
  'Offline alternative: npm run recon -- --jobs config/jobs.yaml --provider fixture',
].join('\n')

/**
 * Owns browser launch/close and the persistent local profile.
 *
 * Uses a dedicated profile directory (.browser-profile/, gitignored) so the
 * run is isolated from the user's normal browser profile. No credentials,
 * cookies, or profile data are ever written into tracked repo files.
 */
export class BrowserSession {
  private constructor(
    private readonly context: BrowserContext,
    readonly channel: string,
  ) {}

  static async launch(options: BrowserLaunchOptions): Promise<BrowserSession> {
    let chromium: (typeof import('playwright-core'))['chromium']
    try {
      chromium = (await import('playwright-core')).chromium
    } catch {
      throw new Error(
        'playwright-core is not installed. Run "npm install" in job-apply-agent first.',
      )
    }

    const errors: string[] = []
    for (const channel of ['chrome', 'msedge']) {
      try {
        const context = await chromium.launchPersistentContext(options.profileDir, {
          channel,
          headless: !options.headed,
          viewport: { width: 1280, height: 900 },
          timeout: 30_000,
        })
        context.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? 45_000)
        context.setDefaultTimeout(15_000)
        return new BrowserSession(context, channel)
      } catch (err) {
        errors.push(`${channel}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
    }
    throw new Error(`${SETUP_MESSAGE}\nLaunch errors:\n  ${errors.join('\n  ')}`)
  }

  async newPage(): Promise<Page> {
    return this.context.newPage()
  }

  browserContext(): BrowserContext {
    return this.context
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => {})
  }
}
