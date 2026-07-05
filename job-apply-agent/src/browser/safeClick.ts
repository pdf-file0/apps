import type { Page } from 'playwright-core'
import { scanPage } from './pageText'
import type { ClickOutcome, CtaCandidate, PageView } from './types'

/**
 * Click exactly one pre-scanned CTA element and observe what happens —
 * same-page navigation or a popup/new tab — within bounded timeouts.
 *
 * This is the ONLY interaction primitive in the Phase 2 browser layer.
 * There is deliberately no fill/type/upload/select capability anywhere in
 * src/browser. Callers must have already validated the CTA via
 * findApplyCta() and detectPageState(); this function stops immediately
 * after capturing the post-click page state.
 */
export interface ClickObservation extends ClickOutcome {
  /** The page now showing the post-click state (the popup if one opened). */
  postPage: Page | null
}

export async function clickCtaAndObserve(page: Page, cta: CtaCandidate): Promise<ClickObservation> {
  const context = page.context()
  const popupPromise = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null)

  try {
    await page.locator(`[data-recon-cta-id="${cta.id}"]`).first().click({ timeout: 10_000 })
  } catch (err) {
    return {
      clicked: false,
      openedNewTab: false,
      post: null,
      postPage: null,
      error: `click failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    }
  }

  // Give a popup a short window to appear; otherwise wait for the current
  // page to settle. Everything is bounded — a hung page must not hang recon.
  await page.waitForTimeout(1_500)
  const popup = await Promise.race([
    popupPromise,
    page.waitForTimeout(3_000).then(() => null),
  ])

  let postPage: Page = page
  let openedNewTab = false
  if (popup) {
    openedNewTab = true
    postPage = popup
  }
  await postPage.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {})
  await postPage.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})

  let post: PageView | null = null
  try {
    const scan = await scanPage(postPage)
    post = { url: postPage.url(), ...scan }
  } catch (err) {
    return {
      clicked: true,
      openedNewTab,
      post: null,
      postPage,
      error: `post-click scan failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
    }
  }
  return { clicked: true, openedNewTab, post, postPage }
}
