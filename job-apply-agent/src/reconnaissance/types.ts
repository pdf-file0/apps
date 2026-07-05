import { z } from 'zod'
import {
  BucketSchema,
  ClassificationSchema,
  ConfidenceSchema,
  WarningSchema,
} from '../config/schemas'

export const PlatformSchema = z.enum([
  'workday',
  'tal_net',
  'oracle_recruiting',
  'impress_ai',
  'greenhouse',
  'lever',
  'linkedin',
  'unknown',
])

export const PlatformDetectionSchema = z
  .object({
    platform: PlatformSchema,
    confidence: ConfidenceSchema,
    evidence: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict()

export const StopReasonSchema = z.enum([
  'job_page_captured',
  'apply_cta_not_found',
  'apply_click_disabled_by_default',
  'unsafe_apply_cta',
  'platform_detected_after_apply',
  'login_or_account_creation_detected',
  'captcha_detected',
  'application_form_detected',
  'navigation_timeout',
  'error',
])

export const ReconJobResultSchema = z
  .object({
    jobId: z.string().min(1),
    company: z.string().min(1),
    originalUrl: z.string().min(1),
    finalUrlBeforeStop: z.string(),
    pageTitle: z.string(),
    liveTextExtracted: z.boolean(),
    liveClassification: ClassificationSchema.nullable(),
    expectedBucket: BucketSchema.nullable(),
    classificationMatchesExpected: z.boolean().nullable(),
    selectedCvKey: z.string().nullable(),
    selectedCvHumanLabel: z.string().nullable(),
    applyCtaFound: z.boolean(),
    applyCtaClicked: z.boolean(),
    ctaTextClicked: z.string().nullable(),
    platform: PlatformSchema,
    platformConfidence: ConfidenceSchema,
    platformEvidence: z.array(z.string()),
    stopReason: StopReasonSchema,
    manualReviewRequired: z.boolean(),
    screenshots: z.array(z.string()),
    artifacts: z.array(z.string()),
    warnings: z.array(WarningSchema),
  })
  .strict()

export const ReconSummarySchema = z
  .object({
    phase: z.literal(2),
    mode: z.literal('reconnaissance_dry_run'),
    jobsFile: z.string().min(1),
    provider: z.string().min(1),
    clickApply: z.boolean(),
    startedAt: z.string().min(1),
    runDir: z.string().min(1),
    totals: z
      .object({
        jobs: z.number().int().nonnegative(),
        manualReviewCount: z.number().int().nonnegative(),
        applyCtaClickedCount: z.number().int().nonnegative(),
        byStopReason: z.record(z.string(), z.number().int().nonnegative()),
        byPlatform: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    results: z.array(ReconJobResultSchema),
  })
  .strict()

export type Platform = z.infer<typeof PlatformSchema>
export type PlatformDetection = z.infer<typeof PlatformDetectionSchema>
export type StopReason = z.infer<typeof StopReasonSchema>
export type ReconJobResult = z.infer<typeof ReconJobResultSchema>
export type ReconSummary = z.infer<typeof ReconSummarySchema>
