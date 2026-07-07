import { selectAnswer } from '../answers/selectAnswer'
import { classifyField } from '../fieldPolicy/classifyField'
import type { FieldPolicyCategory } from '../fieldPolicy/types'
import type { Bucket } from '../intelligence/types'
import type { ApplicationPacket, PacketField } from '../packets/types'
import type { AnswerBank } from '../profile/types'
import { normalizeLabel } from '../reconnaissance/findApplyCta'
import type { MappedWorkdayField, ScannedWorkdayField } from './types'

/**
 * Workday label → canonical packet-field key. Patterns run against the
 * normalized "section + label" haystack; first match wins. A key match only
 * ever BINDS a value — the policy category still comes from the packet field
 * (and the field-policy classifier can only make it stricter, never looser).
 */
const KEY_PATTERNS: readonly { key: string; pattern: RegExp }[] = [
  { key: 'first_name', pattern: /\b(first|given) name\b/ },
  { key: 'last_name', pattern: /\b(last|family) name\b|\bsurname\b/ },
  { key: 'full_name', pattern: /\bfull (legal )?name\b|\blegal name\b/ },
  { key: 'preferred_name', pattern: /\bpreferred name\b/ },
  { key: 'email', pattern: /\be-?mail\b/ },
  { key: 'phone', pattern: /\bphone\b|\bmobile\b|\bcontact number\b/ },
  { key: 'linkedin', pattern: /\blinkedin\b/ },
  { key: 'address_line_1', pattern: /\baddress line 1\b|\bstreet address\b|\baddress\b/ },
  { key: 'postal_code', pattern: /\bpostal code\b|\bzip( code)?\b/ },
  { key: 'country', pattern: /\bcountry( of residence)?\b/ },
  { key: 'institution', pattern: /\b(school|university|institution|college)\b/ },
  { key: 'degree', pattern: /\bdegree\b/ },
  { key: 'major', pattern: /\bmajor\b|\bfield of study\b/ },
  { key: 'expected_graduation', pattern: /\bgraduation\b/ },
  { key: 'gpa', pattern: /\bgpa\b|\bgrade point average\b/ },
  { key: 'legally_authorized_sg', pattern: /\blegally auth\w* to work\b|\bright to work\b|\bwork authori[sz]ation\b/ },
  { key: 'requires_sponsorship', pattern: /\bsponsorship\b/ },
  { key: 'previously_applied', pattern: /\bpreviously applied\b|\bapplied (to .{0,30})?before\b/ },
  { key: 'previously_worked', pattern: /\bpreviously (worked|employed)\b|\bever worked (at|for)\b/ },
  { key: 'relatives_employed', pattern: /\brelatives?\b|\bfamily members?\b/ },
  { key: 'can_commit_10_weeks', pattern: /\b10[\s-]?week\b/ },
  { key: 'can_commit_12_weeks', pattern: /\b12[\s-]?week\b/ },
  { key: 'penultimate_year', pattern: /\bpenultimate\b/ },
  { key: 'national_service', pattern: /\bnational service\b|\bns status\b/ },
  { key: 'salary_expectations', pattern: /\bsalary\b|\bcompensation expectation\b|\bexpected pay\b/ },
  { key: 'cover_letter', pattern: /\bcover letter\b/ },
  { key: 'transcript', pattern: /\btranscript\b/ },
]

const POLICY_STRICTNESS: readonly FieldPolicyCategory[] = [
  'never_auto',
  'demographic_exact_match_only',
  'manual_review',
  'auto_if_confirmed',
  'safe_auto_fill',
]

const stricterOf = (a: FieldPolicyCategory, b: FieldPolicyCategory): FieldPolicyCategory =>
  POLICY_STRICTNESS.indexOf(a) <= POLICY_STRICTNESS.indexOf(b) ? a : b

/** Looks like a question inviting free text (essay), not a data field. */
const isOpenEndedQuestion = (field: ScannedWorkdayField): boolean =>
  field.inputType === 'textarea' &&
  (/\?\s*$/.test(field.label) || /\b(why|describe|tell us|explain|what)\b/i.test(field.label))

function packetFieldIndex(packet: ApplicationPacket): Map<string, PacketField> {
  const index = new Map<string, PacketField>()
  for (const field of [
    ...packet.safeAutoFillFields,
    ...packet.autoIfConfirmedFields,
    ...packet.demographicFields,
    ...packet.manualReviewFields,
    ...packet.neverAutoFields,
  ]) {
    index.set(field.key, field)
  }
  return index
}

function findExactOption(
  options: string[],
  value: string | boolean | null,
): string | null {
  if (value === null) return null
  const wanted =
    typeof value === 'boolean' ? (value ? 'yes' : 'no') : normalizeLabel(String(value))
  return options.find((option) => normalizeLabel(option) === wanted) ?? null
}

export interface MapWorkdayFieldsInput {
  fields: ScannedWorkdayField[]
  packet: ApplicationPacket
  answerBank: AnswerBank
  company: string
  jobId: string
  bucket: Bucket
}

/**
 * Bind each scanned field to a policy category and (when safe) a proposed
 * value. Guarantees, in order:
 *  1. The field-policy classifier's category can only be tightened, never
 *     loosened, by a key match.
 *  2. A field with no confident key match and no classifier match is
 *     manual_review — the system never guesses that an unknown field is safe.
 *  3. Values come exclusively from the Phase 3 packet (already validated) or
 *     the answer bank (as suggestions only).
 */
export function mapWorkdayFields(input: MapWorkdayFieldsInput): MappedWorkdayField[] {
  const packetIndex = packetFieldIndex(input.packet)

  return input.fields.map((field): MappedWorkdayField => {
    const haystack = normalizeLabel(`${field.sectionHeading ?? ''} ${field.label}`)
    const classification = classifyField(field.label, {
      ...(field.sectionHeading ? { section: field.sectionHeading } : {}),
    })
    const keyMatch = KEY_PATTERNS.find((entry) => entry.pattern.test(haystack)) ?? null
    const packetField = keyMatch ? (packetIndex.get(keyMatch.key) ?? null) : null

    // Demographic packet keys (gender, race_ethnicity, …) have no KEY_PATTERNS
    // entry; the classifier catches them and the packet's demographic fields
    // are matched by their key name appearing in the label.
    let demographicField: PacketField | null = null
    if (classification.category === 'demographic_exact_match_only') {
      demographicField =
        input.packet.demographicFields.find((f) =>
          normalizeLabel(field.label).includes(normalizeLabel(f.key.replace(/_/g, ' '))),
        ) ??
        input.packet.demographicFields.find((f) => f.key === keyMatch?.key) ??
        null
    }

    // File inputs never take a typed value. A resume/CV input is tagged so
    // the plan can route it through the (separately gated) upload path;
    // every other file input stays manual (transcript, cover letter, …).
    if (field.inputType === 'file') {
      const resumeLike = /\bresume\b|\bcv\b|curriculum vitae/i.test(haystack)
      return {
        field,
        normalizedKey: resumeLike ? 'cv_upload' : keyMatch?.key ?? null,
        policy: 'manual_review',
        profileSourcePath: null,
        proposedValue: null,
        sensitive: false,
        exactOptionMatch: null,
        confidence: resumeLike ? 'high' : 'low',
        reason: resumeLike
          ? 'resume/CV file input — upload is gated separately (flag + clean documents + verified account)'
          : 'non-resume file input — manual only in Phase 6',
        suggestedAnswerId: null,
        suggestedAnswerRequiresReview: null,
      }
    }

    // Open-ended questions: answer bank proposes drafts only.
    if (isOpenEndedQuestion(field) && classification.category !== 'never_auto') {
      const selection = selectAnswer({
        questionText: field.label,
        jobId: input.jobId,
        bucket: input.bucket,
        company: input.company,
        answerBank: input.answerBank,
      })
      return {
        field,
        normalizedKey: 'open_ended_question',
        policy: 'manual_review',
        profileSourcePath: selection.answerId ? `answer_bank:${selection.answerId}` : null,
        proposedValue: null, // draft text stays in the answer bank, never auto-proposed as a value
        sensitive: false,
        exactOptionMatch: null,
        confidence: selection.confidence,
        reason: `open-ended question; ${selection.reason}`,
        suggestedAnswerId: selection.answerId,
        suggestedAnswerRequiresReview: selection.requiresReview,
      }
    }

    if (classification.matchedAlias !== null || packetField || demographicField) {
      const source = demographicField ?? packetField
      const policy = source
        ? stricterOf(classification.matchedAlias !== null ? classification.category : source.policy, source.policy)
        : classification.category
      const proposedValue = source && policy !== 'never_auto' && policy !== 'manual_review' ? source.value : null
      return {
        field,
        normalizedKey: demographicField?.key ?? keyMatch?.key ?? null,
        policy,
        profileSourcePath: source ? `packet:${source.key}` : null,
        proposedValue,
        sensitive: source?.sensitive ?? true,
        exactOptionMatch:
          field.options.length > 0 ? findExactOption(field.options, proposedValue) : null,
        confidence: source && classification.matchedAlias !== null ? 'high' : source ? 'medium' : 'high',
        reason: source
          ? `${classification.reason}; value bound to packet field "${source.key}"`
          : classification.reason,
        suggestedAnswerId: null,
        suggestedAnswerRequiresReview: null,
      }
    }

    // No classifier match and no key match: never assume safe.
    return {
      field,
      normalizedKey: null,
      policy: 'manual_review',
      profileSourcePath: null,
      proposedValue: null,
      sensitive: true,
      exactOptionMatch: null,
      confidence: 'low',
      reason: 'unmapped field — label could not be confidently mapped; manual review required',
      suggestedAnswerId: null,
      suggestedAnswerRequiresReview: null,
    }
  })
}
