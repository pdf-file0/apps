import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ClickOutcome, CtaCandidate, OpenResult, PageSignals, PageView } from '../browser/types'
import type { JobRecord } from '../intelligence/types'
import type { ReconJobTarget, ReconProvider } from './JobContentProvider'

/**
 * Offline provider: parses local HTML test pages (or synthesizes a page from
 * the job's Phase-1 text fixture) with zero network and zero browser.
 * Clicking is SIMULATED: the "post-click page" is just the CTA's href as a
 * URL with no content, which is enough for URL-based platform detection.
 */

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

const stripToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()

const attrValue = (attrs: string, name: string): string | null => {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  if (!match) return null
  return match[2] ?? match[3] ?? ''
}

const hasBareAttr = (attrs: string, name: string): boolean =>
  new RegExp(`(^|\\s)${name}(\\s|=|$)`, 'i').test(attrs)

export function parseHtmlPage(html: string, url: string): PageView {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)

  const ctas: CtaCandidate[] = []
  let index = 0
  const pushCta = (tag: string, attrs: string, inner: string): void => {
    const style = attrValue(attrs, 'style') ?? ''
    ctas.push({
      id: String(index++),
      tag,
      text: stripToText(inner || attrValue(attrs, 'value') || attrValue(attrs, 'aria-label') || '')
        .slice(0, 120),
      href: attrValue(attrs, 'href'),
      visible: !hasBareAttr(attrs, 'hidden') && !/display\s*:\s*none/i.test(style),
      enabled: !hasBareAttr(attrs, 'disabled') && attrValue(attrs, 'aria-disabled') !== 'true',
      ariaRole: attrValue(attrs, 'role'),
    })
  }
  const elementRe = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null
  while ((match = elementRe.exec(html)) !== null) {
    pushCta(match[1]!.toLowerCase(), match[2] ?? '', match[3] ?? '')
  }
  const inputRe = /<input\b([^>]*)\/?>/gi
  while ((match = inputRe.exec(html)) !== null) {
    const attrs = match[1] ?? ''
    const type = (attrValue(attrs, 'type') ?? '').toLowerCase()
    if (type === 'submit' || type === 'button') pushCta('input', attrs, '')
  }

  const signals: PageSignals = {
    passwordFieldCount: (html.match(/<input[^>]*type\s*=\s*["']?password/gi) ?? []).length,
    fileInputCount: (html.match(/<input[^>]*type\s*=\s*["']?file/gi) ?? []).length,
    captchaDetected: /recaptcha|hcaptcha|turnstile|data-sitekey/i.test(html),
    formFieldCount: (html.match(/<(input|select|textarea)\b/gi) ?? []).length,
  }

  return {
    url,
    title: titleMatch ? stripToText(titleMatch[1] ?? '') : '',
    text: stripToText(bodyMatch ? (bodyMatch[1] ?? '') : html),
    signals,
    ctas,
  }
}

const EMPTY_SIGNALS: PageSignals = {
  passwordFieldCount: 0,
  fileInputCount: 0,
  captchaDetected: false,
  formFieldCount: 0,
}

class FixtureJobTarget implements ReconJobTarget {
  private currentView: PageView | null = null

  constructor(
    private readonly job: JobRecord,
    private readonly htmlPath: string | null,
  ) {}

  async open(url: string): Promise<OpenResult> {
    if (this.htmlPath) {
      if (!existsSync(this.htmlPath)) {
        return { ok: false, timedOut: false, error: `fixture page not found: ${this.htmlPath}` }
      }
      this.currentView = parseHtmlPage(readFileSync(this.htmlPath, 'utf8'), url)
      return { ok: true, timedOut: false }
    }
    // Synthesize a minimal job page from the Phase-1 text fixture.
    const textPath = path.resolve(process.cwd(), this.job.fixture)
    if (!existsSync(textPath)) {
      return { ok: false, timedOut: false, error: `text fixture not found: ${this.job.fixture}` }
    }
    const text = readFileSync(textPath, 'utf8')
    const firstLine = text.split('\n')[0]?.trim() || this.job.id
    this.currentView = {
      url,
      title: firstLine,
      text: text.replace(/\s+/g, ' ').trim(),
      signals: { ...EMPTY_SIGNALS },
      ctas: [
        {
          id: '0',
          tag: 'a',
          text: 'Apply now',
          href: null,
          visible: true,
          enabled: true,
          ariaRole: null,
        },
      ],
    }
    return { ok: true, timedOut: false }
  }

  async view(): Promise<PageView> {
    if (!this.currentView) throw new Error('fixture target: open() must be called before view()')
    return this.currentView
  }

  async screenshot(_filePath: string): Promise<boolean> {
    return false // no browser, no screenshots — recorded as absent, never fabricated
  }

  async clickCta(cta: CtaCandidate): Promise<ClickOutcome> {
    if (!this.currentView) throw new Error('fixture target: open() must be called before clickCta()')
    const postUrl = cta.href && /^https?:\/\//i.test(cta.href) ? cta.href : this.currentView.url
    return {
      clicked: true,
      openedNewTab: false,
      post: {
        url: postUrl,
        title: '',
        text: '',
        signals: { ...EMPTY_SIGNALS },
        ctas: [],
      },
    }
  }

  async close(): Promise<void> {
    this.currentView = null
  }
}

export interface FixtureProviderOptions {
  /** Explicit jobId -> HTML file mapping; unmapped jobs are synthesized. */
  htmlByJobId?: Record<string, string>
}

export class FixtureJobContentProvider implements ReconProvider {
  readonly name = 'fixture'

  constructor(private readonly options: FixtureProviderOptions = {}) {}

  async createTarget(job: JobRecord): Promise<ReconJobTarget> {
    const mapped = this.options.htmlByJobId?.[job.id]
    const conventional = path.join('test-pages', `${job.id}.html`)
    const htmlPath = mapped ?? (existsSync(conventional) ? conventional : null)
    return new FixtureJobTarget(job, htmlPath ? path.resolve(process.cwd(), htmlPath) : null)
  }

  async dispose(): Promise<void> {}
}

/** Default mapping used by the CLI's --provider fixture mode. */
export const DEFAULT_FIXTURE_PAGES: Record<string, string> = {
  barclays_research_2027_sg: 'test-pages/barclays-job.html',
  bofa_gib_2027_sg: 'test-pages/bofa-job.html',
  gs_170782: 'test-pages/gs-job.html',
  gic_internship_programme: 'test-pages/gic-job.html',
}
