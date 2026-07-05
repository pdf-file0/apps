import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright-core'

/**
 * Best-effort screenshot: never throws (screenshots must be captured even
 * when a page is in a broken state), returns whether the file was written.
 */
export async function captureScreenshot(page: Page, filePath: string): Promise<boolean> {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    await page.screenshot({ path: filePath, fullPage: false, timeout: 15_000 })
    return true
  } catch {
    return false
  }
}
