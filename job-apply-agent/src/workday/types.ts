import type { FieldPolicyCategory } from '../fieldPolicy/types'

export type WorkdayInputType =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'file'
  | 'password'
  | 'unknown'

/**
 * One visible form field as observed on a Workday-like page. Password values
 * are never captured; hidden inputs are never scanned.
 */
export interface ScannedWorkdayField {
  /** Stable handle: stamped data-draft-field-id (live) or synthetic id (fixture). */
  fieldId: string
  label: string
  inputType: WorkdayInputType
  name: string | null
  domId: string | null
  automationId: string | null
  ariaLabel: string | null
  placeholder: string | null
  /** Current value; always null for password fields; truncated to 200 chars. */
  currentValue: string | null
  required: boolean
  /** Visible options for select/radio groups (option labels, in page order). */
  options: string[]
  helpText: string | null
  sectionHeading: string | null
}

export interface WorkdayPageSignals {
  passwordFieldCount: number
  fileInputCount: number
  captchaDetected: boolean
  formFieldCount: number
}

export interface WorkdayPageScan {
  url: string
  title: string
  /** Visible page text — kept in FULL local artifacts only, scrubbed in redacted output. */
  text: string
  /** Visible button/submit-control labels (for guards; never clicked by Phase 6). */
  buttons: string[]
  signals: WorkdayPageSignals
  fields: ScannedWorkdayField[]
}

export type WorkdayPageKind =
  | 'my_information'
  | 'education'
  | 'experience'
  | 'application_questions'
  | 'resume_upload'
  | 'review_submit'
  | 'terms'
  | 'captcha'
  | 'login_or_account'
  | 'job_landing'
  | 'unknown'

export type WorkdayGuardBlockCode =
  | 'final_submit_page'
  | 'submit_button_present'
  | 'certification_present'
  | 'electronic_signature_present'
  | 'terms_page'
  | 'password_field_present'
  | 'otp_field_present'
  | 'captcha_present'
  | 'file_upload_not_allowed'
  | 'review_page'
  | 'already_submitted'
  | 'duplicate_application'
  | 'job_expired'
  | 'login_or_account_page'
  | 'unknown_form'

export interface WorkdayGuardBlock {
  code: WorkdayGuardBlockCode
  evidence: string
}

export interface WorkdayGuardResult {
  pageKind: WorkdayPageKind
  /** false → NO field may be filled, selected, or checked on this page. */
  mutationAllowed: boolean
  /** false → NO file may be attached on this page. */
  uploadAllowed: boolean
  blocks: WorkdayGuardBlock[]
  evidence: string[]
}

export interface MappedWorkdayField {
  field: ScannedWorkdayField
  /** Canonical packet key (e.g. "first_name"); null when unmapped. */
  normalizedKey: string | null
  policy: FieldPolicyCategory
  /** Where the proposed value comes from (packet field key / answer id path). */
  profileSourcePath: string | null
  proposedValue: string | boolean | null
  sensitive: boolean
  /** The option string that EXACTLY matches the proposed value, when options exist. */
  exactOptionMatch: string | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
  /** Set for open-ended questions with a matched answer-bank entry. */
  suggestedAnswerId: string | null
  suggestedAnswerRequiresReview: boolean | null
}

export interface FieldActionOutcome {
  actionId: string
  fieldId: string
  status: 'filled' | 'selected' | 'checked' | 'uploaded' | 'refused' | 'failed' | 'stopped_by_guard'
  /** Redaction-safe detail: never contains the value of a sensitive field. */
  detail: string
  verified: boolean
}
