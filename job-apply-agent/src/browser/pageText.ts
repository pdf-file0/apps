import type { Page } from 'playwright-core'
import type { CtaCandidate, PageSignals } from './types'

/** Cap extracted text so run artifacts stay reasonably sized. */
export const MAX_EXTRACTED_TEXT_CHARS = 200_000
/** Cap the number of CTA candidates scanned per page. */
export const MAX_CTA_CANDIDATES = 100

export interface PageScan {
  title: string
  text: string
  signals: PageSignals
  ctas: CtaCandidate[]
}

// The scan runs inside the page as a STRING script, not a serialized
// function: bundlers (tsx/esbuild) inject helper calls like __name() into
// transpiled functions, which don't exist in the browser context and crash
// page.evaluate. A plain string is passed through untouched.
const SCAN_SCRIPT = `
(() => {
  const maxCtas = ${MAX_CTA_CANDIDATES};
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const nodes = Array.from(
    document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]')
  ).slice(0, maxCtas);
  const ctas = nodes.map((el, index) => {
    el.setAttribute('data-recon-cta-id', String(index));
    const text = el.innerText || el.value || el.getAttribute('aria-label') || '';
    return {
      id: String(index),
      tag: el.tagName.toLowerCase(),
      text: text.trim().replace(/\\s+/g, ' ').slice(0, 120),
      href: el.getAttribute('href'),
      visible: isVisible(el),
      enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true',
      ariaRole: el.getAttribute('role'),
    };
  });
  return {
    title: document.title,
    text: document.body ? document.body.innerText : '',
    signals: {
      passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
      fileInputCount: document.querySelectorAll('input[type="file"]').length,
      captchaDetected: document.querySelector(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, [data-sitekey]'
      ) !== null,
      formFieldCount: document.querySelectorAll('form input, form select, form textarea').length,
    },
    ctas,
  };
})()
`

/**
 * Extract the visible body innerText, page signals (password/file inputs,
 * captcha markers, form fields), and all clickable CTA candidates in one
 * DOM pass. Each candidate element is tagged with data-recon-cta-id so a
 * later safe click can target exactly the element that was scanned.
 */
export async function scanPage(page: Page): Promise<PageScan> {
  const raw = (await page.evaluate(SCAN_SCRIPT)) as PageScan
  return { ...raw, text: raw.text.slice(0, MAX_EXTRACTED_TEXT_CHARS) }
}
