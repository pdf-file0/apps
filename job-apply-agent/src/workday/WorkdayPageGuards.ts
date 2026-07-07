import { normalizeLabel } from '../reconnaissance/findApplyCta'
import { BLOCKED_CONTROL_PATTERNS, GUARD_TEXT_PATTERNS, OTP_FIELD_PATTERN, PAGE_KIND_MARKERS } from './WorkdaySelectors'
import type {
  WorkdayGuardBlock,
  WorkdayGuardResult,
  WorkdayPageKind,
  WorkdayPageScan,
} from './types'

export interface GuardOptions {
  /** True only when the CLI was invoked with --allow-cv-upload AND preflight allowed it. */
  uploadRequested: boolean
}

function detectPageKind(scan: WorkdayPageScan): WorkdayPageKind {
  const headings = scan.fields
    .map((f) => f.sectionHeading)
    .filter((h): h is string => h !== null)
  const haystack = `${scan.title} ${headings.join(' ')}`
  // Ordered: the most dangerous kinds are matched from the full page text so
  // they can never be missed just because a heading was absent.
  if (scan.signals.captchaDetected) return 'captcha'
  if (GUARD_TEXT_PATTERNS.terms.test(scan.text)) return 'terms'
  if (scan.signals.passwordFieldCount > 0 || GUARD_TEXT_PATTERNS.login.test(scan.text)) {
    return 'login_or_account'
  }
  if (
    GUARD_TEXT_PATTERNS.finalSubmit.test(scan.text) ||
    GUARD_TEXT_PATTERNS.review.test(haystack)
  ) {
    return 'review_submit'
  }
  for (const marker of PAGE_KIND_MARKERS) {
    if (marker.pattern.test(haystack)) return marker.kind as WorkdayPageKind
  }
  if (scan.fields.length === 0) return 'job_landing'
  return 'unknown'
}

/**
 * The Phase 6 mutation gate. Evaluated BEFORE building a plan and re-checked
 * DURING execution: if any block is present, no field on the page may be
 * touched. Upload permission is separate and stricter.
 */
export function evaluateWorkdayPageGuards(
  scan: WorkdayPageScan,
  options: GuardOptions,
): WorkdayGuardResult {
  const blocks: WorkdayGuardBlock[] = []
  const evidence: string[] = []
  const pageKind = detectPageKind(scan)

  const blockedButtons = scan.buttons.filter((label) =>
    BLOCKED_CONTROL_PATTERNS.some((pattern) => pattern.test(normalizeLabel(label))),
  )
  const submitLikeButtons = blockedButtons.filter((label) => /submit/i.test(label))

  if (pageKind === 'review_submit' || GUARD_TEXT_PATTERNS.finalSubmit.test(scan.text)) {
    blocks.push({ code: 'final_submit_page', evidence: 'final review / submit markers in page text' })
  }
  if (submitLikeButtons.length > 0) {
    blocks.push({ code: 'submit_button_present', evidence: `button(s): ${submitLikeButtons.join(', ')}` })
  }
  const certifyInFields = scan.fields.some((f) => GUARD_TEXT_PATTERNS.certification.test(f.label))
  if (certifyInFields || GUARD_TEXT_PATTERNS.certification.test(scan.text)) {
    blocks.push({ code: 'certification_present', evidence: 'certification / declaration-of-truth wording found' })
  }
  if (GUARD_TEXT_PATTERNS.electronicSignature.test(scan.text)) {
    blocks.push({ code: 'electronic_signature_present', evidence: 'electronic signature wording found' })
  }
  if (pageKind === 'terms' || GUARD_TEXT_PATTERNS.terms.test(scan.text)) {
    blocks.push({ code: 'terms_page', evidence: 'terms/agreement wording with consent control' })
  }
  if (scan.signals.passwordFieldCount > 0) {
    blocks.push({ code: 'password_field_present', evidence: `${scan.signals.passwordFieldCount} password field(s)` })
  }
  const otpFields = scan.fields.filter((f) => OTP_FIELD_PATTERN.test(f.label))
  if (otpFields.length > 0 || GUARD_TEXT_PATTERNS.otp.test(scan.text)) {
    blocks.push({ code: 'otp_field_present', evidence: 'one-time-code / verification-code markers' })
  }
  if (scan.signals.captchaDetected) {
    blocks.push({ code: 'captcha_present', evidence: 'captcha widget detected' })
  }
  if (GUARD_TEXT_PATTERNS.alreadySubmitted.test(scan.text)) {
    blocks.push({ code: 'already_submitted', evidence: 'application-already-submitted wording' })
  }
  if (GUARD_TEXT_PATTERNS.duplicate.test(scan.text)) {
    blocks.push({ code: 'duplicate_application', evidence: 'duplicate-application wording' })
  }
  if (GUARD_TEXT_PATTERNS.expired.test(scan.text)) {
    blocks.push({ code: 'job_expired', evidence: 'job-expired / no-longer-accepting wording' })
  }
  if (pageKind === 'login_or_account') {
    blocks.push({ code: 'login_or_account_page', evidence: 'login / account-creation page' })
  }
  if (pageKind === 'unknown' && scan.fields.length > 0) {
    blocks.push({ code: 'unknown_form', evidence: 'form fields on an unrecognized page — never fill blind' })
  }
  if (scan.signals.fileInputCount > 0 && !options.uploadRequested) {
    blocks.push({
      code: 'file_upload_not_allowed',
      evidence: `${scan.signals.fileInputCount} file input(s) present without --allow-cv-upload`,
    })
  }

  evidence.push(`pageKind: ${pageKind}`)
  if (blockedButtons.length > 0) {
    evidence.push(`blocked controls never clicked: ${blockedButtons.join(', ')}`)
  }

  // A file input without upload permission blocks only uploads, not ordinary
  // field mutation; every other block poisons the whole page.
  const mutationBlocking = blocks.filter((b) => b.code !== 'file_upload_not_allowed')

  return {
    pageKind,
    mutationAllowed: mutationBlocking.length === 0,
    uploadAllowed:
      options.uploadRequested &&
      pageKind === 'resume_upload' &&
      mutationBlocking.length === 0 &&
      scan.signals.fileInputCount > 0,
    blocks,
    evidence,
  }
}
