import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { maskEmailsInText, REDACTED } from '../profile/redactProfile'
import type { FieldActionOutcome, ScannedWorkdayField, WorkdayPageScan } from '../workday/types'
import type { DraftFlags, DraftPlan, PlannedAction } from './types'

export function draftRunStamp(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z-draft`
}

const redactAction = (action: PlannedAction): PlannedAction => ({
  ...action,
  proposedValue:
    action.proposedValue === null
      ? null
      : action.sensitive
        ? REDACTED
        : maskEmailsInText(action.proposedValue),
  exactOptionMatch:
    action.exactOptionMatch === null
      ? null
      : action.sensitive
        ? REDACTED
        : action.exactOptionMatch,
})

/** Redacted plan: no sensitive values, no page text, masked emails everywhere. */
export function redactDraftPlan(plan: DraftPlan): DraftPlan {
  return {
    ...plan,
    plannedActions: plan.plannedActions.map(redactAction),
    blockedActions: plan.blockedActions.map(redactAction),
    manualReviewItems: plan.manualReviewItems.map(redactAction),
    neverAutoItems: plan.neverAutoItems.map(redactAction),
    warnings: plan.warnings.map((w) => ({ ...w, message: maskEmailsInText(w.message) })),
    preflight: {
      ...plan.preflight,
      blockers: plan.preflight.blockers.map((w) => ({ ...w, message: maskEmailsInText(w.message) })),
      warnings: plan.preflight.warnings.map((w) => ({ ...w, message: maskEmailsInText(w.message) })),
      checks: plan.preflight.checks.map((c) => ({ ...c, detail: maskEmailsInText(c.detail) })),
    },
  }
}

/** Scanned fields for the local full file: current values masked when present. */
export function redactScannedFields(fields: ScannedWorkdayField[]): ScannedWorkdayField[] {
  return fields.map((field) => ({
    ...field,
    currentValue: field.currentValue === null ? null : REDACTED,
    helpText: field.helpText === null ? null : maskEmailsInText(field.helpText),
  }))
}

function planMarkdown(plan: DraftPlan, outcomes: FieldActionOutcome[]): string {
  const redacted = redactDraftPlan(plan)
  const lines: string[] = [
    `# Workday draft plan — ${plan.jobId} (${plan.company})`,
    '',
    `- mode: ${plan.mode}`,
    `- bucket: ${plan.bucket}`,
    `- CV: ${plan.selectedCvHumanLabel ?? '—'} (${plan.selectedCvKey ?? 'none'})`,
    `- page kind: ${plan.pageKind} | mutation allowed: ${plan.guard.mutationAllowed} | upload allowed: ${plan.guard.uploadAllowed}`,
    `- fields scanned: ${plan.scannedFieldsSummary.total} (${plan.scannedFieldsSummary.unmappedCount} unmapped)`,
    `- ready_for_cv_upload: ${plan.readiness.ready_for_cv_upload}`,
    `- ready_for_final_submit: ${plan.readiness.ready_for_final_submit} (always false)`,
    `- canSubmitFinal: ${plan.canSubmitFinal} (always false)`,
    '',
    '## Preflight',
    '',
    ...redacted.preflight.checks.map((c) => `- ${c.ok ? 'ok   ' : 'BLOCK'} ${c.id}: ${c.detail}`),
    '',
  ]
  const section = (title: string, actions: PlannedAction[]): void => {
    lines.push(`## ${title} (${actions.length})`, '')
    for (const action of actions) {
      lines.push(
        `- [${action.policy}] ${action.fieldLabel} → ${action.type}` +
          `${action.proposedValue !== null ? ` = ${action.proposedValue}` : ''} (${action.reason})`,
      )
    }
    lines.push('')
  }
  section('Planned actions', redacted.plannedActions)
  section('Blocked actions', redacted.blockedActions)
  section('Manual review', redacted.manualReviewItems)
  section('Never auto', redacted.neverAutoItems)
  if (outcomes.length > 0) {
    lines.push('## Execution outcomes', '')
    for (const outcome of outcomes) {
      lines.push(`- ${outcome.actionId}: ${outcome.status} — ${maskEmailsInText(outcome.detail)}`)
    }
    lines.push('')
  }
  if (redacted.warnings.length > 0) {
    lines.push('## Warnings', '')
    for (const warning of redacted.warnings) lines.push(`- [${warning.code}] ${warning.message}`)
    lines.push('')
  }
  return lines.join('\n')
}

export interface WriteDraftRunInput {
  runDir: string
  plan: DraftPlan
  scan: WorkdayPageScan
  outcomes: FieldActionOutcome[]
  flags: DraftFlags
  notes: string[]
  screenshots: string[]
  startedAt: string
}

export interface DraftRunPaths {
  jobDir: string
  summaryPath: string
  redactedSummaryPath: string
}

const writeJson = (filePath: string, value: unknown): void => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * Persist the draft run. FULL files keep field values for local human review
 * (draft-runs/ is gitignored); the .redacted.json variants carry no sensitive
 * values, no page text, and masked emails.
 */
export function writeDraftRun(input: WriteDraftRunInput): DraftRunPaths {
  const jobDir = path.join(input.runDir, input.plan.jobId)
  mkdirSync(jobDir, { recursive: true })
  mkdirSync(path.join(jobDir, 'screenshots'), { recursive: true })

  const redactedPlan = redactDraftPlan(input.plan)
  writeJson(path.join(jobDir, 'draft-plan.json'), input.plan)
  writeJson(path.join(jobDir, 'draft-plan.redacted.json'), redactedPlan)
  writeFileSync(
    path.join(jobDir, 'draft-plan.md'),
    `${planMarkdown(input.plan, input.outcomes)}\n`,
    'utf8',
  )
  writeJson(path.join(jobDir, 'scanned-fields.json'), {
    url: input.scan.url,
    title: input.scan.title,
    buttons: input.scan.buttons,
    signals: input.scan.signals,
    fields: input.scan.fields,
  })
  writeJson(path.join(jobDir, 'planned-actions.json'), input.plan.plannedActions)
  writeJson(path.join(jobDir, 'blocked-actions.json'), input.plan.blockedActions)
  writeJson(path.join(jobDir, 'manual-review-items.json'), [
    ...input.plan.manualReviewItems,
    ...input.plan.neverAutoItems,
  ])

  const summary = {
    phase: 6,
    mode: input.plan.mode,
    provider: input.flags.provider,
    startedAt: input.startedAt,
    runDir: input.runDir.split('\\').join('/'),
    jobId: input.plan.jobId,
    company: input.plan.company,
    pageKind: input.plan.pageKind,
    canSubmitFinal: false as const,
    totals: {
      scannedFields: input.plan.scannedFieldsSummary.total,
      planned: input.plan.plannedActions.length,
      blocked: input.plan.blockedActions.length,
      manualReview: input.plan.manualReviewItems.length,
      neverAuto: input.plan.neverAutoItems.length,
      executed: input.outcomes.length,
    },
    notes: input.notes,
    screenshots: input.screenshots,
    outcomes: input.outcomes,
    plan: input.plan,
  }
  const redactedSummary = {
    ...summary,
    notes: input.notes.map(maskEmailsInText),
    outcomes: input.outcomes.map((o) => ({ ...o, detail: maskEmailsInText(o.detail) })),
    plan: redactedPlan,
  }
  const summaryPath = path.join(input.runDir, 'summary.json')
  const redactedSummaryPath = path.join(input.runDir, 'summary.redacted.json')
  writeJson(summaryPath, summary)
  writeJson(redactedSummaryPath, redactedSummary)

  return { jobDir, summaryPath, redactedSummaryPath }
}
