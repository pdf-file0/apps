import type { Page } from 'playwright-core'
import type { PlannedAction } from '../draft/types'
import { DRAFT_FIELD_ATTR } from './WorkdaySelectors'
import type { FieldActionOutcome } from './types'

const ACTION_TIMEOUT_MS = 10_000

export interface FieldActionLogger {
  log(entry: { event: string; details?: unknown }): void
}

const refuse = (action: PlannedAction, detail: string): FieldActionOutcome => ({
  actionId: action.actionId,
  fieldId: action.fieldId,
  status: 'refused',
  detail,
  verified: false,
})

/**
 * The ONLY module that mutates form fields, and it can act solely on a plan
 * action that is (a) explicitly allowed, (b) in a fillable policy category,
 * and (c) of a fillable action type. Everything here uses plain locator
 * calls with bounded timeouts — no force option, no synthetic events, no
 * clicking of any control. It stops (returns a failed outcome) on the first
 * error; the caller decides that the whole run stops with it.
 */
export async function performFieldAction(
  page: Page,
  action: PlannedAction,
  logger: FieldActionLogger,
): Promise<FieldActionOutcome> {
  // Double gates: these hold even if a caller hands over a mislabeled action.
  if (action.allowed !== true) {
    return refuse(action, 'action not allowed by the draft plan')
  }
  if (action.policy === 'manual_review' || action.policy === 'never_auto') {
    return refuse(action, `policy ${action.policy} is human-only; the filler refuses it`)
  }
  if (action.type !== 'fill_text' && action.type !== 'select_option' && action.type !== 'check_box') {
    return refuse(action, `action type ${action.type} is not a field-fill action`)
  }
  if (action.proposedValue === null || action.proposedValue === '') {
    return refuse(action, 'no proposed value')
  }

  logger.log({
    event: 'field_action_attempt',
    details: {
      actionId: action.actionId,
      fieldId: action.fieldId,
      type: action.type,
      policy: action.policy,
      value: action.sensitive ? '[redacted]' : action.proposedValue,
    },
  })

  try {
    if (action.type === 'fill_text') {
      const locator = page.locator(`[${DRAFT_FIELD_ATTR}="${action.fieldId}"]`).first()
      await locator.fill(String(action.proposedValue), { timeout: ACTION_TIMEOUT_MS })
      const after = await locator.inputValue({ timeout: ACTION_TIMEOUT_MS })
      const verified = after === String(action.proposedValue)
      logger.log({
        event: 'field_action_done',
        details: { actionId: action.actionId, fieldId: action.fieldId, verified },
      })
      return {
        actionId: action.actionId,
        fieldId: action.fieldId,
        status: 'filled',
        detail: verified ? 'value written and read back' : 'value written but read-back differs',
        verified,
      }
    }

    if (action.type === 'select_option') {
      if (!action.exactOptionMatch) {
        return refuse(action, 'no exact option match — options are never guessed')
      }
      if (action.optionTargetKind === 'radio') {
        const radio = page
          .locator(`[${DRAFT_FIELD_ATTR}="${action.fieldId}::${action.exactOptionMatch}"]`)
          .first()
        await radio.check({ timeout: ACTION_TIMEOUT_MS })
        const verified = await radio.isChecked({ timeout: ACTION_TIMEOUT_MS })
        logger.log({
          event: 'field_action_done',
          details: { actionId: action.actionId, fieldId: action.fieldId, verified },
        })
        return {
          actionId: action.actionId,
          fieldId: action.fieldId,
          status: 'selected',
          detail: `radio option chosen by exact label match`,
          verified,
        }
      }
      const select = page.locator(`[${DRAFT_FIELD_ATTR}="${action.fieldId}"]`).first()
      await select.selectOption({ label: action.exactOptionMatch }, { timeout: ACTION_TIMEOUT_MS })
      logger.log({
        event: 'field_action_done',
        details: { actionId: action.actionId, fieldId: action.fieldId, verified: true },
      })
      return {
        actionId: action.actionId,
        fieldId: action.fieldId,
        status: 'selected',
        detail: 'dropdown option chosen by exact label match',
        verified: true,
      }
    }

    // check_box — only for safe, non-declaration boxes the plan allowed.
    const box = page.locator(`[${DRAFT_FIELD_ATTR}="${action.fieldId}"]`).first()
    await box.check({ timeout: ACTION_TIMEOUT_MS })
    const verified = await box.isChecked({ timeout: ACTION_TIMEOUT_MS })
    logger.log({
      event: 'field_action_done',
      details: { actionId: action.actionId, fieldId: action.fieldId, verified },
    })
    return {
      actionId: action.actionId,
      fieldId: action.fieldId,
      status: 'checked',
      detail: 'box checked',
      verified,
    }
  } catch (err) {
    const detail = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
    logger.log({
      event: 'field_action_failed',
      details: { actionId: action.actionId, fieldId: action.fieldId, error: detail },
    })
    return {
      actionId: action.actionId,
      fieldId: action.fieldId,
      status: 'failed',
      detail,
      verified: false,
    }
  }
}
