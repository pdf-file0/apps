import { z } from 'zod'

// ---------------------------------------------------------------------------
// Document manifest — a HUMAN-maintained declaration of what each document
// (CV PDF, transcript, …) currently shows. Phase 5 never opens or parses the
// PDFs: the human declares their contents here and the readiness gate compares
// those declarations against the source of truth (profile + expected values).
// ---------------------------------------------------------------------------

export const DocumentKindSchema = z.enum(['cv', 'cover_letter', 'transcript', 'certificate', 'other'])

/** End dates are declared in a normalized form so comparison stays exact. */
const END_DATE_SHOWN_PATTERN = /^(\d{4}-(0[1-9]|1[0-2])|Present|TBD)$/

export const ExperienceShownSchema = z
  .object({
    experience_id: z.string().min(1),
    end_date_shown: z
      .string()
      .regex(END_DATE_SHOWN_PATTERN, 'must be "YYYY-MM", "Present", or "TBD"'),
  })
  .strict()

/**
 * Deal statistics as printed on a private-markets CV. Real figures belong in
 * the gitignored *.local.yaml manifest, never in committed code or examples.
 */
export const PrivateMarketsStatsSchema = z
  .object({
    live_investment_deals: z.number().int().nonnegative(),
    direct_investments: z.number().int().nonnegative(),
    fund_investments: z.number().int().nonnegative(),
    series_h_investment_usd_millions: z.number().positive().optional(),
    series_h_round_size_usd_billions: z.number().positive(),
    series_h_company_descriptor: z.string().min(1),
  })
  .strict()

export const DocumentCvBucketSchema = z.enum([
  'public_equities_markets_research',
  'private_markets_ibd_deals',
])

export const DocumentEntrySchema = z
  .object({
    key: z.string().min(1),
    kind: DocumentKindSchema,
    human_label: z.string().min(1),
    path: z.string().min(1),
    cv_bucket: DocumentCvBucketSchema.optional(),
    /** The email address printed on the document. */
    email_shown: z.string().email().optional(),
    /** Experience end dates as printed on the document, in normalized form. */
    experiences_shown: z.array(ExperienceShownSchema).optional(),
    /** Stats printed on a private-markets CV; null = corrections not applied yet. */
    private_markets_stats_shown: PrivateMarketsStatsSchema.nullable().optional(),
    notes: z.string().optional(),
  })
  .strict()
  .refine((doc) => doc.kind !== 'cv' || doc.email_shown !== undefined, {
    message: 'a CV document must declare email_shown (the email printed on the CV)',
  })
  .refine((doc) => doc.kind !== 'cv' || doc.cv_bucket !== undefined, {
    message: 'a CV document must declare cv_bucket',
  })

export const NationalServiceStatusSchema = z.enum(['unknown', 'resolved'])

export const DocumentManifestSchema = z
  .object({
    expected_application_email: z.string().email(),
    national_service_status: NationalServiceStatusSchema,
    required_cv_keys: z.array(z.string().min(1)).min(1),
    expected_private_markets_stats: PrivateMarketsStatsSchema.optional(),
    documents: z.array(DocumentEntrySchema).min(1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>()
    manifest.documents.forEach((doc, index) => {
      if (seen.has(doc.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documents', index, 'key'],
          message: `duplicate document key "${doc.key}"`,
        })
      }
      seen.add(doc.key)
    })
    manifest.required_cv_keys.forEach((key, index) => {
      if (!seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['required_cv_keys', index],
          message: `references unknown document "${key}"`,
        })
      }
    })
  })
