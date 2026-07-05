import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyQuestion } from '../src/answers/questionClassifier'
import { selectAnswer } from '../src/answers/selectAnswer'
import { loadAnswerBank } from '../src/profile/loadProfile'

const answerBank = loadAnswerBank(
  fileURLToPath(new URL('./fixtures/answer_bank.fixture.yaml', import.meta.url)),
)

describe('classifyQuestion', () => {
  const cases: Array<[string, string]> = [
    ['Tell us about yourself', 'about_yourself'],
    ['Why do you want to work at Barclays?', 'why_firm'],
    ['Why are you interested in this role?', 'why_role_generic'],
    ['Why investment banking?', 'why_investment_banking'],
    ['Why are you interested in public equities?', 'why_public_equities'],
    ['Why equity research?', 'why_equity_research'],
    ['Why sales and trading?', 'why_sales_trading_markets'],
    ['Why GIC?', 'why_gic'],
    ['Why Singapore?', 'why_singapore'],
    ['Walk us through an investment idea.', 'investment_idea'],
    ['What market trend are you following?', 'market_trend'],
    ['Tell us about a leadership experience.', 'leadership'],
    ['Describe a time you worked in a team.', 'teamwork'],
    ['Tell us about a failure.', 'failure'],
    ['Describe a conflict you handled.', 'conflict'],
    ['Describe a time you worked under pressure.', 'pressure'],
    ['What are your long-term career goals?', 'long_term_goals'],
    ['Which group or sector do you prefer?', 'preferred_group_sector'],
    ['Which skills do you want to develop?', 'skills_to_develop'],
    ['What sets you apart from other candidates?', 'differentiator'],
    ['Describe a complex analytical problem you solved.', 'complex_problem'],
    ['What is your favourite colour?', 'unknown'],
  ]
  for (const [question, expected] of cases) {
    it(`classifies "${question}" as ${expected}`, () => {
      expect(classifyQuestion(question)).toBe(expected)
    })
  }
})

describe('selectAnswer', () => {
  it('returns the Barclays research answer for public-bucket why-firm', () => {
    const selection = selectAnswer({
      questionText: 'Why do you want to work at Barclays?',
      company: 'Barclays',
      bucket: 'public_equities_markets_research',
      answerBank,
    })
    expect(selection.answerId).toBe('why_barclays_research')
    expect(selection.requiresReview).toBe(true)
  })

  it('returns the Barclays IB answer for private-bucket why-firm', () => {
    const selection = selectAnswer({
      questionText: 'Why do you want to work at Barclays?',
      company: 'Barclays',
      bucket: 'private_markets_ibd_deals',
      answerBank,
    })
    expect(selection.answerId).toBe('why_barclays_investment_banking')
  })

  it('maps firm answers for BofA, Goldman Sachs, and GIC', () => {
    const bofa = selectAnswer({
      questionText: 'Why do you want to join us?',
      company: 'Bank of America',
      bucket: 'private_markets_ibd_deals',
      answerBank,
    })
    expect(bofa.answerId).toBe('why_bank_of_america_global_investment_banking')
    const gs = selectAnswer({
      questionText: 'Why do you want to work at Goldman Sachs?',
      company: 'Goldman Sachs',
      bucket: 'public_equities_markets_research',
      answerBank,
    })
    expect(gs.answerId).toBe('why_goldman_sachs')
    const gic = selectAnswer({ questionText: 'Why GIC?', company: 'GIC', answerBank })
    expect(gic.answerId).toBe('why_gic')
  })

  it('resolves generic role questions via the bucket', () => {
    const publicRole = selectAnswer({
      questionText: 'Why are you interested in this programme?',
      bucket: 'public_equities_markets_research',
      answerBank,
    })
    expect(publicRole.answerId).toBe('why_public_equities_research')
    expect(publicRole.confidence).toBe('medium')
  })

  it('always flags drafts as requiring review', () => {
    const selection = selectAnswer({ questionText: 'Tell us about yourself', answerBank })
    expect(selection.requiresReview).toBe(true)
    expect(selection.draftAnswer).toContain('Fixture answer')
  })

  it('returns manual_review for unmatched questions', () => {
    const selection = selectAnswer({
      questionText: 'What is your favourite colour?',
      answerBank,
    })
    expect(selection.answerId).toBeNull()
    expect(selection.reason).toContain('manual_review')
  })
})
