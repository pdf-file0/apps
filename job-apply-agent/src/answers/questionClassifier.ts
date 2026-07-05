import { normalizeText } from '../intelligence/normalizeText'
import type { QuestionKind } from './types'

interface Rule {
  kind: QuestionKind
  pattern: RegExp
}

// Order matters: more specific rules first. Matching runs on normalized text.
const RULES: Rule[] = [
  { kind: 'why_singapore', pattern: /why .*singapore|singapore.*why|based in singapore/ },
  { kind: 'why_gic', pattern: /why .*\bgic\b|\bgic\b.*(interest|apply|join)/ },
  { kind: 'why_investment_banking', pattern: /why .*(investment banking|ibd|global banking)/ },
  { kind: 'why_equity_research', pattern: /why .*equity research/ },
  { kind: 'why_public_equities', pattern: /why .*(public equities|public markets investing)/ },
  { kind: 'why_private_equity', pattern: /why .*(private equity|direct invest|buyout)/ },
  {
    kind: 'why_sales_trading_markets',
    pattern: /why .*(sales and trading|sales & trading|global markets|markets division|markets role)/,
  },
  { kind: 'why_ficc_macro', pattern: /why .*(ficc|macro|fixed income currencies)/ },
  { kind: 'why_quantitative_strats', pattern: /why .*(quant|strats)/ },
  {
    kind: 'why_firm',
    pattern:
      /why (do you want to (work|join)|us\b|.*\b(this firm|our firm|the firm|this company|our company|this bank|barclays|goldman sachs|goldman|bank of america)\b)/,
  },
  {
    kind: 'why_role_generic',
    pattern: /why (are you interested in |do you want )?(this|the) (role|position|programme|program|internship)/,
  },
  { kind: 'about_yourself', pattern: /tell (us|me) about yourself|introduce yourself|about yourself/ },
  { kind: 'investment_idea', pattern: /investment idea|stock pitch|pitch (us|me)? ?an? (stock|idea|investment)/ },
  { kind: 'market_trend', pattern: /market trend|trend (you are|you're) (following|watching)|current market development/ },
  { kind: 'leadership', pattern: /leadership|time you led|led a (team|project)/ },
  { kind: 'teamwork', pattern: /teamwork|work(ed|ing)? (in|with) a team|team player/ },
  { kind: 'failure', pattern: /failure|failed|mistake|setback/ },
  { kind: 'conflict', pattern: /conflict|disagree/ },
  { kind: 'pressure', pattern: /pressure|tight deadline|stressful|competing deadlines/ },
  { kind: 'long_term_goals', pattern: /long[ -]?term|career goals?|in (five|5|ten|10) years/ },
  {
    kind: 'preferred_group_sector',
    pattern: /preferred (group|sector|division|desk|team)|which (group|division|sector|team|desk).*(prefer|interest)/,
  },
  { kind: 'skills_to_develop', pattern: /skills? (do you want|you hope|to develop|to improve)|development areas/ },
  { kind: 'differentiator', pattern: /differentiate|unique|stand out|set(s)? you apart/ },
  { kind: 'complex_problem', pattern: /complex.*(problem|analysis)|analytical problem|difficult analysis/ },
]

export function classifyQuestion(questionText: string): QuestionKind {
  const text = normalizeText(questionText)
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.kind
  }
  return 'unknown'
}
