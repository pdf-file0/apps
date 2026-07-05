import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCvRoutingConfig } from '../src/config/loadConfig'
import { selectCv } from '../src/intelligence/selectCv'
import type { Classification } from '../src/intelligence/types'

const routing = loadCvRoutingConfig(
  fileURLToPath(new URL('../config/cv_routing.yaml', import.meta.url)),
)

const classification = (overrides: Partial<Classification>): Classification => ({
  bucket: 'public_equities_markets_research',
  confidence: 'high',
  matchedTerms: ['research'],
  rationale: 'test classification',
  warnings: [],
  programType: 'summer_internship',
  ...overrides,
})

describe('selectCv', () => {
  it('routes public_equities_markets_research to the OMERS / public equities CV', () => {
    const selection = selectCv(classification({}), routing)
    expect(selection.selectedCvKey).toBe('omers_public_equities')
    expect(selection.selectedCvPath).toBe('documents/Samuel_Lim_CV_Public_Equities_Markets.pdf')
    expect(selection.humanLabel).toBe('OMERS / public equities CV')
    expect(selection.requiresManualReview).toBe(false)
    expect(selection.reason).toBeTruthy()
  })

  it('routes private_markets_ibd_deals to the Temasek-expanded / private markets CV', () => {
    const selection = selectCv(classification({ bucket: 'private_markets_ibd_deals' }), routing)
    expect(selection.selectedCvKey).toBe('temasek_private_markets')
    expect(selection.selectedCvPath).toBe('documents/Samuel_Lim_CV_Private_Markets_IBD.pdf')
    expect(selection.humanLabel).toBe('Temasek-expanded / private markets CV')
    expect(selection.requiresManualReview).toBe(false)
  })

  it('leaves track_dependent with no CV and requires manual review', () => {
    const selection = selectCv(
      classification({ bucket: 'track_dependent', confidence: 'medium' }),
      routing,
    )
    expect(selection.selectedCvKey).toBeNull()
    expect(selection.selectedCvPath).toBeNull()
    expect(selection.humanLabel).toBe('manual until selected track is known')
    expect(selection.requiresManualReview).toBe(true)
  })

  it('leaves manual_review with no CV and requires manual review', () => {
    const selection = selectCv(
      classification({ bucket: 'manual_review', confidence: 'low' }),
      routing,
    )
    expect(selection.selectedCvKey).toBeNull()
    expect(selection.selectedCvPath).toBeNull()
    expect(selection.requiresManualReview).toBe(true)
  })

  it('forces manual review when confidence is low even with a routed CV', () => {
    const selection = selectCv(classification({ confidence: 'low' }), routing)
    expect(selection.selectedCvKey).toBe('omers_public_equities')
    expect(selection.requiresManualReview).toBe(true)
  })
})
