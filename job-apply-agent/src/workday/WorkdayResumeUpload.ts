import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright-core'
import { ConfigError } from '../config/loadConfig'
import type { DocumentReadiness } from '../documents/types'
import type { Bucket, CvRoutingConfig } from '../intelligence/types'
import { DRAFT_FIELD_ATTR } from './WorkdaySelectors'
import type { FieldActionOutcome, WorkdayGuardResult } from './types'
import type { FieldActionLogger } from './WorkdayFieldFiller'

const UPLOAD_TIMEOUT_MS = 20_000

export interface ResumeUploadGateInput {
  /** The explicit --allow-cv-upload CLI flag. */
  allowCvUploadFlag: boolean
  documentReadiness: DocumentReadiness
  selectedCvKey: string | null
  selectedCvPath: string | null
  jobBucket: Bucket
  cvRouting: CvRoutingConfig
  guard: WorkdayGuardResult
  /** Injectable for tests; defaults to the real filesystem. */
  fileExists?: (p: string) => boolean
}

/**
 * Every one of these gates must pass or the upload is refused. Fail-closed:
 * the first unmet condition throws with the reason.
 */
export function assertResumeUploadAllowed(input: ResumeUploadGateInput): void {
  const fileExists = input.fileExists ?? existsSync
  if (!input.allowCvUploadFlag) {
    throw new ConfigError('CV upload refused: --allow-cv-upload was not passed.')
  }
  if (!input.documentReadiness.ready_for_cv_upload) {
    const blockers = input.documentReadiness.blockers
      .map((b) => `[${b.code}]${b.documentKey ? ` (${b.documentKey})` : ''}`)
      .join(', ')
    throw new ConfigError(`CV upload refused: document readiness is BLOCKED — ${blockers}.`)
  }
  if (!input.selectedCvKey || !input.selectedCvPath) {
    throw new ConfigError('CV upload refused: no CV is routed for this job bucket.')
  }
  const routedCv = input.cvRouting.buckets[input.jobBucket]?.cv ?? null
  if (routedCv !== input.selectedCvKey) {
    throw new ConfigError(
      `CV upload refused: selected CV "${input.selectedCvKey}" does not match the routed CV ` +
        `for bucket "${input.jobBucket}" (${routedCv ?? 'none'}).`,
    )
  }
  if (!fileExists(input.selectedCvPath)) {
    throw new ConfigError(
      `CV upload refused: CV file not found at ${input.selectedCvPath} (documents/ is local-only).`,
    )
  }
  if (input.guard.pageKind !== 'resume_upload') {
    throw new ConfigError(
      `CV upload refused: current page is "${input.guard.pageKind}", not a resume upload area.`,
    )
  }
  if (!input.guard.uploadAllowed) {
    const blocks = input.guard.blocks.map((b) => b.code).join(', ') || 'upload not permitted'
    throw new ConfigError(`CV upload refused: page guards block it (${blocks}).`)
  }
}

/**
 * Attach the routed CV to the scanned file input. assertResumeUploadAllowed
 * MUST have been called on the same inputs first; this function re-runs it
 * so a direct call can never skip the gates. Logs only the file KEY and
 * label — never file contents.
 */
export async function uploadResume(
  page: Page,
  options: {
    fieldId: string
    gate: ResumeUploadGateInput
    selectedCvHumanLabel: string | null
    actionId: string
    logger: FieldActionLogger
  },
): Promise<FieldActionOutcome> {
  assertResumeUploadAllowed(options.gate)
  const cvPath = options.gate.selectedCvPath!
  options.logger.log({
    event: 'resume_upload_attempt',
    details: {
      actionId: options.actionId,
      fieldId: options.fieldId,
      cvKey: options.gate.selectedCvKey,
      cvLabel: options.selectedCvHumanLabel,
      fileName: path.basename(cvPath),
    },
  })
  try {
    const input = page.locator(`[${DRAFT_FIELD_ATTR}="${options.fieldId}"]`).first()
    await input.setInputFiles(cvPath, { timeout: UPLOAD_TIMEOUT_MS })
    options.logger.log({
      event: 'resume_upload_done',
      details: { actionId: options.actionId, fieldId: options.fieldId, cvKey: options.gate.selectedCvKey },
    })
    return {
      actionId: options.actionId,
      fieldId: options.fieldId,
      status: 'uploaded',
      detail: `attached CV "${options.gate.selectedCvKey}" (${path.basename(cvPath)})`,
      verified: true,
    }
  } catch (err) {
    const detail = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err)
    options.logger.log({
      event: 'resume_upload_failed',
      details: { actionId: options.actionId, fieldId: options.fieldId, error: detail },
    })
    return {
      actionId: options.actionId,
      fieldId: options.fieldId,
      status: 'failed',
      detail,
      verified: false,
    }
  }
}
