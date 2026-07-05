import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadCvRoutingConfig, loadJobsConfig } from '../src/config/loadConfig'
import { buildFlowMap } from '../src/flow/buildFlowMap'
import { redactFlowMap } from '../src/flow/writeFlowMap'
import { FixtureJobContentProvider } from '../src/providers/FixtureJobContentProvider'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'

const root = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url))
const jobsConfig = loadJobsConfig(root('config/jobs.yaml'))
const cvRoutingConfig = loadCvRoutingConfig(root('config/cv_routing.yaml'))
const profile = loadProfile(root('tests/fixtures/candidate_profile.fixture.yaml'))
const answerBank = loadAnswerBank(root('tests/fixtures/answer_bank.fixture.yaml'))

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

async function runFlow(jobId: string, opts: { clickApply?: boolean; selectedTrack?: string } = {}) {
  const job = jobsConfig.jobs.find((j) => j.id === jobId)
  if (!job) throw new Error(`unknown job ${jobId}`)
  const provider = new FixtureJobContentProvider({
    htmlByJobId: {
      barclays_research_2027_sg: root('test-pages/barclays-job.html'),
      bofa_gib_2027_sg: root('test-pages/bofa-job.html'),
      gs_170782: root('test-pages/gs-job.html'),
      gic_internship_programme: root('test-pages/gic-job.html'),
    },
  })
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'flow-fixture-test-'))
  tempDirs.push(runDir)
  const target = await provider.createTarget(job)
  const flowMap = await buildFlowMap({
    job,
    target,
    jobsConfig,
    cvRoutingConfig,
    profile,
    answerBank,
    ...(opts.selectedTrack ? { selectedTrack: opts.selectedTrack } : {}),
    clickApply: opts.clickApply ?? false,
    runDir,
    runLogPath: path.join(runDir, 'action-log.jsonl'),
  })
  await provider.dispose()
  return { flowMap, runDir }
}

describe('buildFlowMap with fixtures (offline)', () => {
  it('includes packet readiness and the selected CV', async () => {
    const { flowMap, runDir } = await runFlow('barclays_research_2027_sg')
    expect(flowMap.packet?.selectedCvKey).toBe('omers_public_equities')
    expect(flowMap.packet?.selectedCvHumanLabel).toBe('OMERS / public equities CV')
    expect(flowMap.packet?.readiness.ready_for_final_submit).toBe(false)
    expect(flowMap.packet?.readiness.ready_for_cv_upload).toBe(false) // blocked by document warnings
    expect(flowMap.manualCheckpoints).toContain('cv_upload_blocked_by_document_warnings')
    expect(flowMap.applyCtaFound).toBe(true)
    expect(flowMap.applyCtaClicked).toBe(false)
    expect(flowMap.stopReason).toBe('apply_click_disabled_by_default')
    // artifacts written
    const files = readdirSync(path.join(runDir, 'barclays_research_2027_sg'))
    expect(files).toEqual(
      expect.arrayContaining([
        'page-snapshot.json',
        'entry-options.json',
        'manual-checkpoints.json',
        'adapter-summary.json',
        'action-log.jsonl',
      ]),
    )
  })

  it('clicks the safe CTA in click mode and maps the post-click platform', async () => {
    const { flowMap } = await runFlow('barclays_research_2027_sg', { clickApply: true })
    expect(flowMap.applyCtaClicked).toBe(true)
    expect(flowMap.ctaTextClicked).toBe('Apply now')
    expect(flowMap.platform).toBe('workday')
    expect(flowMap.stopReason).toBe('platform_detected_after_apply')
    expect(flowMap.adapter).toBe('WorkdayAdapter')
  })

  it('flags GIC without selectedTrack as manual review', async () => {
    const { flowMap } = await runFlow('gic_internship_programme')
    expect(flowMap.manualReviewRequired).toBe(true)
    expect(flowMap.packet?.selectedCvKey).toBeNull()
    expect(flowMap.manualCheckpoints).toContain('track_dependent_cv')
    expect(flowMap.adapter).toBe('ImpressAiAdapter')
  })

  it('resolves GIC selectedTrack public_equities to the public CV', async () => {
    const { flowMap } = await runFlow('gic_internship_programme', { selectedTrack: 'public_equities' })
    expect(flowMap.packet?.selectedCvKey).toBe('omers_public_equities')
    expect(flowMap.packet?.manualReviewRequired).toBe(false)
  })

  it('flags GS New Analyst jobs with job_not_summer_internship', async () => {
    const { flowMap } = await runFlow('gs_170782')
    expect(flowMap.manualCheckpoints).toContain('job_not_summer_internship')
    expect(flowMap.manualReviewRequired).toBe(true)
  })

  it('redacted flow output contains no fixture PII', async () => {
    const { flowMap } = await runFlow('barclays_research_2027_sg', { clickApply: true })
    const serialized = JSON.stringify(redactFlowMap(flowMap))
    expect(serialized).not.toContain('alex.tan@example.edu')
    expect(serialized).not.toContain('old.email@example.edu')
    expect(serialized).not.toContain('1 Example Street')
    expect(serialized).not.toContain('2000-01-01')
    expect(serialized).not.toContain('+65 1234')
  })
})
