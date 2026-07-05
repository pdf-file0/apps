import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  loadCandidateProfileConfig,
  loadCvRoutingConfig,
  loadJobsConfig,
  loadSubmissionPolicy,
  parseCvRoutingConfig,
  parseJobsConfig,
  parseSubmissionPolicy,
} from '../src/config/loadConfig'

const configPath = (name: string): string =>
  fileURLToPath(new URL(`../config/${name}`, import.meta.url))

describe('shipped config files are valid', () => {
  it('accepts config/jobs.yaml', () => {
    const cfg = loadJobsConfig(configPath('jobs.yaml'))
    expect(cfg.jobs).toHaveLength(8)
    expect(cfg.jobs.map((j) => j.id)).toContain('gic_internship_programme')
  })

  it('accepts config/cv_routing.yaml', () => {
    const cfg = loadCvRoutingConfig(configPath('cv_routing.yaml'))
    expect(Object.keys(cfg.cvs).sort()).toEqual(['omers_public_equities', 'temasek_private_markets'])
    expect(cfg.buckets.track_dependent?.cv).toBeNull()
  })

  it('accepts config/submission_policy.yaml with every risky action off', () => {
    const policy = loadSubmissionPolicy(configPath('submission_policy.yaml'))
    expect(policy.autoSubmit).toBe(false)
    expect(policy.allowAccountCreation).toBe(false)
    expect(policy.allowDocumentUpload).toBe(false)
    expect(policy.allowFinalSubmit).toBe(false)
    expect(policy.requireHumanConfirmation).toBe(true)
  })

  it('accepts config/candidate_profile.schema.yaml and carries document warnings', () => {
    const profile = loadCandidateProfileConfig(configPath('candidate_profile.schema.yaml'))
    expect(profile.documentWarnings.map((w) => w.code)).toEqual([
      'cv_email_mismatch',
      'temasek_end_date_stale',
      'temasek_deal_counts_incorrect',
    ])
  })
})

describe('malformed jobs.yaml fails clearly', () => {
  it('rejects a job with a missing url', () => {
    const bad = `
jobs:
  - id: some_job
    company: Somewhere
    fixture: tests/fixtures/barclays_research.txt
`
    expect(() => parseJobsConfig(bad, 'test.yaml')).toThrowError(ConfigError)
    expect(() => parseJobsConfig(bad, 'test.yaml')).toThrowError(/jobs\.0\.url/)
  })

  it('rejects an unknown bucket', () => {
    const bad = `
jobs:
  - id: some_job
    url: https://example.com/job
    company: Somewhere
    fixture: tests/fixtures/barclays_research.txt
    expectedBucket: hedge_funds
`
    expect(() => parseJobsConfig(bad, 'test.yaml')).toThrowError(/expectedBucket/)
  })

  it('rejects duplicate job ids', () => {
    const bad = `
jobs:
  - id: dup
    url: https://example.com/a
    company: A
    fixture: tests/fixtures/barclays_research.txt
  - id: dup
    url: https://example.com/b
    company: B
    fixture: tests/fixtures/barclays_ib.txt
`
    expect(() => parseJobsConfig(bad, 'test.yaml')).toThrowError(/duplicate job id "dup"/)
  })

  it('rejects unparseable YAML with the source file in the message', () => {
    expect(() => parseJobsConfig('jobs: [unclosed', 'broken.yaml')).toThrowError(/broken\.yaml/)
  })
})

describe('malformed cv_routing.yaml fails clearly', () => {
  it('rejects a bucket route referencing an unknown cv', () => {
    const bad = `
cvs:
  omers_public_equities:
    humanLabel: OMERS / public equities CV
    path: documents/a.pdf
buckets:
  public_equities_markets_research:
    cv: omers_public_equities
  private_markets_ibd_deals:
    cv: does_not_exist
  track_dependent:
    cv: null
    humanLabel: manual until selected track is known
  manual_review:
    cv: null
    humanLabel: manual review required
`
    expect(() => parseCvRoutingConfig(bad, 'test.yaml')).toThrowError(
      /references unknown cv "does_not_exist"/,
    )
  })

  it('rejects a routing config missing a bucket', () => {
    const bad = `
cvs:
  omers_public_equities:
    humanLabel: OMERS / public equities CV
    path: documents/a.pdf
buckets:
  public_equities_markets_research:
    cv: omers_public_equities
`
    expect(() => parseCvRoutingConfig(bad, 'test.yaml')).toThrowError(
      /missing route for bucket "manual_review"/,
    )
  })
})

describe('submission_policy.yaml is a hard safety gate', () => {
  it('rejects autoSubmit: true', () => {
    const bad = `
phase: 1
autoSubmit: true
allowAccountCreation: false
allowDocumentUpload: false
allowFinalSubmit: false
requireHumanConfirmation: true
`
    expect(() => parseSubmissionPolicy(bad, 'test.yaml')).toThrowError(/autoSubmit/)
  })

  it('rejects requireHumanConfirmation: false', () => {
    const bad = `
phase: 1
autoSubmit: false
allowAccountCreation: false
allowDocumentUpload: false
allowFinalSubmit: false
requireHumanConfirmation: false
`
    expect(() => parseSubmissionPolicy(bad, 'test.yaml')).toThrowError(/requireHumanConfirmation/)
  })
})
