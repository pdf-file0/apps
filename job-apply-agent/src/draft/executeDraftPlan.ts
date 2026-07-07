import type { Page } from 'playwright-core'
import { performFieldAction, type FieldActionLogger } from '../workday/WorkdayFieldFiller'
import { uploadResume, type ResumeUploadGateInput } from '../workday/WorkdayResumeUpload'
import type { FieldActionOutcome, WorkdayGuardResult } from '../workday/types'
import type { DraftPlan } from './types'

export interface ExecuteDraftPlanInput {
  page: Page
  plan: DraftPlan
  /** Re-evaluates the page guards; called before EVERY action. */
  recheckGuards: () => Promise<WorkdayGuardResult>
  logger: FieldActionLogger
  /** Present only when the whole upload chain was cleared by preflight. */
  uploadGate: ResumeUploadGateInput | null
}

/**
 * Run the allowed plan actions, one at a time, re-checking the page guards
 * before each one. Stops at the FIRST failure or the first guard trip —
 * a page that navigated into a blocked state mid-run is never touched again.
 * There is deliberately no navigation here: Phase 6 never moves between
 * form sections on its own.
 */
export async function executeDraftPlan(input: ExecuteDraftPlanInput): Promise<FieldActionOutcome[]> {
  const outcomes: FieldActionOutcome[] = []

  for (const action of input.plan.plannedActions) {
    const guard = await input.recheckGuards()
    const guardOk = action.type === 'upload_cv' ? guard.uploadAllowed : guard.mutationAllowed
    if (!guardOk) {
      const blocked = guard.blocks.map((b) => b.code).join(', ') || 'guard denied'
      input.logger.log({
        event: 'draft_run_stopped_by_guard',
        details: { actionId: action.actionId, fieldId: action.fieldId, blocks: blocked },
      })
      outcomes.push({
        actionId: action.actionId,
        fieldId: action.fieldId,
        status: 'stopped_by_guard',
        detail: `page entered a blocked state (${blocked}); run stopped`,
        verified: false,
      })
      break
    }

    let outcome: FieldActionOutcome
    if (action.type === 'upload_cv') {
      if (!input.uploadGate) {
        outcome = {
          actionId: action.actionId,
          fieldId: action.fieldId,
          status: 'refused',
          detail: 'no upload gate was cleared for this run',
          verified: false,
        }
      } else {
        outcome = await uploadResume(input.page, {
          fieldId: action.fieldId,
          gate: { ...input.uploadGate, guard },
          selectedCvHumanLabel: input.plan.selectedCvHumanLabel,
          actionId: action.actionId,
          logger: input.logger,
        })
      }
    } else {
      outcome = await performFieldAction(input.page, action, input.logger)
    }

    outcomes.push(outcome)
    if (outcome.status === 'failed') {
      input.logger.log({
        event: 'draft_run_stopped_on_failure',
        details: { actionId: action.actionId, fieldId: action.fieldId },
      })
      break
    }
  }

  return outcomes
}
