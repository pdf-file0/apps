import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyRole } from '../src/intelligence/classifyRole'
import type { Bucket, Confidence, JobMetadata, ProgramType } from '../src/intelligence/types'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const warningCodes = (result: ReturnType<typeof classifyRole>): string[] =>
  result.warnings.map((w) => w.code)

interface FixtureCase {
  name: string
  file: string
  metadata: JobMetadata
  bucket: Bucket
  confidence: Confidence
  programType: ProgramType
  expectedWarningCodes: string[]
}

const CASES: FixtureCase[] = [
  {
    name: 'barclays_research_2027_sg',
    file: 'barclays_research.txt',
    metadata: { id: 'barclays_research_2027_sg', company: 'Barclays' },
    bucket: 'public_equities_markets_research',
    confidence: 'high',
    programType: 'summer_internship',
    expectedWarningCodes: [],
  },
  {
    name: 'barclays_ib_2027_sg',
    file: 'barclays_ib.txt',
    metadata: { id: 'barclays_ib_2027_sg', company: 'Barclays' },
    bucket: 'private_markets_ibd_deals',
    confidence: 'high',
    programType: 'summer_internship',
    expectedWarningCodes: [],
  },
  {
    name: 'bofa_gib_2027_sg',
    file: 'bofa_gib.txt',
    metadata: { id: 'bofa_gib_2027_sg', company: 'Bank of America' },
    bucket: 'private_markets_ibd_deals',
    confidence: 'high',
    programType: 'summer_internship',
    expectedWarningCodes: [],
  },
  {
    name: 'gs_170782 (IB New Analyst)',
    file: 'gs_investment_banking_new_analyst.txt',
    metadata: { id: 'gs_170782', company: 'Goldman Sachs' },
    bucket: 'private_markets_ibd_deals',
    confidence: 'high',
    programType: 'new_analyst_full_time',
    expectedWarningCodes: ['not_summer_internship', 'goldman_sachs_application_limit'],
  },
  {
    name: 'gs_171417 (Alternatives / Private Investing New Analyst)',
    file: 'gs_alternatives_private_investing_new_analyst.txt',
    metadata: { id: 'gs_171417', company: 'Goldman Sachs' },
    bucket: 'private_markets_ibd_deals',
    confidence: 'high',
    programType: 'new_analyst_full_time',
    expectedWarningCodes: ['not_summer_internship', 'goldman_sachs_application_limit'],
  },
  {
    name: 'gs_170822 (Global Investment Research)',
    file: 'gs_global_investment_research.txt',
    metadata: { id: 'gs_170822', company: 'Goldman Sachs' },
    bucket: 'public_equities_markets_research',
    confidence: 'high',
    programType: 'summer_internship',
    expectedWarningCodes: ['goldman_sachs_application_limit'],
  },
  {
    name: 'gs_170600 (FICC & Equities Quant Strats)',
    file: 'gs_ficc_equities_quant_strats.txt',
    metadata: { id: 'gs_170600', company: 'Goldman Sachs' },
    bucket: 'public_equities_markets_research',
    confidence: 'high',
    programType: 'summer_internship',
    expectedWarningCodes: ['goldman_sachs_application_limit'],
  },
]

describe('classifyRole — known job fixtures', () => {
  for (const c of CASES) {
    it(`classifies ${c.name}`, () => {
      const result = classifyRole(fixture(c.file), c.metadata)
      expect(result.bucket).toBe(c.bucket)
      expect(result.confidence).toBe(c.confidence)
      expect(result.programType).toBe(c.programType)
      expect(warningCodes(result).sort()).toEqual([...c.expectedWarningCodes].sort())
      expect(result.matchedTerms.length).toBeGreaterThan(0)
      expect(result.rationale).toBeTruthy()
    })
  }

  it('classifies gic_internship_programme as track_dependent with medium confidence', () => {
    const result = classifyRole(fixture('gic_internship_programme.txt'), {
      id: 'gic_internship_programme',
      company: 'GIC',
    })
    expect(result.bucket).toBe('track_dependent')
    expect(result.confidence).toBe('medium')
    expect(result.programType).toBe('internship')
    expect(warningCodes(result)).toContain('track_dependent_cv')
    expect(warningCodes(result)).not.toContain('goldman_sachs_application_limit')
  })

  it('is deterministic: same input, same output', () => {
    const text = fixture('barclays_research.txt')
    const a = classifyRole(text, { company: 'Barclays' })
    const b = classifyRole(text, { company: 'Barclays' })
    expect(a).toEqual(b)
  })
})

describe('classifyRole — edge cases', () => {
  const AMBIGUOUS_TEXT =
    'This role spans equity research, fixed income, FICC, markets and trading as well as ' +
    'investment banking, M&A, private equity, due diligence and valuation work.'

  it('returns manual_review when public and private scores are high and close', () => {
    const result = classifyRole(AMBIGUOUS_TEXT)
    expect(result.bucket).toBe('manual_review')
    expect(result.confidence).toBe('low')
    expect(warningCodes(result)).toContain('ambiguous_classification')
  })

  it('resolves ambiguity via expectedBucket for known job ids', () => {
    const result = classifyRole(AMBIGUOUS_TEXT, {
      id: 'known_job',
      expectedBucket: 'public_equities_markets_research',
    })
    expect(result.bucket).toBe('public_equities_markets_research')
    expect(result.confidence).toBe('medium')
    expect(warningCodes(result)).toContain('ambiguous_resolved_by_expected_bucket')
  })

  it('returns manual_review with low confidence when nothing matches', () => {
    const result = classifyRole('Barista role at a coffee shop. Latte art a plus.')
    expect(result.bucket).toBe('manual_review')
    expect(result.confidence).toBe('low')
    expect(warningCodes(result)).toContain('manual_review_required')
  })

  it('warns not_summer_internship for New Analyst roles', () => {
    const result = classifyRole(
      'Investment Banking New Analyst supporting M&A, valuation, due diligence and deal execution on live deals and capital raising.',
    )
    expect(result.programType).toBe('new_analyst_full_time')
    expect(warningCodes(result)).toContain('not_summer_internship')
  })

  it('adds the Goldman Sachs application-limit warning from company metadata only', () => {
    const text =
      'Global Investment Research Summer Analyst: equity research on public equities, fixed income, currencies and commodities.'
    const gs = classifyRole(text, { company: 'Goldman Sachs' })
    const other = classifyRole(text, { company: 'Barclays' })
    expect(warningCodes(gs)).toContain('goldman_sachs_application_limit')
    expect(warningCodes(other)).not.toContain('goldman_sachs_application_limit')
  })
})
