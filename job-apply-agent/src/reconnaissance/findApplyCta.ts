import type { CtaCandidate } from '../browser/types'

/**
 * Only these EXACT labels (after normalization) on the original job detail
 * page may ever be clicked. Anything else — including labels that merely
 * contain "apply" — is never clicked and is routed to manual review.
 */
export const SAFE_APPLY_LABELS: readonly string[] = [
  'apply',
  'apply now',
  'start application',
  'apply for this job',
  'apply to this job',
  'apply for job',
  'apply to job',
]

/** Labels that must never be clicked, even if they look application-related. */
export const BLOCKED_LABELS: readonly string[] = [
  'submit',
  'submit application',
  'complete application',
  'save and continue',
  'next',
  'continue',
  'create account',
  'create an account',
  'sign in',
  'sign up',
  'log in',
  'login',
  'register',
  'accept',
  'i agree',
  'certify',
]

/**
 * Cookie-banner handling is DECLINE-ONLY. If a consent dialog blocks the
 * page, the only label ever clicked is an exact match from this list —
 * "Accept All", "I agree", "Manage Cookies" etc. are never clicked. This is
 * the privacy-preserving choice (decline non-essential) and is not an
 * acceptance of any terms.
 */
export const COOKIE_DECLINE_LABELS: readonly string[] = [
  'reject all',
  'reject all cookies',
  'reject cookies',
  'reject',
  'decline all',
  'decline all cookies',
  'decline cookies',
  'decline',
  'refuse all',
  'necessary cookies only',
  'only necessary cookies',
  'use necessary cookies only',
]

export function findCookieDeclineCta(
  candidates: CtaCandidate[],
  pageText: string,
): CtaCandidate | null {
  if (!/cookie|consent/i.test(pageText)) return null
  return (
    candidates.find(
      (c) => c.visible && c.enabled && COOKIE_DECLINE_LABELS.includes(normalizeLabel(c.text)),
    ) ?? null
  )
}

export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&' ]+/gu, ' ') // strip arrows, icons, punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

export type CtaVerdict = 'safe' | 'blocked' | 'unsafe_apply_like' | 'irrelevant'

export function classifyCtaLabel(candidate: CtaCandidate): CtaVerdict {
  const label = normalizeLabel(candidate.text)
  if (!label) return 'irrelevant'
  if (BLOCKED_LABELS.includes(label)) return 'blocked'
  if (SAFE_APPLY_LABELS.includes(label)) {
    // Correct label but not clickable -> unsafe, never force it.
    return candidate.visible && candidate.enabled ? 'safe' : 'unsafe_apply_like'
  }
  if (/\b(apply|application|submit)\b/.test(label)) return 'unsafe_apply_like'
  return 'irrelevant'
}

export interface ApplyCtaScan {
  decision: 'safe_cta_found' | 'unsafe_only' | 'no_cta_found'
  safeCta: CtaCandidate | null
  safeMatches: CtaCandidate[]
  unsafeApplyLike: CtaCandidate[]
  blocked: CtaCandidate[]
  warnings: string[]
}

/**
 * Pure decision logic over scanned CTA candidates. Conservative by design:
 * when unsure whether a click is safe, the answer is "don't click" and the
 * caller records manual_review_required.
 */
export function findApplyCta(candidates: CtaCandidate[]): ApplyCtaScan {
  const safeMatches: CtaCandidate[] = []
  const unsafeApplyLike: CtaCandidate[] = []
  const blocked: CtaCandidate[] = []

  for (const candidate of candidates) {
    switch (classifyCtaLabel(candidate)) {
      case 'safe':
        safeMatches.push(candidate)
        break
      case 'unsafe_apply_like':
        unsafeApplyLike.push(candidate)
        break
      case 'blocked':
        blocked.push(candidate)
        break
      case 'irrelevant':
        break
    }
  }

  const warnings: string[] = []
  const safeCta = safeMatches[0] ?? null
  if (safeMatches.length > 1) {
    warnings.push(
      `multiple safe apply CTAs found (${safeMatches.length}); only the first would ever be clicked`,
    )
  }
  if (unsafeApplyLike.length > 0) {
    warnings.push(
      `apply-like CTA(s) not on the safe list, never clicked: ${unsafeApplyLike
        .map((c) => `"${c.text}"`)
        .join(', ')}`,
    )
  }

  const decision: ApplyCtaScan['decision'] = safeCta
    ? 'safe_cta_found'
    : unsafeApplyLike.length > 0
      ? 'unsafe_only'
      : 'no_cta_found'
  if (decision === 'unsafe_only') {
    warnings.push('no safe apply CTA; manual review required before any click')
  }

  return { decision, safeCta, safeMatches, unsafeApplyLike, blocked, warnings }
}
