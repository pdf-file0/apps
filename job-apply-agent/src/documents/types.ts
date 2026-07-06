import type { z } from 'zod'
import type {
  DocumentEntrySchema,
  DocumentKindSchema,
  DocumentManifestSchema,
  ExperienceShownSchema,
  NationalServiceStatusSchema,
  PrivateMarketsStatsSchema,
} from './schemas'

export type DocumentKind = z.infer<typeof DocumentKindSchema>
export type ExperienceShown = z.infer<typeof ExperienceShownSchema>
export type PrivateMarketsStats = z.infer<typeof PrivateMarketsStatsSchema>
export type DocumentEntry = z.infer<typeof DocumentEntrySchema>
export type DocumentManifest = z.infer<typeof DocumentManifestSchema>
export type NationalServiceStatus = z.infer<typeof NationalServiceStatusSchema>

export type DocumentBlockerCode =
  | 'document_file_missing'
  | 'cv_email_mismatch'
  | 'temasek_end_date_stale'
  | 'temasek_end_month_unresolved'
  | 'private_cv_correction_needed'
  | 'private_cv_expected_stats_missing'
  | 'routed_cv_missing_from_manifest'
  | 'profile_unresolved_item'
  | 'national_service_status_unknown'

/**
 * blocks_cv_upload  — CV upload stays impossible until resolved.
 * manual_review_if_asked — does not block uploads, but a human must take over
 *                          the moment a portal asks about it.
 */
export type DocumentBlockerSeverity = 'blocks_cv_upload' | 'manual_review_if_asked'

export interface DocumentBlocker {
  id: string
  code: DocumentBlockerCode
  severity: DocumentBlockerSeverity
  /** null for manifest/profile-level blockers not tied to one document. */
  documentKey: string | null
  message: string
  resolution: string
}

export interface DocumentCheckLine {
  check: string
  ok: boolean
  detail: string
}

export interface DocumentCheckResult {
  key: string
  kind: DocumentKind
  path: string
  checks: DocumentCheckLine[]
}

export interface DocumentValidationReport {
  blockers: DocumentBlocker[]
  manualReviewItems: DocumentBlocker[]
  warnings: string[]
  perDocument: DocumentCheckResult[]
}

export interface DocumentReadiness {
  ready_for_cv_upload: boolean
  /** Structurally impossible to be true in Phase 5. */
  ready_for_final_submit: false
  blockers: DocumentBlocker[]
  manualReviewItems: DocumentBlocker[]
  warnings: string[]
  perDocument: DocumentCheckResult[]
}
