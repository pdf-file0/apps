import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { readFileSync } from 'node:fs'
import { ConfigError } from '../src/config/loadConfig'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'
import { CandidateProfileFileSchema } from '../src/profile/schemas'
import { validateProfile } from '../src/profile/validateProfile'

const fixturePath = fileURLToPath(new URL('./fixtures/candidate_profile.fixture.yaml', import.meta.url))
const answersPath = fileURLToPath(new URL('./fixtures/answer_bank.fixture.yaml', import.meta.url))
const fixtureYaml = (): Record<string, unknown> =>
  parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>

describe('profile validation', () => {
  it('accepts the fixture profile', () => {
    const profile = loadProfile(fixturePath)
    expect(profile.candidate.preferred_name).toBe('Alex')
    expect(profile.experiences).toHaveLength(6)
  })

  it('surfaces blocking unresolved items as warnings without failing', () => {
    const report = validateProfile(loadProfile(fixturePath))
    expect(report.ok).toBe(true)
    expect(report.blockingItems.map((i) => i.id)).toEqual([
      'temasek_end_date',
      'cv_email_mismatch',
      'private_cv_temasek_corrections',
    ])
    expect(report.warnings.some((w) => w.startsWith('BLOCKING'))).toBe(true)
  })

  it('fails in final-ready mode while blocking items exist', () => {
    expect(() => loadProfile(fixturePath, { finalReadyMode: true })).toThrowError(ConfigError)
    expect(() => loadProfile(fixturePath, { finalReadyMode: true })).toThrowError(/BLOCKING/)
  })

  it('fails when required fields are missing', () => {
    const data = fixtureYaml()
    delete (data['candidate'] as Record<string, unknown>)['preferred_application_email']
    const result = CandidateProfileFileSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('fails when the submission policy is unsafe (auto final submit)', () => {
    const data = fixtureYaml()
    ;(data['submission_policy'] as Record<string, unknown>)['final_submit'] = 'automatic'
    const result = CandidateProfileFileSchema.safeParse(data)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.success ? {} : result.error.issues)).toContain('final_submit')
  })

  it('fails when password creation is not manual', () => {
    const data = fixtureYaml()
    ;(data['submission_policy'] as Record<string, unknown>)['password_creation'] = 'automatic'
    expect(CandidateProfileFileSchema.safeParse(data).success).toBe(false)
  })

  it('loads the answer bank and rejects auto-use drafts', () => {
    const bank = loadAnswerBank(answersPath)
    expect(bank.answers.length).toBeGreaterThan(20)
    expect(bank.answers.every((a) => a.requires_review)).toBe(true)
    expect(bank.answers.every((a) => !a.allow_auto_use_later_phase)).toBe(true)
  })

  it('fails with a clear message for a missing profile file', () => {
    expect(() => loadProfile('profiles/does-not-exist.local.yaml')).toThrowError(
      /Cannot read candidate profile/,
    )
  })
})
