import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { formatAnswerMarkdown } from '../answers/formatAnswer'
import { maskEmail, maskEmailsInText, maskPhone, REDACTED } from '../profile/redactProfile'
import type { ApplicationPacket, PacketField } from './types'

function maskFieldValue(field: PacketField): PacketField {
  const masked: PacketField = {
    ...field,
    ...(field.note !== undefined ? { note: maskEmailsInText(field.note) } : {}),
  }
  if (!field.sensitive || field.value === null || typeof field.value === 'boolean') return masked
  let value = REDACTED
  if (field.key === 'email') value = maskEmail(String(field.value))
  if (field.key === 'phone') value = maskPhone(String(field.value))
  return { ...masked, value }
}

/**
 * Redacted copy of a packet: sensitive field values masked, and email
 * addresses scrubbed from all free text (warnings, unresolved items, notes)
 * — warning messages can quote the candidate's email verbatim.
 */
export function redactPacket(packet: ApplicationPacket): ApplicationPacket {
  return {
    ...packet,
    candidateFieldSummary: {
      redacted: packet.candidateFieldSummary.redacted,
      full: packet.candidateFieldSummary.redacted, // full section replaced by redacted values
    },
    warnings: packet.warnings.map((w) => ({ ...w, message: maskEmailsInText(w.message) })),
    unresolvedItems: packet.unresolvedItems.map((item) => ({
      ...item,
      message: maskEmailsInText(item.message),
    })),
    safeAutoFillFields: packet.safeAutoFillFields.map(maskFieldValue),
    autoIfConfirmedFields: packet.autoIfConfirmedFields.map(maskFieldValue),
    demographicFields: packet.demographicFields.map(maskFieldValue),
    manualReviewFields: packet.manualReviewFields.map(maskFieldValue),
    neverAutoFields: packet.neverAutoFields.map(maskFieldValue),
  }
}

function fieldsTable(title: string, fields: PacketField[]): string {
  const lines = [`## ${title}`, '', '| Field | Value | Note |', '| --- | --- | --- |']
  for (const f of fields) {
    const value = f.value === null ? '—' : String(f.value)
    lines.push(`| ${f.label} | ${value.replace(/\|/g, '\\|')} | ${f.note ?? ''} |`)
  }
  lines.push('')
  return lines.join('\n')
}

export function renderPacketMarkdown(packet: ApplicationPacket): string {
  const lines: string[] = [
    `# Application packet — ${packet.jobId}`,
    '',
    `- **Company:** ${packet.company}`,
    `- **URL:** ${packet.url}`,
    `- **Bucket:** ${packet.bucket}${packet.resolvedTrack ? ` (track: ${packet.resolvedTrack})` : ''}`,
    `- **CV:** ${packet.selectedCvHumanLabel ?? '—'} (${packet.selectedCvPath ?? 'no file'})`,
    `- **Program type:** ${packet.programType}`,
    `- **Manual review required:** ${packet.manualReviewRequired ? 'YES' : 'no'}`,
    `- **Readiness:** dry form fill: ${packet.readiness.ready_for_dry_form_fill}, ` +
      `CV upload: ${packet.readiness.ready_for_cv_upload}, final submit: ${packet.readiness.ready_for_final_submit} (always false in Phase 3)`,
    '',
  ]
  if (packet.warnings.length > 0) {
    lines.push('## Warnings', '')
    for (const w of packet.warnings) lines.push(`- **${w.code}**: ${w.message}`)
    lines.push('')
  }
  lines.push(fieldsTable('Safe auto-fill fields', packet.safeAutoFillFields))
  lines.push(fieldsTable('Auto if confirmed', packet.autoIfConfirmedFields))
  lines.push(fieldsTable('Demographics (exact option match only)', packet.demographicFields))
  lines.push(fieldsTable('Manual review', packet.manualReviewFields))
  lines.push(fieldsTable('Never auto', packet.neverAutoFields))

  lines.push('## Selected experiences', '')
  for (const exp of packet.selectedExperiences) {
    lines.push(`### ${exp.heading}`, '', `*${exp.dates} · ${exp.location} · ${exp.type}*`, '')
    for (const bullet of exp.bullets) lines.push(`- ${bullet}`)
    for (const warning of exp.warnings) lines.push(`- ⚠ ${warning}`)
    lines.push('')
  }
  if (packet.secondaryExperiences.length > 0) {
    lines.push('## Secondary experiences (include if space allows)', '')
    for (const exp of packet.secondaryExperiences) lines.push(`- ${exp.heading} (${exp.dates})`)
    lines.push('')
  }

  lines.push('## Suggested draft answers (ALL require review before use)', '')
  for (const answer of packet.suggestedAnswers) lines.push(formatAnswerMarkdown(answer))

  if (packet.unresolvedItems.length > 0) {
    lines.push('## Unresolved items', '')
    for (const item of packet.unresolvedItems) {
      lines.push(`- [${item.severity}] **${item.id}**: ${item.message}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Write full + redacted JSON and review Markdown into <runDir>/<jobId>/. */
export function writeApplicationPacket(packet: ApplicationPacket, runDir: string): string[] {
  const jobDir = path.join(runDir, packet.jobId)
  mkdirSync(jobDir, { recursive: true })
  const files = [
    { name: 'application-packet.json', content: `${JSON.stringify(packet, null, 2)}\n` },
    {
      name: 'application-packet.redacted.json',
      content: `${JSON.stringify(redactPacket(packet), null, 2)}\n`,
    },
    { name: 'application-packet.md', content: renderPacketMarkdown(packet) },
  ]
  const written: string[] = []
  for (const file of files) {
    const filePath = path.join(jobDir, file.name)
    writeFileSync(filePath, file.content, 'utf8')
    written.push(filePath)
  }
  return written
}
