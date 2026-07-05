import { describe, expect, it } from 'vitest'
import { classifyField } from '../src/fieldPolicy/classifyField'

const category = (label: string): string => classifyField(label).category

describe('classifyField', () => {
  it('classifies credentials, captcha, terms, and submission as never_auto', () => {
    expect(category('Password')).toBe('never_auto')
    expect(category('Confirm password')).toBe('never_auto')
    expect(category('Enter the OTP sent to your email')).toBe('never_auto')
    expect(category('Verification code')).toBe('never_auto')
    expect(category('Captcha')).toBe('never_auto')
    expect(category('I agree to the terms and conditions')).toBe('never_auto')
    expect(category('I certify that the information is true')).toBe('never_auto')
    expect(category('Submit application')).toBe('never_auto')
    expect(category('Electronic signature')).toBe('never_auto')
  })

  it('classifies work authorization and history questions as auto_if_confirmed', () => {
    expect(category('Are you legally authorized to work in Singapore?')).toBe('auto_if_confirmed')
    expect(category('Will you require visa sponsorship now or in the future?')).toBe('auto_if_confirmed')
    expect(category('Have you previously applied to Barclays?')).toBe('auto_if_confirmed')
    expect(category('Have you previously worked at Goldman Sachs?')).toBe('auto_if_confirmed')
    expect(category('Do you have relatives employed at this firm?')).toBe('auto_if_confirmed')
    expect(category('Are you in your penultimate year?')).toBe('auto_if_confirmed')
  })

  it('classifies demographics as demographic_exact_match_only', () => {
    expect(category('Gender')).toBe('demographic_exact_match_only')
    expect(category('Race / Ethnicity')).toBe('demographic_exact_match_only')
    expect(category('Disability status')).toBe('demographic_exact_match_only')
    expect(category('Veteran status')).toBe('demographic_exact_match_only')
    expect(category('Sexual orientation')).toBe('demographic_exact_match_only')
    expect(category('Nationality')).toBe('demographic_exact_match_only')
  })

  it('classifies sensitive process fields as manual_review', () => {
    expect(category('Salary expectations')).toBe('manual_review')
    expect(category('Cover letter')).toBe('manual_review')
    expect(category('Upload transcript')).toBe('manual_review')
    expect(category('Reference contact details')).toBe('manual_review')
    expect(category('Conflict of interest declaration')).toBe('manual_review')
    expect(category('Background check consent')).toBe('manual_review')
    expect(category('National Service status')).toBe('manual_review')
  })

  it('classifies factual identity/education fields as safe_auto_fill', () => {
    expect(category('First name')).toBe('safe_auto_fill')
    expect(category('Last name')).toBe('safe_auto_fill')
    expect(category('Email')).toBe('safe_auto_fill')
    expect(category('Phone')).toBe('safe_auto_fill')
    expect(category('LinkedIn profile')).toBe('safe_auto_fill')
    expect(category('Postal code')).toBe('safe_auto_fill')
    expect(category('University')).toBe('safe_auto_fill')
    expect(category('Degree')).toBe('safe_auto_fill')
    expect(category('Expected graduation date')).toBe('safe_auto_fill')
    expect(category('GPA')).toBe('safe_auto_fill')
  })

  it('defaults unknown fields to manual_review, never safe', () => {
    const result = classifyField('Frobnication preference')
    expect(result.category).toBe('manual_review')
    expect(result.matchedAlias).toBeNull()
  })

  it('never lets a safer alias shadow never_auto', () => {
    // Contains "email" (safe) but is an OTP prompt — never_auto must win.
    expect(category('Email verification code')).toBe('never_auto')
  })
})
