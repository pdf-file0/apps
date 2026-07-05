import { describe, expect, it } from 'vitest'
import type { CtaCandidate } from '../src/browser/types'
import {
  findApplyCta,
  findCookieDeclineCta,
  normalizeLabel,
} from '../src/reconnaissance/findApplyCta'

let nextId = 0
const cta = (text: string, overrides: Partial<CtaCandidate> = {}): CtaCandidate => ({
  id: String(nextId++),
  tag: 'button',
  text,
  href: null,
  visible: true,
  enabled: true,
  ariaRole: null,
  ...overrides,
})

describe('normalizeLabel', () => {
  it('strips decoration and case', () => {
    expect(normalizeLabel('  Apply Now  →')).toBe('apply now')
    expect(normalizeLabel('APPLY')).toBe('apply')
  })
})

describe('findApplyCta', () => {
  it('finds a visible Apply Now button among other controls', () => {
    const scan = findApplyCta([cta('Sign in'), cta('Apply Now'), cta('Search jobs')])
    expect(scan.decision).toBe('safe_cta_found')
    expect(scan.safeCta?.text).toBe('Apply Now')
  })

  it('ignores Submit Application', () => {
    const scan = findApplyCta([cta('Submit Application')])
    expect(scan.safeCta).toBeNull()
    expect(scan.blocked.map((c) => c.text)).toContain('Submit Application')
  })

  it('never treats Login / Create Account / Register as apply CTAs', () => {
    const scan = findApplyCta([cta('Login'), cta('Create account'), cta('Register')])
    expect(scan.decision).toBe('no_cta_found')
    expect(scan.safeCta).toBeNull()
    expect(scan.blocked).toHaveLength(3)
  })

  it('accepts "Apply for job" (real Barclays label) but not "How to Apply"', () => {
    const scan = findApplyCta([cta('How to Apply'), cta('Apply for job')])
    expect(scan.decision).toBe('safe_cta_found')
    expect(scan.safeCta?.text).toBe('Apply for job')
    expect(scan.unsafeApplyLike.map((c) => c.text)).toContain('How to Apply')
  })

  it('routes ambiguous apply-like buttons to unsafe/manual review', () => {
    const scan = findApplyCta([cta('Apply via external agency portal')])
    expect(scan.decision).toBe('unsafe_only')
    expect(scan.safeCta).toBeNull()
    expect(scan.warnings.some((w) => w.includes('manual review'))).toBe(true)
  })

  it('does not click a disabled or hidden Apply button', () => {
    const disabled = findApplyCta([cta('Apply now', { enabled: false })])
    expect(disabled.decision).toBe('unsafe_only')
    expect(disabled.safeCta).toBeNull()

    const hidden = findApplyCta([cta('Apply', { visible: false })])
    expect(hidden.decision).toBe('unsafe_only')
    expect(hidden.safeCta).toBeNull()
  })

  it('picks exactly one CTA when several safe ones exist', () => {
    const scan = findApplyCta([cta('Apply'), cta('Apply now')])
    expect(scan.decision).toBe('safe_cta_found')
    expect(scan.safeCta?.text).toBe('Apply')
    expect(scan.warnings.some((w) => w.includes('only the first'))).toBe(true)
  })

  it('never clicks Continue / Next / Accept / I agree style buttons', () => {
    const scan = findApplyCta([cta('Continue'), cta('Next'), cta('Accept'), cta('I agree')])
    expect(scan.decision).toBe('no_cta_found')
    expect(scan.blocked).toHaveLength(4)
  })
})

describe('findCookieDeclineCta (decline-only cookie banner handling)', () => {
  const bannerText = 'This website uses cookies. To accept cookies click the button.'

  it('picks Reject All and never Accept All or Manage Cookies', () => {
    const decline = findCookieDeclineCta(
      [cta('Accept All'), cta('Reject All'), cta('Manage Cookies')],
      bannerText,
    )
    expect(decline?.text).toBe('Reject All')
  })

  it('returns null when the page does not mention cookies/consent', () => {
    const decline = findCookieDeclineCta([cta('Reject All')], 'A job description with no banner.')
    expect(decline).toBeNull()
  })

  it('returns null when only accept-style options exist', () => {
    const decline = findCookieDeclineCta(
      [cta('Accept All'), cta('I agree'), cta('Manage Cookies')],
      bannerText,
    )
    expect(decline).toBeNull()
  })
})
