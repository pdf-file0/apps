/**
 * Central place for every Workday marker and BLOCKED-control pattern.
 * These strings exist so guards can DETECT dangerous controls — Phase 6
 * never clicks any control matched here. Executor modules must not
 * reference these words; the static safety test enforces that.
 */

/** Attribute used to target scanned fields precisely (mirrors data-recon-cta-id). */
export const DRAFT_FIELD_ATTR = 'data-draft-field-id'

/** Button/control labels that must NEVER be clicked, in any phase. */
export const BLOCKED_CONTROL_PATTERNS: readonly RegExp[] = [
  /^submit$/i,
  /^submit application$/i,
  /^final submit$/i,
  /^i agree$/i,
  /^agree$/i,
  /^accept$/i,
  /^accept (all|terms|and continue)$/i,
  /^certify$/i,
  /^i certify$/i,
  /^sign$/i,
  /^e-?sign(ature)?$/i,
  /^create account$/i,
  /^sign in$/i,
  /^sign up$/i,
  /^log ?in$/i,
  /^register$/i,
]

/** Page-text markers used by the guards. */
export const GUARD_TEXT_PATTERNS = {
  finalSubmit: /final (review|submit)|submit (your |this )?application|ready to submit/i,
  certification: /\bcertif(y|ication)\b|information (i have )?(provided|given) is (true|accurate|complete)|declaration of truth/i,
  electronicSignature: /electronic signature|e-?signature|sign here|digitally sign/i,
  terms: /terms (and|&) conditions|terms of (use|service)|privacy (policy|notice).{0,80}(agree|accept)|i agree to/i,
  otp: /one[- ]?time (password|code|pin)|verification code|\botp\b|enter the code/i,
  alreadySubmitted: /application (has been|was|already) submitted|already applied|thank you for (applying|your application)/i,
  duplicate: /duplicate application|you have an existing application/i,
  expired: /job (posting )?(is no longer|has expired|is closed)|no longer accepting applications|position (has been )?filled/i,
  login: /sign in|log ?in to (continue|your account)|create (an )?account|forgot (your )?password/i,
  review: /review (your|and) (application|information|submit)|^review$/im,
}

/** Section-heading / automation-id markers → Workday page kind. */
export const PAGE_KIND_MARKERS: readonly { kind: string; pattern: RegExp }[] = [
  { kind: 'my_information', pattern: /my information|personal information|contact information/i },
  { kind: 'education', pattern: /\beducation\b/i },
  { kind: 'experience', pattern: /work experience|employment history|\bexperience\b/i },
  { kind: 'application_questions', pattern: /application questions|questionnaire|additional questions/i },
  { kind: 'resume_upload', pattern: /resume|autofill with resume|cv upload|upload.{0,20}(resume|cv)/i },
  { kind: 'review_submit', pattern: /review/i },
]

/** Label patterns that mark an input as an OTP entry field. */
export const OTP_FIELD_PATTERN = /one[- ]?time|verification code|\botp\b|security code/i
