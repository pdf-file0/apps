import type { Bucket } from '../intelligence/types'
import type { AnswerBank } from '../profile/types'
import { classifyQuestion } from './questionClassifier'
import type { AnswerSelection, QuestionKind } from './types'

const DIRECT_ANSWER_IDS: Partial<Record<QuestionKind, string>> = {
  about_yourself: 'tell_us_about_yourself',
  why_investment_banking: 'why_investment_banking',
  why_public_equities: 'why_public_equities_research',
  why_equity_research: 'why_equity_research',
  why_private_equity: 'why_private_equity_direct_investing',
  why_sales_trading_markets: 'why_sales_trading_markets',
  why_ficc_macro: 'why_ficc_macro',
  why_quantitative_strats: 'why_quantitative_strats',
  why_gic: 'why_gic',
  why_singapore: 'why_singapore',
  investment_idea: 'investment_idea_singtel',
  market_trend: 'market_trend_ai_infrastructure_cybersecurity',
  leadership: 'leadership',
  failure: 'failure',
  conflict: 'conflict',
  pressure: 'worked_under_pressure',
  long_term_goals: 'long_term_career_goals',
  preferred_group_sector: 'preferred_group_sector',
  skills_to_develop: 'skills_to_develop',
  differentiator: 'differentiator',
  complex_problem: 'complex_analytical_problem_public_equities',
}

function firmAnswerId(company: string | undefined, bucket: Bucket | undefined): string | null {
  const name = (company ?? '').toLowerCase()
  if (name.includes('barclays')) {
    return bucket === 'private_markets_ibd_deals'
      ? 'why_barclays_investment_banking'
      : 'why_barclays_research'
  }
  if (name.includes('bank of america')) return 'why_bank_of_america_global_investment_banking'
  if (name.includes('goldman')) return 'why_goldman_sachs'
  if (name.includes('gic')) return 'why_gic'
  return null
}

function roleAnswerId(bucket: Bucket | undefined): string | null {
  if (bucket === 'public_equities_markets_research') return 'why_public_equities_research'
  if (bucket === 'private_markets_ibd_deals') return 'why_investment_banking'
  return null
}

export interface SelectAnswerInput {
  questionText: string
  jobId?: string
  bucket?: Bucket
  company?: string
  answerBank: AnswerBank
}

const manualReview = (
  questionText: string,
  kind: QuestionKind,
  reason: string,
): AnswerSelection => ({
  questionText,
  kind,
  answerId: null,
  draftAnswer: null,
  confidence: 'low',
  requiresReview: true,
  reason: `manual_review: ${reason}`,
})

/**
 * Map a question to a draft answer from the bank. Every returned draft has
 * requiresReview true unless the bank entry was explicitly approved AND
 * cleared for later-phase auto-use — in Phase 3 that is never the case.
 */
export function selectAnswer(input: SelectAnswerInput): AnswerSelection {
  const kind = classifyQuestion(input.questionText)
  if (kind === 'unknown') {
    return manualReview(input.questionText, kind, 'question did not match any known pattern')
  }

  let answerId: string | null = null
  let confidence: AnswerSelection['confidence'] = 'high'
  let note = ''

  if (kind === 'why_firm') {
    answerId = firmAnswerId(input.company, input.bucket)
    if (!answerId) {
      return manualReview(input.questionText, kind, `no firm-specific answer for "${input.company ?? 'unknown company'}"`)
    }
  } else if (kind === 'why_role_generic') {
    answerId = roleAnswerId(input.bucket)
    confidence = 'medium'
    note = ' (generic role question resolved via classification bucket)'
    if (!answerId) {
      return manualReview(input.questionText, kind, 'generic role question with no resolvable bucket')
    }
  } else if (kind === 'teamwork') {
    answerId = 'conflict'
    confidence = 'medium'
    note = ' (closest match: teamwork/disagreement story — review before use)'
  } else {
    answerId = DIRECT_ANSWER_IDS[kind] ?? null
    if (!answerId) {
      return manualReview(input.questionText, kind, `no answer mapped for kind "${kind}"`)
    }
  }

  const entry = input.answerBank.answers.find((a) => a.id === answerId)
  if (!entry) {
    return manualReview(input.questionText, kind, `answer "${answerId}" not present in answer bank`)
  }

  const requiresReview =
    entry.requires_review ||
    entry.status !== 'approved' ||
    !entry.allow_auto_use_later_phase ||
    entry.unapproved_story_requires_user_confirmation === true

  return {
    questionText: input.questionText,
    kind,
    answerId: entry.id,
    draftAnswer: entry.text,
    confidence,
    requiresReview,
    reason: `matched question kind "${kind}" to answer "${entry.id}"${note}`,
  }
}
