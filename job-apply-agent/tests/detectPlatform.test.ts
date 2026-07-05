import { describe, expect, it } from 'vitest'
import { detectPlatform } from '../src/reconnaissance/detectPlatform'

describe('detectPlatform', () => {
  it('detects Workday from URL', () => {
    const result = detectPlatform({
      url: 'https://barclays.wd3.myworkdayjobs.com/en-US/apply/job/singapore/research-analyst',
    })
    expect(result.platform).toBe('workday')
    expect(result.confidence).toBe('high')
    expect(result.evidence.some((e) => e.includes('myworkdayjobs'))).toBe(true)
  })

  it('detects Workday from page text alone', () => {
    const result = detectPlatform({
      url: 'https://search.jobs.barclays/job/singapore/research-analyst',
      text: 'Candidate Home is powered by Workday.',
    })
    expect(result.platform).toBe('workday')
    expect(['medium', 'high']).toContain(result.confidence)
  })

  it('detects TAL.net from URL and text', () => {
    const result = detectPlatform({
      url: 'https://bankcampuscareers.tal.net/vx/lang-en-GB/candidate/apply/14364',
      text: 'Welcome to the candidate portal',
    })
    expect(result.platform).toBe('tal_net')
    expect(result.confidence).toBe('high')
  })

  it('detects Oracle Recruiting from URL and text', () => {
    const result = detectPlatform({
      url: 'https://egsp.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/170782',
      text: 'Oracle Candidate Experience job application',
    })
    expect(result.platform).toBe('oracle_recruiting')
    expect(result.confidence).toBe('high')
  })

  it('detects Impress.ai from URL and text', () => {
    const result = detectPlatform({
      url: 'https://gic.impress.ai/candidate/start',
      text: 'Our virtual assistant chatbot will guide your application.',
    })
    expect(result.platform).toBe('impress_ai')
    expect(result.confidence).toBe('high')
  })

  it('returns unknown for an unrelated page', () => {
    const result = detectPlatform({
      url: 'https://example.com/careers/barista',
      title: 'Barista - Example Coffee',
      text: 'Join our coffee shop team. Latte art appreciated.',
    })
    expect(result.platform).toBe('unknown')
    expect(result.confidence).toBe('low')
    expect(result.evidence).toEqual([])
  })

  it('flags ambiguous equal-score signals with low confidence', () => {
    const result = detectPlatform({
      url: 'https://example.com/jobs/123',
      text: 'powered by workday and also greenhouse',
    })
    expect(result.confidence).toBe('low')
    expect(result.warnings.some((w) => w.includes('ambiguous'))).toBe(true)
  })
})
