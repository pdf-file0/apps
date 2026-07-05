import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadProfile } from '../src/profile/loadProfile'
import { maskEmail, maskPhone, redactProfile } from '../src/profile/redactProfile'

const profile = loadProfile(
  fileURLToPath(new URL('./fixtures/candidate_profile.fixture.yaml', import.meta.url)),
)

describe('redactProfile', () => {
  it('masks email, phone, address, DOB, and LinkedIn', () => {
    const redacted = redactProfile(profile)
    expect(redacted.candidate.preferred_application_email).not.toContain('alex.tan@example.edu')
    expect(redacted.candidate.phone).not.toContain('1234 5678')
    expect(redacted.candidate.residential_address.line_1).toBe('[redacted]')
    expect(redacted.candidate.residential_address.postal_code).toBe('[redacted]')
    expect(redacted.candidate.date_of_birth.iso).toBe('[redacted]')
    expect(redacted.candidate.linkedin).toBe('[redacted]')
  })

  it('masks portal account emails and leaves the original untouched', () => {
    const redacted = redactProfile(profile)
    for (const account of Object.values(redacted.portal_accounts)) {
      expect(account.email).not.toContain('example.edu')
    }
    expect(profile.candidate.preferred_application_email).toBe('alex.tan@example.edu')
  })

  it('leaves no raw PII anywhere in the serialized redacted profile', () => {
    const serialized = JSON.stringify(redactProfile(profile))
    expect(serialized).not.toContain('alex.tan@example.edu')
    expect(serialized).not.toContain('1234 5678')
    expect(serialized).not.toContain('1 Example Street')
    expect(serialized).not.toContain('2000-01-01')
    expect(serialized).not.toContain('linkedin.com')
  })

  it('mask helpers behave predictably', () => {
    expect(maskEmail('someone@host.com')).toBe('s***@***')
    expect(maskPhone('+65 8288 3230')).toContain('30')
    expect(maskPhone('+65 8288 3230')).not.toContain('8288')
  })
})
