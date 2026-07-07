import type { FieldPolicyCategory } from '../fieldPolicy/types'
import type { Bucket, Warning } from '../intelligence/types'
import type { WorkdayGuardResult, WorkdayPageKind } from '../workday/types'

export interface DraftFlags {
  provider: 'live' | 'fixture'
  headed: boolean
  inspectOnly: boolean
  fillSafeFields: boolean
  fillConfirmedFields: boolean
  /** Essays from the answer bank; defaults OFF and review-gated entries never fill. */
  fillDraftAnswers: boolean
  /** Demographics; even with the flag, only exact option matches ever fill. */
  fillDemographics: boolean
  allowCvUpload: boolean
  clickApply: boolean
}

export interface PreflightCheck {
  id: string
  ok: boolean
  detail: string
}

export interface PreflightResult {
  canInspect: boolean
  canFillSafeFields: boolean
  canFillConfirmedFields: boolean
  canUploadCv: boolean
  /** Structurally impossible to be true — the literal type admits only false. */
  canSubmitFinal: false
  accountKey: string
  accountStatus: string
  blockers: Warning[]
  warnings: Warning[]
  manualReviewRequired: boolean
  checks: PreflightCheck[]
}

export type DraftActionType =
  | 'fill_text'
  | 'select_option'
  | 'check_box'
  | 'upload_cv'
  | 'skip_manual_review'
  | 'skip_never_auto'
  | 'inspect_only'

export interface PlannedAction {
  actionId: string
  type: DraftActionType
  fieldId: string
  fieldLabel: string
  normalizedKey: string | null
  profileSourcePath: string | null
  policy: FieldPolicyCategory
  /** Full plan file only; the redacted variant masks sensitive values. */
  proposedValue: string | null
  sensitive: boolean
  allowed: boolean
  reason: string
  confidence: 'high' | 'medium' | 'low'
  exactOptionMatch: string | null
  optionTargetKind: 'select' | 'radio' | null
  suggestedAnswerId: string | null
}

export interface DraftReadiness {
  ready_for_dry_form_fill: boolean
  ready_for_cv_upload: boolean
  /** Phase 6 invariant — the literal type admits only false. */
  ready_for_final_submit: false
}

export interface ScannedFieldsSummary {
  total: number
  byPolicy: Record<FieldPolicyCategory, number>
  unmappedCount: number
}

export interface DraftPlan {
  jobId: string
  company: string
  url: string
  bucket: Bucket
  selectedCvKey: string | null
  selectedCvHumanLabel: string | null
  selectedCvPath: string | null
  mode: 'inspect_only' | 'draft_fill'
  pageKind: WorkdayPageKind
  guard: WorkdayGuardResult
  preflight: PreflightResult
  scannedFieldsSummary: ScannedFieldsSummary
  /** Actions that WILL run (allowed === true). Empty in inspect-only mode. */
  plannedActions: PlannedAction[]
  /** Fillable-category actions that were denied (missing flag/value/option/guard). */
  blockedActions: PlannedAction[]
  manualReviewItems: PlannedAction[]
  /** never_auto fields, recorded so the human sees what was refused. */
  neverAutoItems: PlannedAction[]
  warnings: Warning[]
  readiness: DraftReadiness
  canSubmitFinal: false
}
