import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { maskEmailsInText } from '../profile/redactProfile'
import type { FlowMapResult, FlowPageObservation } from './types'

function redactObservation(obs: FlowPageObservation | null): FlowPageObservation | null {
  if (!obs) return null
  return {
    ...obs,
    textSnippet: maskEmailsInText(obs.textSnippet),
    entryOptions: obs.entryOptions.map((o) => ({ ...o, label: maskEmailsInText(o.label) })),
  }
}

/**
 * Redacted copy of a flow map: emails scrubbed from every free-text field.
 * Flow maps carry no candidate field values, but warnings/snippets can quote
 * emails, so everything textual goes through the scrubber.
 */
export function redactFlowMap(flowMap: FlowMapResult): FlowMapResult {
  return {
    ...flowMap,
    preClick: redactObservation(flowMap.preClick),
    postClick: redactObservation(flowMap.postClick),
    warnings: flowMap.warnings.map((w) => ({ ...w, message: maskEmailsInText(w.message) })),
    liveClassification: flowMap.liveClassification
      ? {
          ...flowMap.liveClassification,
          warnings: flowMap.liveClassification.warnings.map((w) => ({
            ...w,
            message: maskEmailsInText(w.message),
          })),
        }
      : null,
  }
}

export function renderFlowMapMarkdown(flowMap: FlowMapResult): string {
  const lines: string[] = [
    `# Flow map — ${flowMap.jobId}`,
    '',
    `- **Company:** ${flowMap.company}`,
    `- **URL:** ${flowMap.url}`,
    `- **Platform:** ${flowMap.platform} (${flowMap.platformConfidence}) → adapter: ${flowMap.adapter}`,
    `- **Live bucket:** ${flowMap.liveClassification?.bucket ?? 'n/a'} | matches expected: ${flowMap.classificationMatchesExpected ?? 'n/a'}`,
    `- **Apply CTA:** found=${flowMap.applyCtaFound}, clicked=${flowMap.applyCtaClicked}` +
      (flowMap.ctaTextClicked ? ` ("${flowMap.ctaTextClicked}", new tab: ${flowMap.openedNewTab})` : ''),
    `- **Stop reason:** ${flowMap.stopReason}`,
    `- **Manual review required:** ${flowMap.manualReviewRequired ? 'YES' : 'no'}`,
    '',
  ]
  const section = (title: string, obs: FlowPageObservation | null): void => {
    if (!obs) return
    lines.push(`## ${title}`, '', `- URL: ${obs.url}`, `- Title: ${obs.title}`, `- State: **${obs.pageState}** (${obs.pageStateEvidence.join('; ') || 'no evidence'})`, '', '| Option | Kind | Safety | Reason |', '| --- | --- | --- | --- |')
    for (const o of obs.entryOptions) {
      lines.push(`| ${o.label.replace(/\|/g, '\\|')} | ${o.kind} | ${o.safety} | ${o.reason} |`)
    }
    lines.push('')
  }
  section('Job page (pre-click)', flowMap.preClick)
  section('After Apply click', flowMap.postClick)

  lines.push('## Safe actions', '', ...flowMap.safeActions.map((a) => `- ${a}`), '')
  lines.push('## Blocked actions (policy)', '', ...flowMap.blockedActions.map((a) => `- ${a}`), '')
  lines.push('## Manual checkpoints', '', ...(flowMap.manualCheckpoints.length ? flowMap.manualCheckpoints.map((c) => `- ${c}`) : ['- none']), '')
  if (flowMap.packet) {
    lines.push(
      '## Packet readiness (Phase 3)',
      '',
      `- CV: ${flowMap.packet.selectedCvHumanLabel ?? '—'} (${flowMap.packet.selectedCvKey ?? 'none'})`,
      `- ready_for_dry_form_fill: ${flowMap.packet.readiness.ready_for_dry_form_fill}`,
      `- ready_for_cv_upload: ${flowMap.packet.readiness.ready_for_cv_upload}`,
      `- ready_for_final_submit: ${flowMap.packet.readiness.ready_for_final_submit} (always false)`,
      `- unresolved blocking items: ${flowMap.packet.unresolvedBlockingItems.join(', ') || 'none'}`,
      '',
    )
  }
  if (flowMap.warnings.length > 0) {
    lines.push('## Warnings', '', ...flowMap.warnings.map((w) => `- **${w.code}**: ${w.message}`), '')
  }
  return lines.join('\n')
}

/** Write flow-map.json, flow-map.redacted.json, and flow-map.md for a job. */
export function writeFlowMap(flowMap: FlowMapResult, runDir: string): string[] {
  const jobDir = path.join(runDir, flowMap.jobId)
  mkdirSync(jobDir, { recursive: true })
  const redacted = redactFlowMap(flowMap)
  const files: Array<[string, string]> = [
    ['flow-map.json', `${JSON.stringify(flowMap, null, 2)}\n`],
    ['flow-map.redacted.json', `${JSON.stringify(redacted, null, 2)}\n`],
    ['flow-map.md', renderFlowMapMarkdown(redacted)],
  ]
  return files.map(([name, content]) => {
    const filePath = path.join(jobDir, name)
    writeFileSync(filePath, content, 'utf8')
    return filePath
  })
}
