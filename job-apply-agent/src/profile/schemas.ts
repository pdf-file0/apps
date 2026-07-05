import { z } from 'zod'
import { BucketSchema } from '../config/schemas'

// ---------------------------------------------------------------------------
// Candidate identity
// ---------------------------------------------------------------------------

export const AddressSchema = z
  .object({
    line_1: z.string().min(1),
    line_2: z.string().optional(),
    postal_code: z.string().min(1),
    country: z.string().min(1),
  })
  .strict()

export const DateOfBirthSchema = z
  .object({
    iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    display_sg_format: z.string().min(1),
  })
  .strict()

export const CandidateIdentitySchema = z
  .object({
    legal_name: z.string().min(1),
    preferred_name: z.string().min(1),
    preferred_application_email: z.string().email(),
    phone: z.string().min(4),
    linkedin: z.string().url().optional(),
    residential_address: AddressSchema,
    nationality: z.string().min(1),
    citizenship: z.string().min(1),
    date_of_birth: DateOfBirthSchema,
  })
  .strict()

// ---------------------------------------------------------------------------
// Work authorization / education / history / portals
// ---------------------------------------------------------------------------

export const WorkAuthorizationEntrySchema = z
  .object({
    status: z.string().min(1),
    legally_authorized_to_work: z.boolean(),
    requires_visa_sponsorship_now_or_future: z.boolean(),
  })
  .strict()

export const EducationEntrySchema = z
  .object({
    institution: z.string().min(1),
    degree: z.string().min(1),
    major: z.string().optional(),
    start_date: z.string().optional(),
    expected_graduation_date: z.string().optional(),
    expected_graduation_month_year: z.string().optional(),
    gpa: z.string().optional(),
    honours: z.string().optional(),
    penultimate_year_for_summer_2027: z.boolean().optional(),
    can_commit_10_week_internship: z.boolean().optional(),
    can_commit_12_week_internship: z.boolean().optional(),
    competitions: z.array(z.string()).optional(),
  })
  .strict()

export const ApplicationHistoryEntrySchema = z
  .object({
    previously_applied: z.boolean(),
    previously_worked: z.boolean(),
    relatives_employed: z.boolean(),
  })
  .strict()

export const PortalAccountSchema = z
  .object({
    status: z.enum(['not_created', 'created', 'unknown']),
    email: z.string().email(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Demographics — auto-fill only ever on exact option match, per entry opt-in
// ---------------------------------------------------------------------------

export const DemographicEntrySchema = z
  .object({
    value: z.string().optional(),
    preferred_value: z.string().optional(),
    fallback_if_chinese_unavailable: z.string().optional(),
    allow_auto_fill: z.union([z.boolean(), z.literal('true_if_wording_is_clear')]),
  })
  .strict()
  .refine((entry) => entry.value !== undefined || entry.preferred_value !== undefined, {
    message: 'demographic entry needs value or preferred_value',
  })

export const DemographicsSchema = z
  .object({ policy: z.string().min(1) })
  .catchall(DemographicEntrySchema)

// ---------------------------------------------------------------------------
// Candidate-level submission policy. The dangerous actions are LITERALS:
// any attempt to configure them as automatic fails validation.
// ---------------------------------------------------------------------------

export const ProfileSubmissionPolicySchema = z
  .object({
    cv_upload: z.string().min(1),
    ats_parse: z.string().min(1),
    parsed_field_correction: z.string().min(1),
    non_sensitive_questions: z.string().min(1),
    work_authorization_questions: z.string().min(1),
    demographic_questions: z.string().min(1),
    password_creation: z.literal('manual'),
    otp_email_verification: z.literal('manual'),
    captcha: z.literal('manual'),
    account_terms: z.literal('manual_review'),
    final_submit: z.literal('explicit_approval_only'),
  })
  .strict()

export const UnresolvedItemSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['blocking_before_final_upload', 'manual_review_if_asked', 'info']),
    message: z.string().min(1),
  })
  .strict()

// ---------------------------------------------------------------------------
// Experience bank
// ---------------------------------------------------------------------------

export const ExperienceSchema = z
  .object({
    id: z.string().min(1),
    employer: z.string().optional(),
    organization: z.string().optional(),
    title: z.string().min(1),
    start_date: z.string().min(1),
    end_date: z.string().min(1), // "YYYY-MM", "Present", or "TBD"
    current_role: z.boolean().optional(),
    location: z.string().min(1),
    type: z.enum(['work_experience', 'leadership_activity']),
    cv_bucket_emphasis: z.array(BucketSchema).min(1),
    status_note: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    corrected_source_of_truth: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    short_description: z.string().min(1),
    bullets: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((exp) => exp.employer !== undefined || exp.organization !== undefined, {
    message: 'experience needs employer (work) or organization (activity)',
  })

// ---------------------------------------------------------------------------
// Full profile file
// ---------------------------------------------------------------------------

export const CandidateProfileFileSchema = z
  .object({
    candidate: CandidateIdentitySchema,
    work_authorization: z.record(z.string(), WorkAuthorizationEntrySchema),
    education: z.array(EducationEntrySchema).min(1),
    application_history: z.record(z.string(), ApplicationHistoryEntrySchema),
    portal_accounts: z.record(z.string(), PortalAccountSchema),
    demographics: DemographicsSchema,
    target_role_ranking: z.record(z.string(), z.number().int()),
    gic_track_ranking: z.record(z.string(), z.number().int()),
    submission_policy: ProfileSubmissionPolicySchema,
    unresolved_items: z.array(UnresolvedItemSchema),
    experiences: z.array(ExperienceSchema).min(1),
  })
  .strict()

// ---------------------------------------------------------------------------
// Answer bank
// ---------------------------------------------------------------------------

export const AnswerBankEntrySchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['draft', 'approved']),
    requires_review: z.boolean(),
    allow_auto_use_later_phase: z.boolean(),
    unapproved_story_requires_user_confirmation: z.boolean().optional(),
    text: z.string().min(1),
  })
  .strict()
  .refine((entry) => !(entry.allow_auto_use_later_phase && entry.status === 'draft'), {
    message: 'a draft answer can never be marked allow_auto_use_later_phase',
  })

export const AnswerBankSchema = z
  .object({
    answers: z.array(AnswerBankEntrySchema).min(1),
  })
  .strict()
  .superRefine((bank, ctx) => {
    const seen = new Set<string>()
    bank.answers.forEach((answer, index) => {
      if (seen.has(answer.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answers', index, 'id'],
          message: `duplicate answer id "${answer.id}"`,
        })
      }
      seen.add(answer.id)
    })
  })
