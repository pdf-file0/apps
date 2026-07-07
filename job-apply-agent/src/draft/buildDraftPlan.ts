import type { FieldPolicyCategory } from '../fieldPolicy/types'
import type { JobRecord, Warning } from '../intelligence/types'
import type { ApplicationPacket } from '../packets/types'
import type { AnswerBank } from '../profile/types'
import type { DocumentReadiness } from '../documents/types'
import type { MappedWorkdayField, WorkdayGuardResult } from '../workday/types'
import type {
  DraftActionType,
  DraftFlags,
  DraftPlan,
  PlannedAction,
  PreflightResult,
  ScannedFieldsSummary,
} from './types'

export interface BuildDraftPlanInput {
  job: JobRecord
  packet: ApplicationPacket
  answerBank: AnswerBank
  documentReadiness: DocumentReadiness
  mappedFields: MappedWorkdayField[]
  guard: WorkdayGuardResult
  preflight: PreflightResult
  flags: DraftFlags
}

const fillTypeFor = (mapped: MappedWorkdayField): DraftActionType => {
  switch (mapped.field.inputType) {
    case 'select':
    case 'radio':
      return 'select_option'
    case 'checkbox':
      return 'check_box'
    case 'file':
      return 'upload_cv'
    default:
      return 'fill_text'
  }
}

const asString = (value: string | boolean | null): string | null =>
  value === null ? null : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)

/**
 * Turn mapped fields into an explicit, reviewable action list. Nothing is
 * ever "implicitly" filled: an action is allowed only when its policy
 * category, the matching CLI flag, the preflight capability, the page
 * guards, and (for options) an exact option match ALL agree.
 */
export function buildDraftPlan(input: BuildDraftPlanInput): DraftPlan {
  const { packet, guard, preflight, flags } = input
  const warnings: Warning[] = [...preflight.warnings]
  const actions: PlannedAction[] = []
  let actionIndex = 0

  for (const mapped of input.mappedFields) {
    const base = {
      actionId: `a${actionIndex++}`,
      fieldId: mapped.field.fieldId,
      fieldLabel: mapped.field.label,
      normalizedKey: mapped.normalizedKey,
      profileSourcePath: mapped.profileSourcePath,
      policy: mapped.policy,
      sensitive: mapped.sensitive,
      confidence: mapped.confidence,
      exactOptionMatch: mapped.exactOptionMatch,
      optionTargetKind:
        mapped.field.inputType === 'radio'
          ? ('radio' as const)
          : mapped.field.inputType === 'select'
            ? ('select' as const)
            : null,
      suggestedAnswerId: mapped.suggestedAnswerId,
    }

    // --- CV upload (file inputs) — gated entirely by the upload chain -------
    if (mapped.field.inputType === 'file') {
      if (mapped.normalizedKey === 'cv_upload') {
        const allowed = preflight.canUploadCv && guard.uploadAllowed && !flags.inspectOnly
        actions.push({
          ...base,
          type: flags.inspectOnly ? 'inspect_only' : 'upload_cv',
          proposedValue: packet.selectedCvKey,
          allowed,
          reason: allowed
            ? `upload allowed: documents clean, account verified, routed CV "${packet.selectedCvKey}"`
            : flags.inspectOnly
              ? 'inspect-only mode: no mutation'
              : !flags.allowCvUpload
                ? 'CV upload requires the explicit --allow-cv-upload flag'
                : !preflight.canUploadCv
                  ? 'preflight denied CV upload (documents/account/file gates)'
                  : 'page guards deny upload on this page',
        })
      } else {
        actions.push({
          ...base,
          type: 'skip_manual_review',
          proposedValue: null,
          allowed: false,
          reason: mapped.reason,
        })
      }
      continue
    }

    // --- never_auto: recorded, never acted on --------------------------------
    if (mapped.policy === 'never_auto') {
      actions.push({
        ...base,
        type: 'skip_never_auto',
        proposedValue: null,
        allowed: false,
        reason: mapped.reason,
      })
      continue
    }

    // --- Open-ended questions: draft answers stay drafts by default ----------
    if (mapped.normalizedKey === 'open_ended_question') {
      const answer = mapped.suggestedAnswerId
        ? (input.answerBank.answers.find((a) => a.id === mapped.suggestedAnswerId) ?? null)
        : null
      const answerUsable =
        answer !== null && answer.requires_review === false && answer.status === 'approved'
      const allowed =
        flags.fillDraftAnswers &&
        answerUsable &&
        preflight.canFillSafeFields &&
        guard.mutationAllowed &&
        !flags.inspectOnly
      if (flags.fillDraftAnswers && answer && !answerUsable) {
        warnings.push({
          code: 'draft_answer_review_gated',
          message: `Answer "${answer.id}" is review-gated (requires_review/draft) — never auto-filled.`,
        })
      }
      actions.push({
        ...base,
        type: allowed ? 'fill_text' : flags.inspectOnly ? 'inspect_only' : 'skip_manual_review',
        proposedValue: allowed ? (answer?.text ?? null) : null,
        allowed,
        reason: allowed
          ? `approved answer "${answer?.id}" with requires_review=false and explicit --fill-draft-answers`
          : mapped.suggestedAnswerId
            ? `open-ended question; draft answer "${mapped.suggestedAnswerId}" proposed for HUMAN review only`
            : 'open-ended question with no matched answer — human writes this',
      })
      continue
    }

    // --- manual_review: recorded for the human -------------------------------
    if (mapped.policy === 'manual_review') {
      actions.push({
        ...base,
        type: 'skip_manual_review',
        proposedValue: null,
        allowed: false,
        reason: mapped.reason,
      })
      continue
    }

    // --- Fillable categories --------------------------------------------------
    const value = asString(mapped.proposedValue)
    const type = fillTypeFor(mapped)
    const needsOption = type === 'select_option'
    const optionOk = !needsOption || mapped.exactOptionMatch !== null
    const checkboxOk = type !== 'check_box' || mapped.proposedValue === true

    let capability = false
    let capabilityReason = ''
    if (mapped.policy === 'safe_auto_fill') {
      capability = preflight.canFillSafeFields
      capabilityReason = flags.fillSafeFields
        ? 'preflight denied safe-field filling'
        : 'safe fields fill only with the explicit --fill-safe-fields flag'
    } else if (mapped.policy === 'auto_if_confirmed') {
      capability = preflight.canFillConfirmedFields
      capabilityReason = flags.fillConfirmedFields
        ? 'preflight denied confirmed-field filling'
        : 'confirmed fields fill only with the explicit --fill-confirmed-fields flag'
    } else {
      // demographic_exact_match_only
      const packetAllows = /allow_auto_fill: true\b/.test(
        input.packet.demographicFields.find((f) => f.key === mapped.normalizedKey)?.note ?? '',
      )
      capability =
        flags.fillDemographics && preflight.canFillSafeFields && packetAllows
      capabilityReason = !flags.fillDemographics
        ? 'demographics fill only with the explicit --fill-demographics flag'
        : !packetAllows
          ? 'profile does not allow auto-fill for this demographic entry'
          : 'preflight denied filling'
    }

    const allowed =
      capability &&
      guard.mutationAllowed &&
      value !== null &&
      optionOk &&
      checkboxOk &&
      !flags.inspectOnly

    actions.push({
      ...base,
      type: flags.inspectOnly ? 'inspect_only' : type,
      proposedValue: value,
      allowed,
      reason: allowed
        ? `${mapped.policy} value from ${mapped.profileSourcePath ?? 'profile'} (${mapped.reason})`
        : flags.inspectOnly
          ? 'inspect-only mode: no mutation'
          : !capability
            ? capabilityReason
            : !guard.mutationAllowed
              ? 'page guards block mutation on this page'
              : value === null
                ? 'no confirmed value in the profile — never guessed'
                : !optionOk
                  ? 'no EXACT option match — options are never guessed'
                  : 'confirmed value is negative; a checkbox is never ticked for it',
    })
  }

  const byPolicy: Record<FieldPolicyCategory, number> = {
    safe_auto_fill: 0,
    auto_if_confirmed: 0,
    demographic_exact_match_only: 0,
    manual_review: 0,
    never_auto: 0,
  }
  let unmappedCount = 0
  for (const mapped of input.mappedFields) {
    byPolicy[mapped.policy] += 1
    if (mapped.normalizedKey === null) unmappedCount += 1
  }
  const scannedFieldsSummary: ScannedFieldsSummary = {
    total: input.mappedFields.length,
    byPolicy,
    unmappedCount,
  }

  if (!guard.mutationAllowed && !flags.inspectOnly) {
    warnings.push({
      code: 'page_guards_block_mutation',
      message: `Page guards block mutation (${guard.blocks.map((b) => b.code).join(', ') || 'none'}).`,
    })
  }

  return {
    jobId: input.job.id,
    company: input.job.company,
    url: input.job.url,
    bucket: packet.bucket,
    selectedCvKey: packet.selectedCvKey,
    selectedCvHumanLabel: packet.selectedCvHumanLabel,
    selectedCvPath: packet.selectedCvPath,
    mode: flags.inspectOnly ? 'inspect_only' : 'draft_fill',
    pageKind: guard.pageKind,
    guard,
    preflight,
    scannedFieldsSummary,
    plannedActions: actions.filter((a) => a.allowed),
    blockedActions: actions.filter(
      (a) => !a.allowed && a.type !== 'skip_manual_review' && a.type !== 'skip_never_auto',
    ),
    manualReviewItems: actions.filter((a) => a.type === 'skip_manual_review'),
    neverAutoItems: actions.filter((a) => a.type === 'skip_never_auto'),
    warnings,
    readiness: {
      ready_for_dry_form_fill: packet.readiness.ready_for_dry_form_fill,
      ready_for_cv_upload: input.documentReadiness.ready_for_cv_upload,
      ready_for_final_submit: false,
    },
    canSubmitFinal: false,
  }
}
