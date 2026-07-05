import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { selectExperience } from '../src/experience/selectExperience'
import { loadProfile } from '../src/profile/loadProfile'

const profile = loadProfile(
  fileURLToPath(new URL('./fixtures/candidate_profile.fixture.yaml', import.meta.url)),
)

describe('selectExperience', () => {
  it('orders public-market experiences first for public roles', () => {
    const selection = selectExperience({
      bucket: 'public_equities_markets_research',
      jobId: 'barclays_research_2027_sg',
      profile,
    })
    expect(selection.manualReviewRequired).toBe(false)
    expect(selection.primary.map((e) => e.id)).toEqual([
      'omers_global_equities',
      'avanda_public_equities',
      'achilles_fund',
      'smu_smif',
    ])
    expect(selection.secondary.map((e) => e.id)).toEqual(['temasek_innovation', 'tembusu_partners'])
  })

  it('orders private-market experiences first for private roles', () => {
    const selection = selectExperience({
      bucket: 'private_markets_ibd_deals',
      jobId: 'barclays_ib_2027_sg',
      profile,
    })
    expect(selection.primary.map((e) => e.id)).toEqual([
      'temasek_innovation',
      'tembusu_partners',
      'avanda_public_equities',
    ])
    expect(selection.secondary.map((e) => e.id)).toEqual([
      'achilles_fund',
      'smu_smif',
      'omers_global_equities',
    ])
  })

  it('requires a selected track for track_dependent jobs', () => {
    const selection = selectExperience({
      bucket: 'track_dependent',
      jobId: 'gic_internship_programme',
      profile,
    })
    expect(selection.manualReviewRequired).toBe(true)
    expect(selection.primary).toEqual([])
  })

  it('resolves track_dependent via resolvedTrackBucket', () => {
    const selection = selectExperience({
      bucket: 'track_dependent',
      jobId: 'gic_internship_programme',
      profile,
      resolvedTrackBucket: 'public_equities_markets_research',
    })
    expect(selection.manualReviewRequired).toBe(false)
    expect(selection.primary[0]?.id).toBe('omers_global_equities')
  })

  it('flags manual_review classifications for human handling', () => {
    const selection = selectExperience({ bucket: 'manual_review', jobId: 'x', profile })
    expect(selection.manualReviewRequired).toBe(true)
  })
})
