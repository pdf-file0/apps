import type { AnswerSelection } from '../answers/types'
import type { FormattedExperience } from '../experience/types'
import type { Bucket, ProgramType, Warning } from '../intelligence/types'
import type { FieldPolicyCategory } from '../fieldPolicy/types'
import type { UnresolvedItem } from '../profile/types'

export interface PacketField {
  key: string
  label: string
  value: string | boolean | null
  /** Sensitive values are masked in redacted output and console summaries. */
  sensitive: boolean
  policy: FieldPolicyCategory
  note?: string
}

export interface PacketReadiness {
  ready_for_dry_form_fill: boolean
  ready_for_cv_upload: boolean
  /** Structurally impossible to be true in Phase 3. */
  ready_for_final_submit: false
}

export interface ApplicationPacket {
  jobId: string
  company: string
  url: string
  bucket: Bucket
  resolvedTrack: string | null
  selectedCvKey: string | null
  selectedCvHumanLabel: string | null
  selectedCvPath: string | null
  programType: ProgramType
  warnings: Warning[]
  candidateFieldSummary: {
    redacted: Record<string, string>
    full: Record<string, string>
  }
  safeAutoFillFields: PacketField[]
  autoIfConfirmedFields: PacketField[]
  demographicFields: PacketField[]
  manualReviewFields: PacketField[]
  neverAutoFields: PacketField[]
  selectedExperiences: FormattedExperience[]
  secondaryExperiences: FormattedExperience[]
  suggestedAnswers: AnswerSelection[]
  unresolvedItems: UnresolvedItem[]
  manualReviewRequired: boolean
  readiness: PacketReadiness
}
