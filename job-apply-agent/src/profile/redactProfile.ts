import type { CandidateProfile } from './types'

export const REDACTED = '[redacted]'

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return REDACTED
  return `${email[0]}***@***`
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Mask any email addresses embedded in free text (warnings, notes, messages). */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_PATTERN, (match) => maskEmail(match))
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return REDACTED
  return `${phone.slice(0, 3)} ******${digits.slice(-2)}`
}

/**
 * Deep-copy the profile with PII masked: email, phone, address, date of
 * birth, LinkedIn, and portal-account emails. Console output must always go
 * through this; the unmasked profile only ever lands in local gitignored
 * files.
 */
export function redactProfile(profile: CandidateProfile): CandidateProfile {
  const clone: CandidateProfile = JSON.parse(JSON.stringify(profile))
  clone.candidate.preferred_application_email = maskEmail(
    profile.candidate.preferred_application_email,
  )
  clone.candidate.phone = maskPhone(profile.candidate.phone)
  clone.candidate.residential_address.line_1 = REDACTED
  if (clone.candidate.residential_address.line_2 !== undefined) {
    clone.candidate.residential_address.line_2 = REDACTED
  }
  clone.candidate.residential_address.postal_code = REDACTED
  clone.candidate.date_of_birth.iso = REDACTED
  clone.candidate.date_of_birth.display_sg_format = REDACTED
  if (clone.candidate.linkedin !== undefined) {
    clone.candidate.linkedin = REDACTED
  }
  for (const account of Object.values(clone.portal_accounts)) {
    account.email = maskEmail(account.email)
  }
  // Final sweep: emails can be quoted inside free text anywhere (unresolved
  // item messages, experience notes) — scrub every remaining email pattern.
  return JSON.parse(maskEmailsInText(JSON.stringify(clone))) as CandidateProfile
}
