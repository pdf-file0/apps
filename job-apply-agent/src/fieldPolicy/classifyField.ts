import { normalizeText } from '../intelligence/normalizeText'
import { FIELD_ALIASES, FIELD_POLICY_PRECEDENCE } from './fieldAliases'
import type { FieldClassification, FieldClassificationContext } from './types'

/**
 * Classify a form field/question label by automation safety.
 *
 * Precedence guarantees: password/OTP/captcha/terms/submit/signature can
 * never be shadowed by a safer category, demographics never degrade to
 * plain auto-fill, and anything unrecognized is manual_review — the system
 * never guesses that an unknown field is safe.
 */
const aliasToRegex = (alias: string): RegExp => {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s/-]+')
  return new RegExp(`\\b${escaped}s?\\b`, 'i')
}

export function classifyField(
  fieldLabel: string,
  context?: FieldClassificationContext,
): FieldClassification {
  const haystack = normalizeText(`${context?.section ?? ''} ${fieldLabel}`)
  for (const category of FIELD_POLICY_PRECEDENCE) {
    for (const alias of FIELD_ALIASES[category]) {
      if (aliasToRegex(alias).test(haystack)) {
        return {
          category,
          matchedAlias: alias,
          reason: `label matched "${alias}" -> ${category}`,
        }
      }
    }
  }
  return {
    category: 'manual_review',
    matchedAlias: null,
    reason: 'no alias matched; defaulting to manual_review (never assume a field is safe)',
  }
}
