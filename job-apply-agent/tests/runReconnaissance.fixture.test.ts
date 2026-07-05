import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadCvRoutingConfig } from '../src/config/loadConfig'
import type { JobRecord } from '../src/intelligence/types'
import { FixtureJobContentProvider } from '../src/providers/FixtureJobContentProvider'
import { reconJob } from '../src/reconnaissance/runReconnaissance'
import { ReconSummarySchema } from '../src/reconnaissance/types'
import { buildReconSummary } from '../src/reporting/buildReconSummary'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const testPage = (name: string): string => path.join(repoRoot, 'test-pages', name)
const cvRouting = loadCvRoutingConfig(path.join(repoRoot, 'config', 'cv_routing.yaml'))

const tempDirs: string[] = []
const makeRunDir = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'recon-fixture-test-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const job = (overrides: Partial<JobRecord> & Pick<JobRecord, 'id' | 'url' | 'company'>): JobRecord => ({
  fixture: 'tests/fixtures/barclays_research.txt',
  ...overrides,
})

async function runFixtureRecon(
  jobRecord: JobRecord,
  htmlFile: string,
  clickApply: boolean,
) {
  const provider = new FixtureJobContentProvider({
    htmlByJobId: { [jobRecord.id]: testPage(htmlFile) },
  })
  const runDir = makeRunDir()
  const target = await provider.createTarget(jobRecord)
  const result = await reconJob(jobRecord, target, cvRouting, {
    clickApply,
    runDir,
    runLogPath: path.join(runDir, 'action-log.jsonl'),
  })
  await provider.dispose()
  return result
}

describe('reconJob with fixture pages (offline)', () => {
  it('captures, classifies, and does NOT click when clickApply is false', async () => {
    const result = await runFixtureRecon(
      job({
        id: 'barclays_research_2027_sg',
        url: 'https://search.jobs.barclays/job/singapore/research-analyst-summer-internship-programme-2027-singapore/13015/97173678304',
        company: 'Barclays',
        expectedBucket: 'public_equities_markets_research',
      }),
      'barclays-job.html',
      false,
    )
    expect(result.stopReason).toBe('apply_click_disabled_by_default')
    expect(result.applyCtaFound).toBe(true)
    expect(result.applyCtaClicked).toBe(false)
    expect(result.ctaTextClicked).toBeNull()
    expect(result.liveTextExtracted).toBe(true)
    expect(result.liveClassification?.bucket).toBe('public_equities_markets_research')
    expect(result.liveClassification?.confidence).toBe('high')
    expect(result.classificationMatchesExpected).toBe(true)
    expect(result.selectedCvKey).toBe('omers_public_equities')
    expect(result.platform).toBe('workday') // from footer text
    expect(result.manualReviewRequired).toBe(false)
    expect(result.artifacts.some((a) => a.endsWith('extracted-job-page.txt'))).toBe(true)
    expect(result.artifacts.some((a) => a.endsWith('cta-candidates.json'))).toBe(true)
  })

  it('clicks only the safe Apply CTA and stops immediately after platform detection', async () => {
    const result = await runFixtureRecon(
      job({
        id: 'barclays_research_2027_sg',
        url: 'https://search.jobs.barclays/job/singapore/research-analyst-summer-internship-programme-2027-singapore/13015/97173678304',
        company: 'Barclays',
        expectedBucket: 'public_equities_markets_research',
      }),
      'barclays-job.html',
      true,
    )
    expect(result.applyCtaClicked).toBe(true)
    expect(result.ctaTextClicked).toBe('Apply now')
    expect(result.stopReason).toBe('platform_detected_after_apply')
    expect(result.finalUrlBeforeStop).toContain('myworkdayjobs.com')
    expect(result.platform).toBe('workday')
    expect(result.platformConfidence).toBe('high')
  })

  it('refuses to click on the ambiguous page and requires manual review', async () => {
    const result = await runFixtureRecon(
      job({ id: 'ambiguous_job', url: 'https://example.com/careers/role-1', company: 'Example' }),
      'ambiguous-job.html',
      true,
    )
    expect(result.applyCtaClicked).toBe(false)
    expect(result.stopReason).toBe('unsafe_apply_cta')
    expect(result.manualReviewRequired).toBe(true)
    expect(result.liveClassification?.bucket).toBe('manual_review')
  })

  it('routes the GIC multi-track page to track_dependent with no CV and manual review', async () => {
    const result = await runFixtureRecon(
      job({
        id: 'gic_internship_programme',
        url: 'https://gic.careers/programmes/gic-internship-programme/',
        company: 'GIC',
        expectedBucket: 'track_dependent',
      }),
      'gic-job.html',
      false,
    )
    expect(result.liveClassification?.bucket).toBe('track_dependent')
    expect(result.selectedCvKey).toBeNull()
    expect(result.selectedCvHumanLabel).toBe('manual until selected track is known')
    expect(result.manualReviewRequired).toBe(true)
    expect(result.platform).toBe('impress_ai')
  })

  it('preserves not_summer_internship and GS limit warnings on the GS page', async () => {
    const result = await runFixtureRecon(
      job({
        id: 'gs_170782',
        url: 'https://higher.gs.com/roles/170782',
        company: 'Goldman Sachs',
        expectedBucket: 'private_markets_ibd_deals',
      }),
      'gs-job.html',
      false,
    )
    const codes = result.liveClassification?.warnings.map((w) => w.code) ?? []
    expect(codes).toContain('not_summer_internship')
    expect(codes).toContain('goldman_sachs_application_limit')
    expect(result.liveClassification?.bucket).toBe('private_markets_ibd_deals')
    expect(result.platform).toBe('oracle_recruiting')
  })

  it('builds a schema-valid summary with correct totals and no submit-like behavior', async () => {
    const results = [
      await runFixtureRecon(
        job({
          id: 'barclays_research_2027_sg',
          url: 'https://search.jobs.barclays/job/singapore/research-analyst',
          company: 'Barclays',
          expectedBucket: 'public_equities_markets_research',
        }),
        'barclays-job.html',
        false,
      ),
      await runFixtureRecon(
        job({ id: 'ambiguous_job', url: 'https://example.com/careers/role-1', company: 'Example' }),
        'ambiguous-job.html',
        false,
      ),
    ]
    const summary = buildReconSummary({
      jobsFile: 'config/jobs.yaml',
      provider: 'fixture',
      clickApply: false,
      startedAt: '2026-07-05T00:00:00.000Z',
      runDir: 'runs/test-recon',
      results,
    })
    expect(() => ReconSummarySchema.parse(summary)).not.toThrow()
    expect(summary.totals.jobs).toBe(2)
    expect(summary.totals.applyCtaClickedCount).toBe(0)
    expect(summary.totals.byStopReason['apply_click_disabled_by_default']).toBe(1)
    expect(summary.totals.byStopReason['unsafe_apply_cta']).toBe(1)
    expect(summary.totals.manualReviewCount).toBe(1)
    // Reconnaissance never submits, uploads, creates accounts, or fills forms:
    // the only recorded interactions are (at most) a single apply-CTA click.
    for (const r of summary.results) {
      expect(r.applyCtaClicked).toBe(false)
      expect(['job_page_captured', 'apply_click_disabled_by_default', 'unsafe_apply_cta']).toContain(
        r.stopReason,
      )
    }
  })
})
