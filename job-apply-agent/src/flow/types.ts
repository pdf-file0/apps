import type { CtaCandidate, PageSignals } from '../browser/types'
import type { Classification, ProgramType, Warning } from '../intelligence/types'
import type { PacketReadiness } from '../packets/types'
import type { Platform, StopReason } from '../reconnaissance/types'

/** Extended page states Phase 4 can identify. */
export type PageStateKind =
  | 'job_landing_page'
  | 'external_apply_entry'
  | 'login'
  | 'account_creation'
  | 'application_entry_chooser'
  | 'resume_upload'
  | 'profile_form'
  | 'chatbot'
  | 'captcha'
  | 'terms'
  | 'final_submit'
  | 'unknown'

export interface PageStateResult {
  state: PageStateKind
  evidence: string[]
}

export type EntryOptionKind =
  | 'apply_cta'
  | 'resume_autofill'
  | 'apply_manually'
  | 'create_account'
  | 'sign_in'
  | 'register'
  | 'login'
  | 'continue_next'
  | 'upload_resume'
  | 'chatbot_start'
  | 'submit'
  | 'accept_terms'
  | 'unknown'

export type EntryOptionSafety =
  | 'safe_read_only'
  | 'safe_apply_click_only'
  | 'blocked_phase_4'
  | 'never_auto'

export interface EntryOption {
  label: string
  kind: EntryOptionKind
  safety: EntryOptionSafety
  reason: string
}

/** A page observation at a specific point in the flow. */
export interface PageSnapshot {
  url: string
  title: string
  text: string
  signals: PageSignals
  ctas: CtaCandidate[]
  phase: 'pre_click' | 'post_click'
}

export interface AdapterSummary {
  adapter: string
  platform: Platform
  entryState: PageStateKind
  entryStateEvidence: string[]
  entryOptions: EntryOption[]
  blockedActions: string[]
  manualCheckpoints: string[]
  manualReviewRequired: boolean
  notes: string[]
}

export interface FlowPageObservation {
  url: string
  title: string
  pageState: PageStateKind
  pageStateEvidence: string[]
  entryOptions: EntryOption[]
  textSnippet: string
}

export interface FlowPacketInfo {
  selectedCvKey: string | null
  selectedCvHumanLabel: string | null
  readiness: PacketReadiness
  unresolvedBlockingItems: string[]
  manualReviewRequired: boolean
}

export interface FlowMapResult {
  jobId: string
  company: string
  url: string
  platform: Platform
  platformConfidence: 'high' | 'medium' | 'low'
  platformEvidence: string[]
  adapter: string
  programType: ProgramType
  liveClassification: Classification | null
  classificationMatchesExpected: boolean | null
  preClick: FlowPageObservation | null
  applyCtaFound: boolean
  applyCtaClicked: boolean
  ctaTextClicked: string | null
  openedNewTab: boolean
  postClick: FlowPageObservation | null
  safeActions: string[]
  blockedActions: string[]
  manualCheckpoints: string[]
  packet: FlowPacketInfo | null
  stopReason: StopReason
  manualReviewRequired: boolean
  screenshots: string[]
  artifacts: string[]
  warnings: Warning[]
}
