export type FieldPolicyCategory =
  | 'safe_auto_fill'
  | 'auto_if_confirmed'
  | 'demographic_exact_match_only'
  | 'manual_review'
  | 'never_auto'

export interface FieldClassification {
  category: FieldPolicyCategory
  matchedAlias: string | null
  reason: string
}

export interface FieldClassificationContext {
  /** e.g. the surrounding section heading, if known. */
  section?: string
}
