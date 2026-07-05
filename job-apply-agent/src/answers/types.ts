export type QuestionKind =
  | 'about_yourself'
  | 'why_firm'
  | 'why_role_generic'
  | 'why_investment_banking'
  | 'why_public_equities'
  | 'why_equity_research'
  | 'why_private_equity'
  | 'why_sales_trading_markets'
  | 'why_ficc_macro'
  | 'why_quantitative_strats'
  | 'why_gic'
  | 'why_singapore'
  | 'investment_idea'
  | 'market_trend'
  | 'leadership'
  | 'teamwork'
  | 'failure'
  | 'conflict'
  | 'pressure'
  | 'long_term_goals'
  | 'preferred_group_sector'
  | 'skills_to_develop'
  | 'differentiator'
  | 'complex_problem'
  | 'unknown'

export interface AnswerSelection {
  questionText: string
  kind: QuestionKind
  answerId: string | null
  draftAnswer: string | null
  confidence: 'high' | 'medium' | 'low'
  requiresReview: boolean
  reason: string
}
