import type { Classification } from '../intelligence/types'
import type { AdapterSummary, EntryOption, FlowPacketInfo, PageSnapshot, PageStateKind } from './types'

export interface CheckpointContext {
  snapshot: PageSnapshot
  pageState: PageStateKind
  entryOptions: EntryOption[]
  adapterSummary: AdapterSummary
  platform: string
  classification?: Classification | null
  classificationMatchesExpected?: boolean | null
  packet?: FlowPacketInfo | null
}

/**
 * Combine adapter-specific checkpoints with global ones. Every checkpoint is
 * a place where a HUMAN must act before any later phase may continue.
 */
export function detectManualCheckpoints(context: CheckpointContext): string[] {
  const checkpoints = new Set<string>(context.adapterSummary.manualCheckpoints)
  const text = context.snapshot.text.toLowerCase()
  const kinds = new Set(context.entryOptions.map((o) => o.kind))

  if (context.pageState === 'account_creation' || kinds.has('create_account') || kinds.has('register')) {
    checkpoints.add('account_creation_required')
  }
  if (context.pageState === 'login' || kinds.has('sign_in') || kinds.has('login')) {
    checkpoints.add('login_required')
  }
  if (/verification code|verify (your )?email|one[- ]time (password|code)|\botp\b/.test(text)) {
    checkpoints.add('otp_or_email_verification_possible')
  }
  if (context.pageState === 'captcha' || context.snapshot.signals.captchaDetected) {
    checkpoints.add('captcha_detected')
  }
  if (context.pageState === 'terms' || kinds.has('accept_terms')) {
    checkpoints.add('terms_detected')
  }
  if (kinds.has('resume_autofill')) {
    checkpoints.add('resume_upload_choice')
  }
  if (context.snapshot.signals.fileInputCount > 0 || context.pageState === 'resume_upload') {
    checkpoints.add('resume_upload_detected')
  }
  if (context.pageState === 'profile_form') {
    checkpoints.add('profile_form_detected')
  }
  if (context.pageState === 'chatbot') {
    checkpoints.add('chatbot_flow_detected')
  }
  if (context.pageState === 'final_submit') {
    checkpoints.add('final_submit_detected')
  }
  if (context.classification?.warnings.some((w) => w.code === 'not_summer_internship')) {
    checkpoints.add('job_not_summer_internship')
  }
  if (context.classification?.bucket === 'track_dependent') {
    checkpoints.add('track_dependent_cv')
  }
  if (context.platform === 'unknown') {
    checkpoints.add('platform_unknown')
  }
  if (context.classificationMatchesExpected === false) {
    checkpoints.add('live_classification_mismatch')
  }
  if (context.packet && !context.packet.readiness.ready_for_cv_upload) {
    checkpoints.add('cv_upload_blocked_by_document_warnings')
  }
  return [...checkpoints].sort()
}
