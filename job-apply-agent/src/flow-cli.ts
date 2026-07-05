import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ConfigError, loadCvRoutingConfig, loadJobsConfig, loadSubmissionPolicy } from './config/loadConfig'
import { buildFlowMap } from './flow/buildFlowMap'
import type { FlowMapResult } from './flow/types'
import { redactFlowMap, writeFlowMap } from './flow/writeFlowMap'
import type { JobRecord } from './intelligence/types'
import { logger } from './logging/logger'
import {
  DEFAULT_FIXTURE_PAGES,
  FixtureJobContentProvider,
} from './providers/FixtureJobContentProvider'
import type { ReconProvider } from './providers/JobContentProvider'
import { PlaywrightJobContentProvider } from './providers/PlaywrightJobContentProvider'
import { maskEmailsInText } from './profile/redactProfile'
import { loadAnswerBank, loadProfile } from './profile/loadProfile'
import type { AnswerBank, CandidateProfile } from './profile/types'
import { ActionLogger } from './reconnaissance/runReconnaissance'

interface FlowArgs {
  jobsFile: string
  jobId: string | null
  limit: number | null
  provider: 'live' | 'fixture'
  clickApply: boolean
  headed: boolean
  allowHeadlessLive: boolean
  profilePath: string
  answersPath: string
  selectedTrack: string | null
  showSensitive: boolean
}

export function parseFlowArgs(argv: string[]): FlowArgs {
  const args: FlowArgs = {
    jobsFile: 'config/jobs.yaml',
    jobId: null,
    limit: null,
    provider: 'live',
    clickApply: false, // NEVER defaults to true
    headed: true,
    allowHeadlessLive: false,
    profilePath: 'profiles/candidate_profile.local.yaml',
    answersPath: 'profiles/answer_bank.local.yaml',
    selectedTrack: null,
    showSensitive: false,
  }
  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new ConfigError(`Flag ${flag} requires a value.`)
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--jobs':
        args.jobsFile = takeValue('--jobs', i++)
        break
      case '--job':
        args.jobId = takeValue('--job', i++)
        break
      case '--limit': {
        const parsed = Number.parseInt(takeValue('--limit', i++), 10)
        if (!Number.isInteger(parsed) || parsed < 1) throw new ConfigError('--limit must be >= 1.')
        args.limit = parsed
        break
      }
      case '--provider': {
        const value = takeValue('--provider', i++)
        if (value !== 'live' && value !== 'fixture') {
          throw new ConfigError(`--provider must be live or fixture (got "${value}").`)
        }
        args.provider = value
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
      case '--allow-headless-live':
        args.allowHeadlessLive = true
        break
      case '--profile':
        args.profilePath = takeValue('--profile', i++)
        break
      case '--answers':
        args.answersPath = takeValue('--answers', i++)
        break
      case '--selected-track':
        args.selectedTrack = takeValue('--selected-track', i++)
        break
      case '--show-sensitive':
        args.showSensitive = true
        break
      default:
        throw new ConfigError(
          `Unknown flag "${argv[i]}". Usage: npm run flow:map -- --jobs config/jobs.yaml ` +
            '[--job <id>] [--limit <n>] [--provider live|fixture] [--click-apply|--no-click-apply] ' +
            '[--headed|--headless] [--allow-headless-live] [--profile <p>] [--answers <p>] ' +
            '[--selected-track <track>] [--show-sensitive]',
        )
    }
  }
  if (args.provider === 'live' && !args.headed && !args.allowHeadlessLive && process.env['CI'] !== 'true') {
    throw new ConfigError(
      'Live flow mapping must run headed so you can watch it. ' +
        'Pass --headed (default), or explicitly --allow-headless-live / CI=true for headless.',
    )
  }
  return args
}

function flowStamp(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z-flow`
}

async function main(): Promise<void> {
  const args = parseFlowArgs(process.argv.slice(2))
  loadSubmissionPolicy('config/submission_policy.yaml') // hard safety gate

  logger.info('job-apply-agent — Phase 4 flow mapping (read-only)')
  logger.info(
    'Safety: no accounts, no logins, no typing, no form filling, no uploads, no terms, no submissions.',
  )
  logger.info(
    args.clickApply
      ? 'Apply-CTA clicking: ENABLED (at most ONE allow-listed job-page-level click; stops after mapping).\n'
      : 'Apply-CTA clicking: disabled (default).\n',
  )

  const jobsConfig = loadJobsConfig(args.jobsFile)
  const cvRoutingConfig = loadCvRoutingConfig('config/cv_routing.yaml')

  let profile: CandidateProfile | undefined
  let answerBank: AnswerBank | undefined
  if (existsSync(args.profilePath) && existsSync(args.answersPath)) {
    profile = loadProfile(args.profilePath)
    answerBank = loadAnswerBank(args.answersPath)
  } else {
    logger.warn(
      `Profile/answer bank not found (${args.profilePath}, ${args.answersPath}) — packet readiness will be omitted.`,
    )
  }

  let jobs: JobRecord[] = jobsConfig.jobs
  if (args.jobId) {
    jobs = jobs.filter((job) => job.id === args.jobId)
    if (jobs.length === 0) throw new ConfigError(`--job "${args.jobId}" not found in ${args.jobsFile}.`)
  }
  if (args.limit !== null) jobs = jobs.slice(0, args.limit)

  const runDir = path.join('flows', flowStamp(new Date()))
  mkdirSync(runDir, { recursive: true })
  const runLogPath = path.join(runDir, 'action-log.jsonl')
  new ActionLogger([runLogPath]).log({
    event: 'flow_run_start',
    details: { provider: args.provider, clickApply: args.clickApply, jobs: jobs.map((j) => j.id) },
  })

  const provider: ReconProvider =
    args.provider === 'fixture'
      ? new FixtureJobContentProvider({ htmlByJobId: DEFAULT_FIXTURE_PAGES })
      : new PlaywrightJobContentProvider({ headed: args.headed, profileDir: '.browser-profile' })

  const results: FlowMapResult[] = []
  try {
    for (const job of jobs) {
      logger.info(`\n→ ${job.id} (${job.company})`)
      const target = await provider.createTarget(job)
      const flowMap = await buildFlowMap({
        job,
        target,
        jobsConfig,
        cvRoutingConfig,
        ...(profile ? { profile } : {}),
        ...(answerBank ? { answerBank } : {}),
        ...(args.selectedTrack ? { selectedTrack: args.selectedTrack } : {}),
        clickApply: args.clickApply,
        runDir,
        runLogPath,
      })
      results.push(flowMap)
      writeFlowMap(flowMap, runDir)
      logger.info(
        `  platform: ${flowMap.platform} (${flowMap.platformConfidence}) | adapter: ${flowMap.adapter}`,
      )
      logger.info(
        `  state: ${flowMap.postClick?.pageState ?? flowMap.preClick?.pageState ?? 'unknown'} | ` +
          `CTA found: ${flowMap.applyCtaFound} | clicked: ${flowMap.applyCtaClicked} | stop: ${flowMap.stopReason}`,
      )
      logger.info(
        `  checkpoints: ${flowMap.manualCheckpoints.join(', ') || 'none'} | manual review: ${flowMap.manualReviewRequired}`,
      )
      for (const w of flowMap.warnings) {
        logger.warn(`  [${w.code}] ${args.showSensitive ? w.message : maskEmailsInText(w.message)}`)
      }
    }
  } finally {
    await provider.dispose()
  }

  const summary = {
    phase: 4,
    mode: 'flow_mapping_read_only',
    provider: args.provider,
    clickApply: args.clickApply,
    startedAt: new Date().toISOString(),
    runDir: runDir.split('\\').join('/'),
    totals: {
      jobs: results.length,
      applyCtaClickedCount: results.filter((r) => r.applyCtaClicked).length,
      manualReviewCount: results.filter((r) => r.manualReviewRequired).length,
    },
    results,
  }
  const redactedSummary = { ...summary, results: results.map(redactFlowMap) }
  writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  writeFileSync(
    path.join(runDir, 'summary.redacted.json'),
    `${JSON.stringify(redactedSummary, null, 2)}\n`,
    'utf8',
  )
  copyFileSync(path.join(runDir, 'summary.json'), path.join('flows', 'latest-flow-summary.json'))
  copyFileSync(
    path.join(runDir, 'summary.redacted.json'),
    path.join('flows', 'latest-flow-summary.redacted.json'),
  )
  logger.info(`\nFlow maps written to ${runDir} (gitignored).`)
  logger.info(
    `Totals: ${summary.totals.jobs} jobs, ${summary.totals.applyCtaClickedCount} apply click(s), ` +
      `${summary.totals.manualReviewCount} need manual review.`,
  )
}

main().catch((err) => {
  if (err instanceof ConfigError) logger.error(err.message)
  else logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
})
