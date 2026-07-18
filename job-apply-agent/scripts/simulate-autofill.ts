// Simulates Phase 6's Workday autofill against samples/workday-clone.html
// using the REAL mapping pipeline (buildApplicationPacket + mapWorkdayFields)
// — same code the live drafter uses, same policy gating. Writes a colored
// preview only; never touches a real Workday page and never submits.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadCvRoutingConfig, loadJobsConfig } from '../src/config/loadConfig'
import { buildApplicationPacket } from '../src/packets/buildApplicationPacket'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'
import { mapWorkdayFields } from '../src/workday/WorkdayFieldMapper'
import { scanWorkdayFieldsFromHtml } from '../src/workday/WorkdayFieldScanner'

const JOB_ID = process.argv[2] ?? 'barclays_research_2027_sg'
const SAMPLE_PATH = path.resolve('samples/workday-clone.html')
const OUT_PATH = path.resolve('samples/workday-clone.autofilled.local.html')

const profile = loadProfile('profiles/candidate_profile.local.yaml')
const answerBank = loadAnswerBank('profiles/answer_bank.local.yaml')
const jobsConfig = loadJobsConfig('config/jobs.yaml')
const cvRouting = loadCvRoutingConfig('config/cv_routing.yaml')
const job = jobsConfig.jobs.find((j) => j.id === JOB_ID)
if (!job) throw new Error(`Job "${JOB_ID}" not found in config/jobs.yaml`)

const packet = buildApplicationPacket({
  jobId: job.id,
  jobsConfig,
  cvRoutingConfig: cvRouting,
  profile,
  answerBank,
})

const html = readFileSync(SAMPLE_PATH, 'utf8')
const scannedFields = scanWorkdayFieldsFromHtml(html)
const mapped = mapWorkdayFields({
  fields: scannedFields,
  packet,
  answerBank,
  company: job.company,
  jobId: job.id,
  bucket: packet.bucket,
})

const POLICY_STYLE: Record<string, { color: string; label: string }> = {
  safe_auto_fill: { color: '#1e8e3e', label: 'auto-fill' },
  auto_if_confirmed: { color: '#1a73e8', label: 'auto (needs confirm)' },
  demographic_exact_match_only: { color: '#e37400', label: 'demographic — exact match only' },
  manual_review: { color: '#888888', label: 'manual review' },
  never_auto: { color: '#d93025', label: 'never auto' },
}

const overlay = mapped.map((m) => ({
  fieldId: m.field.fieldId,
  inputType: m.field.inputType,
  value: m.exactOptionMatch ?? m.proposedValue,
  policy: m.policy,
  reason: m.reason,
}))

let output = html.replace(
  '</main>',
  `<div class="legend" style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #d7dbe0;font-size:0.78rem;">${Object.entries(
    POLICY_STYLE,
  )
    .map(
      ([, v]) =>
        `<span style="border-left:4px solid ${v.color};padding-left:6px;margin-right:14px;">${v.label}</span>`,
    )
    .join('')}</div></main>`,
)

output = output.replace(
  '</body>',
  `<script>
const AUTOFILL = ${JSON.stringify(overlay)};
for (const item of AUTOFILL) {
  const isRadio = item.inputType === 'radio';
  const els = isRadio
    ? Array.from(document.getElementsByName(item.fieldId))
    : [document.getElementById(item.fieldId)].filter(Boolean);
  if (els.length === 0) continue;
  for (const el of els) {
    el.style.borderLeft = '4px solid ' + ${JSON.stringify(POLICY_STYLE)}[item.policy].color;
    el.title = ${JSON.stringify(POLICY_STYLE)}[item.policy].label + (item.reason ? (' — ' + item.reason) : '');
    if (isRadio) {
      if (item.value && el.value === item.value) el.checked = true;
    } else if (item.inputType !== 'file' && item.value !== null && item.value !== undefined) {
      el.value = item.value;
    }
  }
}
</script></body>`,
)

writeFileSync(OUT_PATH, output)
console.log(`Wrote ${OUT_PATH}`)
console.log(
  `${mapped.filter((m) => m.policy === 'safe_auto_fill').length} safe-auto, ` +
    `${mapped.filter((m) => m.policy === 'auto_if_confirmed').length} needs-confirm, ` +
    `${mapped.filter((m) => m.policy === 'demographic_exact_match_only').length} demographic, ` +
    `${mapped.filter((m) => m.policy === 'manual_review').length} manual, ` +
    `${mapped.filter((m) => m.policy === 'never_auto').length} never-auto.`,
)
console.log(`Open with: open "${OUT_PATH}"`)
