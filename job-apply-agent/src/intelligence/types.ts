import type { z } from 'zod'
import type {
  BucketSchema,
  CandidateProfileConfigSchema,
  ClassificationSchema,
  ConfidenceSchema,
  CvRoutingConfigSchema,
  CvSelectionSchema,
  JobRecordSchema,
  JobResultSchema,
  JobsConfigSchema,
  ProgramTypeSchema,
  RunSummarySchema,
  SubmissionPolicySchema,
  WarningSchema,
} from '../config/schemas'

export type Bucket = z.infer<typeof BucketSchema>
export type Confidence = z.infer<typeof ConfidenceSchema>
export type ProgramType = z.infer<typeof ProgramTypeSchema>
export type Warning = z.infer<typeof WarningSchema>

export type JobRecord = z.infer<typeof JobRecordSchema>
export type JobsConfig = z.infer<typeof JobsConfigSchema>
export type CvRoutingConfig = z.infer<typeof CvRoutingConfigSchema>
export type SubmissionPolicy = z.infer<typeof SubmissionPolicySchema>
export type CandidateProfileConfig = z.infer<typeof CandidateProfileConfigSchema>

export type Classification = z.infer<typeof ClassificationSchema>
export type CvSelection = z.infer<typeof CvSelectionSchema>
export type JobResult = z.infer<typeof JobResultSchema>
export type RunSummary = z.infer<typeof RunSummarySchema>

/**
 * Optional metadata about a job that the classifier may use for warnings
 * (e.g. company-specific application limits) and as a tie-break when keyword
 * scores are ambiguous. It is never used to bypass keyword scoring.
 */
export interface JobMetadata {
  id?: string
  company?: string
  title?: string
  url?: string
  platformHint?: string
  expectedBucket?: Bucket
  programTypeHint?: ProgramType
  trackRouting?: Record<string, Bucket>
}

/**
 * Phase 2 provider interface. Phase 1 ships no network implementation:
 * job text always comes from local fixture files. A Firecrawl- or
 * Playwright-backed implementation will conform to this interface later,
 * gated by submission_policy.yaml.
 */
export interface JobContentProvider {
  readonly name: string
  fetchJobText(url: string): Promise<string>
}
