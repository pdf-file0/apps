import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ConfigError, loadCvRoutingConfig, loadJobsConfig, loadSubmissionPolicy } from './config/loadConfig'
import type { JobRecord } from './intelligence/types'
import { logger } from './logging/logger'
import {
  DEFAULT_FIXTURE_PAGES,
  FixtureJobContentProvider,
} from './providers/FixtureJobContentProvider'
import { FirecrawlJobContentProvider } from './providers/FirecrawlJobContentProvider'
import type { ReconProvider } from './providers/JobContentProvider'
import { PlaywrightJobContentProvider } from './providers/PlaywrightJobContentProvider'
import { ActionLogger, reconJob } from './reconnaissance/runReconnaissance'
import type { ReconJobResult } from './reconnaissance/types'
import { buildReconSummary } from './reporting/buildReconSummary'

const CV_ROUTING_FILE = 'config/cv_routing.yaml'
const SUBMISSION_POLICY_FILE = 'config/submission_policy.yaml'
const PROFILE_DIR = '.browser-profile'

interface ReconArgs {
  jobsFile: string
  jobId: string | null
  limit: number | null
  provider: 'live' | 'fixture' | 'firecrawl'
  clickApply: boolean
  headed: boolean
}

export function parseReconArgs(argv: string[]): ReconArgs {
  const args: ReconArgs = {
    jobsFile: 'config/jobs.yaml',
    jobId: null,
    limit: null,
    provider: 'live',
    clickApply: false, // NEVER defaults to true
    headed: true, // headed by default so the user can watch live recon
  }
  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new ConfigError(`Flag ${flag} requires a value.`)
    }
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--jobs':
        args.jobsFile = takeValue(flag, i)
        i++
        break
      case '--job':
        args.jobId = takeValue(flag, i)
        i++
        break
      case '--limit': {
        const raw = takeValue(flag, i)
        const parsed = Number.parseInt(raw, 10)
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new ConfigError(`--limit must be a positive integer, got "${raw}".`)
        }
        args.limit = parsed
        i++
        break
      }
      case '--provider': {
        const value = takeValue(flag, i)
        if (value !== 'live' && value !== 'fixture' && value !== 'firecrawl') {
          throw new ConfigError(`--provider must be live, fixture, or firecrawl (got "${value}").`)
        }
        args.provider = value
        i++
        break
      }
      case '--click-apply':
        args.clickApply = true
        break
      case '--no-click-apply':
        args.clickApply = false
        break
      case '--headed':
        args.headed = true
        break
      case '--headless':
        args.headed = false
        break
      default:
        throw new ConfigError(
          `Unknown flag "${flag}". Usage: npm run recon -- --jobs config/jobs.yaml ` +
            '[--job <id>] [--limit <n>] [--provider live|fixture|firecrawl] ' +
            '[--click-apply|--no-click-apply] [--headed|--headless]',
        )
    }
  }
  return args
}

function createProvider(args: ReconArgs): ReconProvider {
  switch (args.provider) {
    case 'fixture':
      return new FixtureJobContentProvider({ htmlByJobId: DEFAULT_FIXTURE_PAGES })
    case 'firecrawl':
      return new FirecrawlJobContentProvider()
    case 'live':
      return new PlaywrightJobContentProvider({ headed: args.headed, profileDir: PROFILE_DIR })
  }
}

function runDirStamp(date: Date): string {
  // Windows-safe run-dir name: 2026-07-05T120000Z-recon
  const iso = date.toISOString()
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z-recon`
}

function renderTable(header: string[], rows: string[][]): string {
  const all = [header, ...rows]
  const widths = header.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)))
  const line = (row: string[]) =>
    row.map((cell, col) => cell.padEnd(widths[col] ?? cell.length)).join('  | ')
  return [line(header), widths.map((w) => '-'.repeat(w)).join('--|-'), ...rows.map(line)].join('\n')
}

async function main(): Promise<void> {
  const args = parseReconArgs(process.argv.slice(2))

  // Safety gate: fails hard if any risky policy flag was flipped.
  loadSubmissionPolicy(SUBMISSION_POLICY_FILE)
  logger.info('job-apply-agent — Phase 2 reconnaissance (dry run)')
  logger.info(
    'Safety: no applications submitted, no accounts created, no fields filled, no CVs uploaded, no terms accepted.',
  )
  logger.info(
    args.clickApply
      ? 'Apply-CTA clicking: ENABLED (job-page-level allow-listed CTAs only; stops at any login/form/captcha).'
      : 'Apply-CTA clicking: disabled (default). Pass --click-apply to allow one safe job-page-level click.\n',
  )

  const cvRouting = loadCvRoutingConfig(CV_ROUTING_FILE)
  const jobsConfig = loadJobsConfig(args.jobsFile)

  let jobs: JobRecord[] = jobsConfig.jobs
  if (args.jobId) {
    jobs = jobs.filter((job) => job.id === args.jobId)
    if (jobs.length === 0) {
      throw new ConfigError(
        `--job "${args.jobId}" not found in ${args.jobsFile}. Known ids: ${jobsConfig.jobs
          .map((j) => j.id)
          .join(', ')}`,
      )
    }
  }
  if (args.limit !== null) jobs = jobs.slice(0, args.limit)

  const startedAt = new Date()
  const runDir = path.join('runs', runDirStamp(startedAt))
  mkdirSync(runDir, { recursive: true })
  const runLogPath = path.join(runDir, 'action-log.jsonl')
  const runLog = new ActionLogger([runLogPath])
  runLog.log({
    event: 'recon_run_start',
    details: {
      provider: args.provider,
      clickApply: args.clickApply,
      headed: args.headed,
      jobs: jobs.map((j) => j.id),
    },
  })

  const provider = createProvider(args)
  const results: ReconJobResult[] = []
  try {
    for (const job of jobs) {
      logger.info(`\n→ ${job.id} (${job.company})`)
      const target = await provider.createTarget(job)
      const result = await reconJob(job, target, cvRouting, {
        clickApply: args.clickApply,
        runDir,
        runLogPath,
      })
      results.push(result)
      logger.info(
        `  ${result.stopReason} | platform: ${result.platform} (${result.platformConfidence}) | ` +
          `bucket: ${result.liveClassification?.bucket ?? 'n/a'} | manual review: ${result.manualReviewRequired}`,
      )
    }
  } finally {
    await provider.dispose()
  }

  const summary = buildReconSummary({
    jobsFile: args.jobsFile,
    provider: args.provider,
    clickApply: args.clickApply,
    startedAt: startedAt.toISOString(),
    runDir,
    results,
  })
  const summaryPath = path.join(runDir, 'summary.json')
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  copyFileSync(summaryPath, path.join('runs', 'latest-recon-summary.json'))
  runLog.log({ event: 'recon_run_complete', details: { summary: summary.totals } })

  logger.info(
    `\n${renderTable(
      ['Job ID', 'Live bucket', 'Platform', 'CTA found', 'Clicked', 'Stop reason', 'Manual review'],
      results.map((r) => [
        r.jobId,
        r.liveClassification?.bucket ?? '-',
        `${r.platform} (${r.platformConfidence})`,
        String(r.applyCtaFound),
        String(r.applyCtaClicked),
        r.stopReason,
        String(r.manualReviewRequired),
      ]),
    )}`,
  )
  logger.info(`\nRun artifacts: ${runDir}`)
  logger.info('Summary written to runs/latest-recon-summary.json')
  logger.info(
    `Totals: ${summary.totals.jobs} jobs, ${summary.totals.manualReviewCount} need manual review, ${summary.totals.applyCtaClickedCount} apply CTA click(s).`,
  )
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    logger.error(err.message)
  } else {
    logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  }
  process.exitCode = 1
})
