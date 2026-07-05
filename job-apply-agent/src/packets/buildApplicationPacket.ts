import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { selectAnswer } from '../answers/selectAnswer'
import type { AnswerSelection } from '../answers/types'
import { ConfigError } from '../config/loadConfig'
import { formatExperience } from '../experience/formatExperience'
import { selectExperience } from '../experience/selectExperience'
import { classifyRole } from '../intelligence/classifyRole'
import { selectCv } from '../intelligence/selectCv'
import { normalizeText } from '../intelligence/normalizeText'
import type {
  Bucket,
  CvRoutingConfig,
  JobRecord,
  JobsConfig,
  Warning,
} from '../intelligence/types'
import { maskEmail, maskPhone, REDACTED } from '../profile/redactProfile'
import type { AnswerBank, CandidateProfile } from '../profile/types'
import type { ApplicationPacket, PacketField } from './types'

const BLOCKING_CV_ITEM_IDS = new Set([
  'temasek_end_date',
  'cv_email_mismatch',
  'private_cv_temasek_corrections',
])

const normalizeTrackKey = (value: string): string =>
  normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim()

function resolveTrackBucket(job: JobRecord, selectedTrack: string): Bucket | null {
  if (!job.trackRouting) return null
  const wanted = normalizeTrackKey(selectedTrack)
  for (const [track, bucket] of Object.entries(job.trackRouting)) {
    if (normalizeTrackKey(track) === wanted) return bucket
  }
  return null
}

function companyHistoryKey(company: string): string {
  return normalizeText(company).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function splitName(legalName: string): { first: string; last: string } {
  const parts = legalName.trim().split(/\s+/)
  return { first: parts[0] ?? legalName, last: parts.slice(1).join(' ') || (parts[0] ?? '') }
}

export interface BuildApplicationPacketInput {
  jobId: string
  jobsConfig: JobsConfig
  cvRoutingConfig: CvRoutingConfig
  profile: CandidateProfile
  answerBank: AnswerBank
  selectedTrack?: string
}

export function buildApplicationPacket(input: BuildApplicationPacketInput): ApplicationPacket {
  const job = input.jobsConfig.jobs.find((j) => j.id === input.jobId)
  if (!job) {
    throw new ConfigError(`Job "${input.jobId}" not found in jobs config.`)
  }
  const { profile, answerBank } = input
  const warnings: Warning[] = []

  // --- Classification (offline, from the Phase 1 fixture text) -------------
  const fixturePath = path.resolve(process.cwd(), job.fixture)
  if (!existsSync(fixturePath)) {
    throw new ConfigError(`Job "${job.id}": fixture file not found: ${job.fixture}`)
  }
  const classification = classifyRole(readFileSync(fixturePath, 'utf8'), {
    id: job.id,
    company: job.company,
    url: job.url,
    platformHint: job.platformHint,
    expectedBucket: job.expectedBucket,
    programTypeHint: job.programTypeHint,
    trackRouting: job.trackRouting,
  })
  warnings.push(...classification.warnings)

  // --- Track resolution ------------------------------------------------------
  let bucket = classification.bucket
  let resolvedTrack: string | null = null
  if (bucket === 'track_dependent' && input.selectedTrack) {
    const trackBucket = resolveTrackBucket(job, input.selectedTrack)
    if (trackBucket) {
      bucket = trackBucket
      resolvedTrack = input.selectedTrack
      warnings.push({
        code: 'track_resolved',
        message: `Track "${input.selectedTrack}" resolved to bucket "${trackBucket}".`,
      })
    } else {
      warnings.push({
        code: 'unknown_track',
        message: `Selected track "${input.selectedTrack}" is not in this job's track routing; manual review required.`,
      })
    }
  }

  const cvSelection = selectCv({ ...classification, bucket }, input.cvRoutingConfig)

  // --- Experience selection --------------------------------------------------
  const experienceSelection = selectExperience({
    bucket: classification.bucket,
    jobId: job.id,
    profile,
    ...(bucket !== classification.bucket ? { resolvedTrackBucket: bucket } : {}),
  })

  // --- Candidate fields by policy category ------------------------------------
  const c = profile.candidate
  const name = splitName(c.legal_name)
  const education = profile.education[0]
  const safeAutoFillFields: PacketField[] = [
    { key: 'first_name', label: 'First name', value: name.first, sensitive: false, policy: 'safe_auto_fill' },
    { key: 'last_name', label: 'Last name', value: name.last, sensitive: false, policy: 'safe_auto_fill' },
    { key: 'full_name', label: 'Full name', value: c.legal_name, sensitive: false, policy: 'safe_auto_fill' },
    { key: 'preferred_name', label: 'Preferred name', value: c.preferred_name, sensitive: false, policy: 'safe_auto_fill' },
    { key: 'email', label: 'Email', value: c.preferred_application_email, sensitive: true, policy: 'safe_auto_fill' },
    { key: 'phone', label: 'Phone', value: c.phone, sensitive: true, policy: 'safe_auto_fill' },
    ...(c.linkedin
      ? [{ key: 'linkedin', label: 'LinkedIn', value: c.linkedin, sensitive: true, policy: 'safe_auto_fill' } as PacketField]
      : []),
    { key: 'address_line_1', label: 'Address', value: c.residential_address.line_1, sensitive: true, policy: 'safe_auto_fill' },
    { key: 'postal_code', label: 'Postal code', value: c.residential_address.postal_code, sensitive: true, policy: 'safe_auto_fill' },
    { key: 'country', label: 'Country', value: c.residential_address.country, sensitive: false, policy: 'safe_auto_fill' },
    ...(education
      ? ([
          { key: 'institution', label: 'Institution', value: education.institution, sensitive: false, policy: 'safe_auto_fill' },
          { key: 'degree', label: 'Degree', value: education.degree, sensitive: false, policy: 'safe_auto_fill' },
          { key: 'major', label: 'Major', value: education.major ?? null, sensitive: false, policy: 'safe_auto_fill' },
          { key: 'expected_graduation', label: 'Expected graduation', value: education.expected_graduation_month_year ?? education.expected_graduation_date ?? null, sensitive: false, policy: 'safe_auto_fill' },
          { key: 'gpa', label: 'GPA', value: education.gpa ?? null, sensitive: false, policy: 'safe_auto_fill' },
        ] as PacketField[])
      : []),
  ]

  const historyKey = companyHistoryKey(job.company)
  const history = profile.application_history[historyKey]
  const workAuth = profile.work_authorization['singapore']
  const autoIfConfirmedFields: PacketField[] = [
    { key: 'legally_authorized_sg', label: 'Legally authorized to work in Singapore', value: workAuth?.legally_authorized_to_work ?? null, sensitive: false, policy: 'auto_if_confirmed' },
    { key: 'requires_sponsorship', label: 'Requires visa sponsorship (now or future)', value: workAuth?.requires_visa_sponsorship_now_or_future ?? null, sensitive: false, policy: 'auto_if_confirmed' },
    { key: 'previously_applied', label: `Previously applied to ${job.company}`, value: history?.previously_applied ?? null, sensitive: false, policy: 'auto_if_confirmed', ...(history ? {} : { note: `no application_history entry "${historyKey}" — confirm manually` }) },
    { key: 'previously_worked', label: `Previously worked at ${job.company}`, value: history?.previously_worked ?? null, sensitive: false, policy: 'auto_if_confirmed' },
    { key: 'relatives_employed', label: `Relatives employed at ${job.company}`, value: history?.relatives_employed ?? null, sensitive: false, policy: 'auto_if_confirmed' },
    { key: 'can_commit_10_weeks', label: 'Can commit to 10-week internship', value: education?.can_commit_10_week_internship ?? null, sensitive: false, policy: 'auto_if_confirmed' },
    { key: 'can_commit_12_weeks', label: 'Can commit to 12-week internship', value: education?.can_commit_12_week_internship ?? null, sensitive: false, policy: 'auto_if_confirmed' },
    { key: 'penultimate_year', label: 'Penultimate year for summer 2027', value: education?.penultimate_year_for_summer_2027 ?? null, sensitive: false, policy: 'auto_if_confirmed' },
  ]

  const demographicFields: PacketField[] = Object.entries(profile.demographics)
    .filter(([key]) => key !== 'policy')
    .map(([key, entry]) => {
      const value = typeof entry === 'string' ? entry : (entry.value ?? entry.preferred_value ?? null)
      const allow = typeof entry === 'string' ? 'unknown' : String(entry.allow_auto_fill)
      return {
        key,
        label: key.replace(/_/g, ' '),
        value,
        sensitive: true,
        policy: 'demographic_exact_match_only' as const,
        note: `auto-fill only on EXACT option match (allow_auto_fill: ${allow}; policy: ${profile.demographics.policy})`,
      }
    })

  const nsItem = profile.unresolved_items.find((i) => i.id === 'national_service_status')
  const manualReviewFields: PacketField[] = [
    { key: 'salary_expectations', label: 'Salary expectations', value: null, sensitive: false, policy: 'manual_review', note: 'always a human decision' },
    { key: 'cover_letter', label: 'Cover letter upload', value: null, sensitive: false, policy: 'manual_review', note: 'not configured in Phase 3' },
    { key: 'transcript', label: 'Transcript upload', value: null, sensitive: false, policy: 'manual_review', note: 'not configured in Phase 3' },
    { key: 'national_service', label: 'National Service status', value: null, sensitive: true, policy: 'manual_review', note: nsItem?.message ?? 'not confirmed; pause if a portal asks' },
  ]

  const neverAutoFields: PacketField[] = [
    { key: 'password', label: 'Password creation', value: null, sensitive: true, policy: 'never_auto', note: `policy: ${profile.submission_policy.password_creation}` },
    { key: 'otp', label: 'OTP / email verification', value: null, sensitive: true, policy: 'never_auto', note: `policy: ${profile.submission_policy.otp_email_verification}` },
    { key: 'captcha', label: 'Captcha', value: null, sensitive: false, policy: 'never_auto', note: `policy: ${profile.submission_policy.captcha}` },
    { key: 'accept_terms', label: 'Accept terms / agreements', value: null, sensitive: false, policy: 'never_auto', note: `policy: ${profile.submission_policy.account_terms}` },
    { key: 'certify_true', label: 'Certify information is true', value: null, sensitive: false, policy: 'never_auto', note: 'human only' },
    { key: 'final_submit', label: 'Final submit', value: null, sensitive: false, policy: 'never_auto', note: `policy: ${profile.submission_policy.final_submit}` },
    { key: 'e_signature', label: 'Electronic signature', value: null, sensitive: true, policy: 'never_auto', note: 'human only' },
  ]

  // --- Suggested answers -------------------------------------------------------
  const questionList = [
    'Tell us about yourself',
    `Why do you want to work at ${job.company}?`,
    bucket === 'private_markets_ibd_deals'
      ? 'Why are you interested in investment banking?'
      : 'Why are you interested in public equities?',
    'Why Singapore?',
    'Describe a time you worked under pressure.',
    'Tell us about a leadership experience.',
    'What are your long-term career goals?',
    'What sets you apart from other candidates?',
    'Which skills do you want to develop?',
    'Which group or sector do you prefer?',
    'Walk us through an investment idea.',
    'What market trend are you following?',
  ]
  const suggestedAnswers: AnswerSelection[] = questionList.map((questionText) =>
    selectAnswer({ questionText, jobId: job.id, bucket, company: job.company, answerBank }),
  )

  // --- Readiness & manual review ----------------------------------------------
  const blockingItems = profile.unresolved_items.filter(
    (item) => item.severity === 'blocking_before_final_upload',
  )
  const cvBlocked = blockingItems.some((item) => BLOCKING_CV_ITEM_IDS.has(item.id))
  for (const item of blockingItems) {
    warnings.push({ code: `unresolved_${item.id}`, message: item.message })
  }

  const trackUnresolved = bucket === 'track_dependent'
  const notSummer = classification.warnings.some((w) => w.code === 'not_summer_internship')
  const manualReviewRequired =
    trackUnresolved ||
    classification.bucket === 'manual_review' ||
    notSummer ||
    experienceSelection.manualReviewRequired ||
    cvSelection.requiresManualReview

  const hasRequiredFactualFields =
    c.legal_name.length > 0 &&
    c.preferred_application_email.length > 0 &&
    c.phone.length > 0 &&
    profile.education.length > 0

  const fullSummary: Record<string, string> = {
    name: c.legal_name,
    preferred_name: c.preferred_name,
    email: c.preferred_application_email,
    phone: c.phone,
    linkedin: c.linkedin ?? '',
    address: `${c.residential_address.line_1}, ${c.residential_address.postal_code}, ${c.residential_address.country}`,
    date_of_birth: c.date_of_birth.iso,
    nationality: c.nationality,
    education: education ? `${education.degree} (${education.major ?? 'n/a'}), ${education.institution}` : '',
  }
  const redactedSummary: Record<string, string> = {
    ...fullSummary,
    email: maskEmail(c.preferred_application_email),
    phone: maskPhone(c.phone),
    linkedin: c.linkedin ? REDACTED : '',
    address: REDACTED,
    date_of_birth: REDACTED,
  }

  return {
    jobId: job.id,
    company: job.company,
    url: job.url,
    bucket,
    resolvedTrack,
    selectedCvKey: cvSelection.selectedCvKey,
    selectedCvHumanLabel: cvSelection.humanLabel,
    selectedCvPath: cvSelection.selectedCvPath,
    programType: classification.programType,
    warnings,
    candidateFieldSummary: { redacted: redactedSummary, full: fullSummary },
    safeAutoFillFields,
    autoIfConfirmedFields,
    demographicFields,
    manualReviewFields,
    neverAutoFields,
    selectedExperiences: experienceSelection.primary.map(formatExperience),
    secondaryExperiences: experienceSelection.secondary.map(formatExperience),
    suggestedAnswers,
    unresolvedItems: profile.unresolved_items,
    manualReviewRequired,
    readiness: {
      ready_for_dry_form_fill: hasRequiredFactualFields,
      ready_for_cv_upload: !cvBlocked,
      ready_for_final_submit: false, // Phase 3 invariant — never true
    },
  }
}
