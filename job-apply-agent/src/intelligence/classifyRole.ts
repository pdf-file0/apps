import { normalizeText } from './normalizeText'
import type {
  Bucket,
  Classification,
  Confidence,
  JobMetadata,
  ProgramType,
  Warning,
} from './types'

/**
 * Deterministic keyword lists. Matching is word-boundary based with an
 * optional trailing "s" (so "valuation" matches "valuations"); irregular
 * plurals (thesis/theses, memorandum/memoranda) are listed explicitly.
 */
export const PUBLIC_MARKET_TERMS: readonly string[] = [
  'research',
  'equity research',
  'global investment research',
  'investment research',
  'thematic research',
  'public equities',
  'equities',
  'fixed income',
  'ficc',
  'fx',
  'rates',
  'commodities',
  'currencies',
  'sales and trading',
  'trading',
  'markets',
  'market-making',
  'macro',
  'investment thesis',
  'investment theses',
  'quant strats',
  'quantitative strats',
  'quantitative strategists',
]

export const PRIVATE_MARKET_TERMS: readonly string[] = [
  'investment banking',
  'global banking',
  'm&a',
  'mergers and acquisitions',
  'corporate finance',
  'capital raising',
  'equity origination',
  'debt origination',
  'ecm',
  'dcm',
  'loans',
  'live deals',
  'transaction',
  'deal execution',
  'valuation',
  'due diligence',
  'offering memorandum',
  'offering memoranda',
  'client pitch',
  'financial sponsors',
  'private equity',
  'alternatives',
  'private investing',
  'infrastructure',
  'real estate',
  'direct investment',
  'growth equity',
  'venture capital',
]

/**
 * Signals that one application covers multiple tracks (e.g. the GIC
 * Internship Programme). Two or more of these, combined with keyword hits on
 * BOTH the public and private lists, classify the role as track_dependent.
 */
export const TRACK_DEPENDENT_SIGNALS: readonly string[] = [
  'multiple tracks',
  'public and private markets',
  'investment professionals',
  'corporate services',
  'preferred track',
  'selected track',
]

function termToRegex(term: string): RegExp {
  const escaped = term
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '[\\s-]+')
  return new RegExp(`\\b${escaped}s?\\b`, 'i')
}

function matchTerms(text: string, terms: readonly string[]): string[] {
  const matched: string[] = []
  for (const term of terms) {
    if (termToRegex(term).test(text)) matched.push(term)
  }
  return matched.sort()
}

function dedupeSorted(terms: string[]): string[] {
  return [...new Set(terms)].sort()
}

export function detectProgramType(text: string, hint?: ProgramType): ProgramType {
  if (/\bsummer\b[\s-]+(analyst|associate|intern(ship)?)/i.test(text)) {
    return 'summer_internship'
  }
  if (/\bnew[\s-]+analyst\b/i.test(text)) {
    return 'new_analyst_full_time'
  }
  if (/\bintern(ship)?s?\b/i.test(text)) {
    return 'internship'
  }
  return hint ?? 'unknown'
}

const GOLDMAN_LIMIT_WARNING: Warning = {
  code: 'goldman_sachs_application_limit',
  message:
    'Goldman Sachs allows up to 4 separate business/location combinations per recruiting year; track how many have been used before applying.',
}

const NOT_SUMMER_WARNING: Warning = {
  code: 'not_summer_internship',
  message: 'This is a New Analyst (full-time) role, not a Summer Analyst internship.',
}

/**
 * Classify a role into a CV bucket using deterministic keyword scoring.
 *
 * Rules (in order):
 * 1. >=2 track-dependent signals plus hits on BOTH term lists -> track_dependent.
 * 2. Both scores high (>=4) and close (margin <= 2) -> ambiguous: use
 *    jobMetadata.expectedBucket if provided, otherwise manual_review.
 * 3. Otherwise the higher-scoring bucket wins; weak evidence -> manual_review.
 */
export function classifyRole(inputText: string, jobMetadata?: JobMetadata): Classification {
  const text = normalizeText(inputText)
  const publicMatches = matchTerms(text, PUBLIC_MARKET_TERMS)
  const privateMatches = matchTerms(text, PRIVATE_MARKET_TERMS)
  const trackMatches = matchTerms(text, TRACK_DEPENDENT_SIGNALS)
  const programType = detectProgramType(text, jobMetadata?.programTypeHint)

  const warnings: Warning[] = []
  if (programType === 'new_analyst_full_time') {
    warnings.push(NOT_SUMMER_WARNING)
  }
  if (programType === 'unknown') {
    warnings.push({
      code: 'program_type_unclear',
      message: 'Could not confirm that this role is a summer internship; verify before applying.',
    })
  }
  if (jobMetadata?.company?.toLowerCase().includes('goldman')) {
    warnings.push(GOLDMAN_LIMIT_WARNING)
  }

  const pub = publicMatches.length
  const priv = privateMatches.length
  const allMatches = dedupeSorted([...publicMatches, ...privateMatches, ...trackMatches])
  const scoreline =
    `public-market terms: ${pub} [${publicMatches.join(', ')}]; ` +
    `private-market terms: ${priv} [${privateMatches.join(', ')}]`

  // Rule 1: one application, multiple tracks.
  if (trackMatches.length >= 2 && pub >= 1 && priv >= 1) {
    warnings.push({
      code: 'track_dependent_cv',
      message:
        'One application covers multiple tracks; CV selection stays manual until a track is chosen.',
    })
    return {
      bucket: 'track_dependent',
      confidence: 'medium',
      matchedTerms: allMatches,
      rationale:
        `Multi-track application: matched ${trackMatches.length} track signals ` +
        `[${trackMatches.join(', ')}] with both public and private keyword hits (${scoreline}).`,
      warnings,
      programType,
    }
  }

  // No evidence at all.
  if (pub === 0 && priv === 0) {
    warnings.push({
      code: 'manual_review_required',
      message: 'No classification keywords matched; review this role manually.',
    })
    return {
      bucket: 'manual_review',
      confidence: 'low',
      matchedTerms: [],
      rationale: `No public- or private-market keywords matched (${scoreline}).`,
      warnings,
      programType,
    }
  }

  const winnerBucket: Bucket =
    pub >= priv ? 'public_equities_markets_research' : 'private_markets_ibd_deals'
  const winner = Math.max(pub, priv)
  const loser = Math.min(pub, priv)
  const margin = winner - loser

  // Rule 2: both sides score high and close -> ambiguous.
  if (winner >= 4 && loser >= 4 && margin <= 2) {
    if (jobMetadata?.expectedBucket && jobMetadata.expectedBucket !== 'manual_review') {
      warnings.push({
        code: 'ambiguous_resolved_by_expected_bucket',
        message:
          `Public and private keyword scores were close (${pub} vs ${priv}); ` +
          `resolved via the configured expected bucket "${jobMetadata.expectedBucket}".`,
      })
      return {
        bucket: jobMetadata.expectedBucket,
        confidence: 'medium',
        matchedTerms: allMatches,
        rationale: `Ambiguous keyword evidence (${scoreline}); expected bucket from config used as tie-break.`,
        warnings,
        programType,
      }
    }
    warnings.push({
      code: 'ambiguous_classification',
      message: `Public and private keyword scores are both high and close (${pub} vs ${priv}); manual review required.`,
    })
    return {
      bucket: 'manual_review',
      confidence: 'low',
      matchedTerms: allMatches,
      rationale: `Ambiguous keyword evidence (${scoreline}); no expected bucket configured.`,
      warnings,
      programType,
    }
  }

  // Rule 3: clear winner, confidence by score and margin.
  const confidence: Confidence =
    winner >= 4 && margin >= 3 ? 'high' : winner >= 2 && margin >= 2 ? 'medium' : 'low'

  if (confidence === 'low') {
    warnings.push({
      code: 'manual_review_required',
      message: `Keyword evidence too weak to classify confidently (${pub} public vs ${priv} private); review manually.`,
    })
    return {
      bucket: 'manual_review',
      confidence,
      matchedTerms: allMatches,
      rationale: `Weak keyword evidence (${scoreline}).`,
      warnings,
      programType,
    }
  }

  const winnerMatches =
    winnerBucket === 'public_equities_markets_research' ? publicMatches : privateMatches
  return {
    bucket: winnerBucket,
    confidence,
    matchedTerms: winnerMatches,
    rationale: `Clear ${winnerBucket === 'public_equities_markets_research' ? 'public-market' : 'private-market'} keyword winner (${scoreline}); program type: ${programType}.`,
    warnings,
    programType,
  }
}
