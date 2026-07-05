import { describe, expect, it } from 'vitest'
import { AdapterRegistry, defaultAdapterRegistry } from '../src/adapters/AdapterRegistry'
import type { Platform, PlatformDetection } from '../src/reconnaissance/types'

const detection = (platform: Platform): PlatformDetection => ({
  platform,
  confidence: 'high',
  evidence: [],
  warnings: [],
})

describe('AdapterRegistry', () => {
  const cases: Array<[Platform, string]> = [
    ['workday', 'WorkdayAdapter'],
    ['tal_net', 'TalNetAdapter'],
    ['oracle_recruiting', 'OracleRecruitingAdapter'],
    ['impress_ai', 'ImpressAiAdapter'],
    ['unknown', 'UnknownPlatformAdapter'],
    ['greenhouse', 'UnknownPlatformAdapter'], // no dedicated adapter yet -> fallback
    ['lever', 'UnknownPlatformAdapter'],
    ['linkedin', 'UnknownPlatformAdapter'],
  ]
  for (const [platform, adapterName] of cases) {
    it(`selects ${adapterName} for platform "${platform}"`, () => {
      expect(defaultAdapterRegistry.select(detection(platform)).name).toBe(adapterName)
    })
  }

  it('fallback adapter always requires manual review and proposes no action', () => {
    const adapter = new AdapterRegistry().select(detection('unknown'))
    const summary = adapter.buildAdapterSummary({
      url: 'https://example.com',
      title: 'Example',
      text: 'Some page',
      signals: { passwordFieldCount: 0, fileInputCount: 0, captchaDetected: false, formFieldCount: 0 },
      ctas: [],
      phase: 'post_click',
    })
    expect(summary.manualReviewRequired).toBe(true)
    expect(summary.blockedActions).toEqual(['all_interactions'])
    expect(summary.manualCheckpoints).toContain('platform_unknown')
  })
})
