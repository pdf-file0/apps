import { z } from 'zod'

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export const BUCKET_VALUES = [
  'public_equities_markets_research',
  'private_markets_ibd_deals',
  'track_dependent',
  'manual_review',
] as const

export const BucketSchema = z.enum(BUCKET_VALUES)
export const ConfidenceSchema = z.enum(['high', 'medium', 'low'])
export const ProgramTypeSchema = z.enum([
  'summer_internship',
  'internship',
  'new_analyst_full_time',
  'unknown',
])

export const WarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()

// ---------------------------------------------------------------------------
// jobs.yaml
// ---------------------------------------------------------------------------

export const JobRecordSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    company: z.string().min(1),
    platformHint: z.string().optional(),
    // Phase 1 is offline: every job points at a local fixture text file.
    fixture: z.string().min(1),
    // Tie-break only: used when keyword scores are ambiguous, never to skip scoring.
    expectedBucket: BucketSchema.optional(),
    programTypeHint: ProgramTypeSchema.optional(),
    // For multi-track applications (e.g. GIC): track name -> bucket.
    trackRouting: z.record(z.string(), BucketSchema).optional(),
    notes: z.string().optional(),
  })
  .strict()

export const JobsConfigSchema = z
  .object({
    jobs: z.array(JobRecordSchema).min(1),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>()
    cfg.jobs.forEach((job, index) => {
      if (seen.has(job.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['jobs', index, 'id'],
          message: `duplicate job id "${job.id}"`,
        })
      }
      seen.add(job.id)
    })
  })

// ---------------------------------------------------------------------------
// cv_routing.yaml
// ---------------------------------------------------------------------------

export const CvDefinitionSchema = z
  .object({
    humanLabel: z.string().min(1),
    path: z.string().min(1),
  })
  .strict()

export const BucketRouteSchema = z
  .object({
    // null = no CV can be auto-selected for this bucket (manual handling).
    cv: z.string().min(1).nullable(),
    humanLabel: z.string().min(1).optional(),
    requiresManualReview: z.boolean().optional(),
  })
  .strict()

export const CvRoutingConfigSchema = z
  .object({
    cvs: z.record(z.string(), CvDefinitionSchema),
    buckets: z.record(BucketSchema, BucketRouteSchema),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    for (const bucket of BUCKET_VALUES) {
      if (!(bucket in cfg.buckets)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buckets', bucket],
          message: `missing route for bucket "${bucket}"`,
        })
      }
    }
    for (const [bucket, route] of Object.entries(cfg.buckets)) {
      if (route === undefined) continue
      if (route.cv !== null && !(route.cv in cfg.cvs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buckets', bucket, 'cv'],
          message: `references unknown cv "${route.cv}" (known: ${Object.keys(cfg.cvs).join(', ')})`,
        })
      }
      if (route.cv === null && !route.humanLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buckets', bucket, 'humanLabel'],
          message: 'humanLabel is required when cv is null',
        })
      }
    }
  })

// ---------------------------------------------------------------------------
// submission_policy.yaml — Phase 1 hard-locks every risky action to false.
// Changing any of these in config is a validation error, not a feature flag.
// ---------------------------------------------------------------------------

export const SubmissionPolicySchema = z
  .object({
    phase: z.literal(1),
    autoSubmit: z.literal(false),
    allowAccountCreation: z.literal(false),
    allowDocumentUpload: z.literal(false),
    allowFinalSubmit: z.literal(false),
    requireHumanConfirmation: z.literal(true),
    notes: z.string().optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// candidate_profile.schema.yaml
// ---------------------------------------------------------------------------

export const ProfileFieldSchema = z
  .object({
    type: z.string().min(1),
    required: z.boolean().optional(),
    pii: z.boolean().optional(),
  })
  .strict()

export const CandidateProfileConfigSchema = z
  .object({
    applicationEmail: z.string().email(),
    piiPolicy: z.string().optional(),
    profileFields: z.record(z.string(), ProfileFieldSchema).optional(),
    documentWarnings: z.array(WarningSchema),
  })
  .strict()

// ---------------------------------------------------------------------------
// Classification output + run summary
// ---------------------------------------------------------------------------

export const ClassificationSchema = z
  .object({
    bucket: BucketSchema,
    confidence: ConfidenceSchema,
    matchedTerms: z.array(z.string()),
    rationale: z.string().min(1),
    warnings: z.array(WarningSchema),
    programType: ProgramTypeSchema,
  })
  .strict()

export const CvSelectionSchema = z
  .object({
    selectedCvKey: z.string().nullable(),
    selectedCvPath: z.string().nullable(),
    humanLabel: z.string().min(1),
    requiresManualReview: z.boolean(),
    reason: z.string().min(1),
  })
  .strict()

export const JobResultSchema = z
  .object({
    jobId: z.string().min(1),
    company: z.string().min(1),
    url: z.string().url(),
    platformHint: z.string().optional(),
    classification: ClassificationSchema,
    cvSelection: CvSelectionSchema,
    trackRouting: z.record(z.string(), BucketSchema).optional(),
  })
  .strict()

export const RunSummarySchema = z
  .object({
    phase: z.literal(1),
    mode: z.literal('classification_only'),
    jobsFile: z.string().min(1),
    totals: z
      .object({
        jobs: z.number().int().nonnegative(),
        byBucket: z.record(BucketSchema, z.number().int().nonnegative()),
        manualReviewCount: z.number().int().nonnegative(),
        warningsCount: z.number().int().nonnegative(),
      })
      .strict(),
    candidateDocumentWarnings: z.array(WarningSchema),
    results: z.array(JobResultSchema),
  })
  .strict()
