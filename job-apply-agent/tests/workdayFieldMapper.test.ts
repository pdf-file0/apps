import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCvRoutingConfig, loadJobsConfig } from '../src/config/loadConfig'
import { buildApplicationPacket } from '../src/packets/buildApplicationPacket'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'
import { scanWorkdayFieldsFromHtml } from '../src/workday/WorkdayFieldScanner'
import { mapWorkdayFields } from '../src/workday/WorkdayFieldMapper'
import type { MappedWorkdayField, ScannedWorkdayField } from '../src/workday/types'

const root = fileURLToPath(new URL('..', import.meta.url))
const page = (name: string): string =>
  readFileSync(path.join(root, 'test-pages', name), 'utf8')

const jobsConfig = loadJobsConfig(path.join(root, 'config/jobs.yaml'))
const cvRouting = loadCvRoutingConfig(path.join(root, 'config/cv_routing.yaml'))
const profile = loadProfile(path.join(root, 'tests/fixtures/candidate_profile.fixture.yaml'))
const answerBank = loadAnswerBank(path.join(root, 'tests/fixtures/answer_bank.fixture.yaml'))
const packet = buildApplicationPacket({
  jobId: 'barclays_research_2027_sg',
  jobsConfig,
  cvRoutingConfig: cvRouting,
  profile,
  answerBank,
})

const mapPage = (name: string): MappedWorkdayField[] =>
  mapWorkdayFields({
    fields: scanWorkdayFieldsFromHtml(page(name)),
    packet,
    answerBank,
    company: 'Barclays',
    jobId: 'barclays_research_2027_sg',
    bucket: packet.bucket,
  })

const byKey = (mapped: MappedWorkdayField[], key: string): MappedWorkdayField =>
  mapped.find((m) => m.normalizedKey === key)!

describe('WorkdayFieldMapper', () => {
  it('maps contact and address fields to safe_auto_fill with packet values', () => {
    const mapped = mapPage('workday-my-information.html')
    for (const key of ['first_name', 'last_name', 'email', 'phone', 'address_line_1', 'postal_code', 'country']) {
      const field = byKey(mapped, key)
      expect(field.policy, key).toBe('safe_auto_fill')
      expect(field.proposedValue, key).not.toBeNull()
    }
    expect(byKey(mapped, 'email').proposedValue).toBe('alex.tan@example.edu')
    expect(byKey(mapped, 'country').exactOptionMatch).toBe('Singapore')
  })

  it('maps education fields to safe_auto_fill with exact degree option match', () => {
    const mapped = mapPage('workday-education.html')
    for (const key of ['institution', 'degree', 'major', 'expected_graduation', 'gpa']) {
      expect(byKey(mapped, key).policy, key).toBe('safe_auto_fill')
    }
    expect(byKey(mapped, 'degree').exactOptionMatch).toBe("Bachelor's in Business Management")
  })

  it('maps work authorization / sponsorship / prior-Barclays questions to auto_if_confirmed', () => {
    const mapped = mapPage('workday-application-questions.html')
    const workAuth = byKey(mapped, 'legally_authorized_sg')
    expect(workAuth.policy).toBe('auto_if_confirmed')
    expect(workAuth.proposedValue).toBe(true)
    expect(workAuth.exactOptionMatch).toBe('Yes')

    const sponsorship = byKey(mapped, 'requires_sponsorship')
    expect(sponsorship.policy).toBe('auto_if_confirmed')
    expect(sponsorship.exactOptionMatch).toBe('No')

    expect(byKey(mapped, 'previously_applied').policy).toBe('auto_if_confirmed')
    expect(byKey(mapped, 'previously_applied').exactOptionMatch).toBe('No')
    expect(byKey(mapped, 'relatives_employed').policy).toBe('auto_if_confirmed')
  })

  it('maps demographic fields to demographic_exact_match_only with exact option only', () => {
    const mapped = mapPage('workday-application-questions.html')
    const gender = byKey(mapped, 'gender')
    expect(gender.policy).toBe('demographic_exact_match_only')
    expect(gender.exactOptionMatch).toBe('Prefer not to say')
  })

  it('maps National Service and salary to manual_review; essays get draft suggestions only', () => {
    const mapped = mapPage('workday-application-questions.html')
    expect(byKey(mapped, 'national_service').policy).toBe('manual_review')
    expect(byKey(mapped, 'salary_expectations').policy).toBe('manual_review')

    const essay = byKey(mapped, 'open_ended_question')
    expect(essay.policy).toBe('manual_review')
    expect(essay.proposedValue).toBeNull() // draft text never auto-proposed as a value
    expect(essay.suggestedAnswerId).toBe('why_barclays_research')
    expect(essay.suggestedAnswerRequiresReview).toBe(true)
  })

  it('maps password/OTP/certification/final-submit labels to never_auto', () => {
    const synthetic: ScannedWorkdayField[] = [
      'Password',
      'One-Time Password',
      'I certify that the information provided is true and complete',
      'Final Submit',
    ].map((label, i) => ({
      fieldId: `s${i}`,
      label,
      inputType: 'text',
      name: null,
      domId: null,
      automationId: null,
      ariaLabel: null,
      placeholder: null,
      currentValue: null,
      required: false,
      options: [],
      helpText: null,
      sectionHeading: null,
    }))
    const mapped = mapWorkdayFields({
      fields: synthetic,
      packet,
      answerBank,
      company: 'Barclays',
      jobId: 'barclays_research_2027_sg',
      bucket: packet.bucket,
    })
    for (const m of mapped) {
      expect(m.policy, m.field.label).toBe('never_auto')
      expect(m.proposedValue).toBeNull()
    }
  })

  it('never guesses: unmapped fields fall to manual_review, mismatched options never match', () => {
    const mapped = mapPage('workday-my-information.html')
    const source = mapped.find((m) => m.field.fieldId === 'source')!
    expect(source.normalizedKey).toBeNull()
    expect(source.policy).toBe('manual_review')

    // "Phone Device Type" binds to the phone value but has no exact option —
    // the plan can therefore never act on it.
    const phoneType = mapped.find((m) => m.field.fieldId === 'phoneType')!
    expect(phoneType.exactOptionMatch).toBeNull()
  })
})
