import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadAccountStatusFile } from './accounts/accountStatus'
import { ConfigError, loadCvRoutingConfig, loadJobsConfig, loadSubmissionPolicy } from './config/loadConfig'
import { buildDraftPlan } from './draft/buildDraftPlan'
import { executeDraftPlan } from './draft/executeDraftPlan'
import { runDraftPreflight, VERIFIED_ACCOUNT_STATUS } from './draft/preflight'
import type { DraftFlags, DraftPlan, PreflightResult } from './draft/types'
import { draftRunStamp, writeDraftRun } from './draft/writeDraftRun'
import { evaluateDocumentReadiness } from './documents/documentReadiness'
import { loadDocumentManifest } from './documents/loadDocumentManifest'
import { logger } from './logging/logger'
import { buildApplicationPacket } from './packets/buildApplicationPacket'
import { loadAnswerBank, loadProfile } from './profile/loadProfile'
import { maskEmailsInText } from './profile/redactProfile'
import { ActionLogger } from './reconnaissance/runReconnaissance'
import { evaluateWorkdayPageGuards } from './workday/WorkdayPageGuards'
import {
  FixtureWorkdayTarget,
  LiveWorkdayTarget,
  type WorkdayDraftTarget,
} from './workday/WorkdayDraftAdapter'
import { mapWorkdayFields } from './workday/WorkdayFieldMapper'
import type { FieldActionOutcome } from './workday/types'

const DEFAULT_FIXTURE_PAGE = 'test-pages/workday-my-information.html'

interface DraftArgs {
  jobId: string | null
  jobsFile: string
  profilePath: string
  answersPath: string
  accountsPath: string
  manifestPath: string
  provider: 'live' | 'fixture'
  fixturePage: string
  headed: boolean
  url: string | null
  showSensitive: boolean
  flags: DraftFlags
}

const USAGE =
  'Usage: npm run draft:workday -- --job <id> ' +
  '[--profile <p>] [--answers <p>] [--accounts <p>] [--manifest <p>] ' +
  '[--provider live|fixture] [--fixture-page <p>] [--headed|--headless] [--url <checkpoint>] ' +
  '[--inspect-only] [--fill-safe-fields] [--fill-confirmed-fields] [--fill-draft-answers] ' +
  '[--fill-demographics] [--allow-cv-upload] [--click-apply] [--show-sensitive]'

export function parseDraftArgs(argv: string[]): DraftArgs {
  const args: DraftArgs = {
    jobId: null,
    jobsFile: 'config/jobs.yaml',
    profilePath: 'profiles/candidate_profile.local.yaml',
    answersPath: 'profiles/answer_bank.local.yaml',
    accountsPath: 'profiles/account_status.local.yaml',
    manifestPath: 'config/document_manifest.local.yaml',
    provider: 'live',
    fixturePage: DEFAULT_FIXTURE_PAGE,
    headed: true,
    url: null,
    showSensitive: false,
    flags: {
      provider: 'live',
      headed: true,
      inspectOnly: false,
      fillSafeFields: false, // every fill flag defaults to FALSE
      fillConfirmedFields: false,
      fillDraftAnswers: false,
      fillDemographics: false,
      allowCvUpload: false,
      clickApply: false,
    },
  }
  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new ConfigError(`Flag ${flag} requires a value.`)
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--job':
        args.jobId = takeValue('--job', i++)
        break
      case '--jobs':
        args.jobsFile = takeValue('--jobs', i++)
        break
      case '--profile':
        args.profilePath = takeValue('--profile', i++)
        break
      case '--answers':
        args.answersPath = takeValue('--answers', i++)
        break
      case '--accounts':
        args.accountsPath = takeValue('--accounts', i++)
        break
      case '--manifest':
        args.manifestPath = takeValue('--manifest', i++)
        break
      case '--provider': {
        const value = takeValue('--provider', i++)
        if (value !== 'live' && value !== 'fixture') {
          throw new ConfigError(`--provider must be live or fixture (got "${value}").`)
        }
        args.provider = value
        break
      }
      case '--fixture-page':
        args.fixturePage = takeValue('--fixture-page', i++)
        break
      case '--headed':
        args.headed = true
        break
      case '--headless':
        args.headed = false
        break
      case '--url':
        args.url = takeValue('--url', i++)
        break
      case '--inspect-only':
        args.flags.inspectOnly = true
        break
      case '--fill-safe-fields':
        args.flags.fillSafeFields = true
        break
      case '--fill-confirmed-fields':
        args.flags.fillConfirmedFields = true
        break
      case '--fill-draft-answers':
        args.flags.fillDraftAnswers = true
        break
      case '--fill-demographics':
        args.flags.fillDemographics = true
        break
      case '--allow-cv-upload':
        args.flags.allowCvUpload = true
        break
      case '--click-apply':
        args.flags.clickApply = true
        break
      case '--show-sensitive':
        args.showSensitive = true
        break
      default:
        throw new ConfigError(`Unknown flag "${argv[i]}".\n${USAGE}`)
    }
  }
  if (!args.jobId) throw new ConfigError(`--job <id> is required.\n${USAGE}`)

  const anyFill =
    args.flags.fillSafeFields ||
    args.flags.fillConfirmedFields ||
    args.flags.fillDraftAnswers ||
    args.flags.fillDemographics ||
    args.flags.allowCvUpload
  if (args.flags.inspectOnly && anyFill) {
    throw new ConfigError('--inspect-only cannot be combined with fill/upload flags.')
  }
  if (args.flags.fillConfirmedFields && !args.flags.fillSafeFields) {
    throw new ConfigError('--fill-confirmed-fields requires --fill-safe-fields.')
  }
  // DEFAULT BEHAVIOR: no explicit fill flags -> inspection only.
  if (!anyFill) args.flags.inspectOnly = true
  if (args.provider === 'live' && !args.headed) {
    throw new ConfigError('Live drafting must run HEADED (--headed) so a human watches every action.')
  }
  args.flags.provider = args.provider
  args.flags.headed = args.headed
  return args
}

function printPreflight(preflight: PreflightResult, mask: (t: string) => string): void {
  logger.info('Preflight:')
  for (const check of preflight.checks) {
    logger.info(`  ${check.ok ? 'ok   ' : 'BLOCK'} ${check.id}: ${mask(check.detail)}`)
  }
  logger.info(
    `  capabilities: inspect=${preflight.canInspect} fill-safe=${preflight.canFillSafeFields} ` +
      `fill-confirmed=${preflight.canFillConfirmedFields} upload-cv=${preflight.canUploadCv} ` +
      `final-submit=${preflight.canSubmitFinal} (always false)`,
  )
  for (const blocker of preflight.blockers) {
    logger.warn(`  [${blocker.code}] ${mask(blocker.message)}`)
  }
}

function printPlanSummary(plan: DraftPlan, mask: (t: string) => string): void {
  logger.info(
    `Plan: page=${plan.pageKind} | mutation allowed=${plan.guard.mutationAllowed} | ` +
      `${plan.plannedActions.length} planned, ${plan.blockedActions.length} blocked, ` +
      `${plan.manualReviewItems.length} manual review, ${plan.neverAutoItems.length} never-auto`,
  )
  for (const action of plan.plannedActions) {
    const value = action.proposedValue === null ? '' : ` = ${action.sensitive ? '[redacted]' : mask(action.proposedValue)}`
    logger.info(`  will ${action.type}: ${action.fieldLabel}${value}`)
  }
  for (const block of plan.guard.blocks) {
    logger.warn(`  guard [${block.code}] ${block.evidence}`)
  }
}

async function main(): Promise<void> {
  const args = parseDraftArgs(process.argv.slice(2))
  const mask = args.showSensitive ? (t: string) => t : maskEmailsInText
  loadSubmissionPolicy('config/submission_policy.yaml') // hard safety gate

  logger.info('job-apply-agent — Phase 6 Workday draft engine (Barclays only)')
  logger.info(
    `Mode: ${args.flags.inspectOnly ? 'INSPECT-ONLY (default)' : 'controlled draft-fill'} | provider: ${args.provider}`,
  )
  logger.info(
    'Never: no account creation, no passwords/OTP, no terms, no certification, no captcha, no final submission of any kind.\n',
  )

  const jobsConfig = loadJobsConfig(args.jobsFile)
  const job = jobsConfig.jobs.find((j) => j.id === args.jobId)
  if (!job) throw new ConfigError(`--job "${args.jobId}" not found in ${args.jobsFile}.`)

  const cvRouting = loadCvRoutingConfig('config/cv_routing.yaml')
  const profile = loadProfile(args.profilePath)
  const answerBank = loadAnswerBank(args.answersPath)
  const accountStatusFile = loadAccountStatusFile(args.accountsPath)
  const manifest = loadDocumentManifest(args.manifestPath)
  const documentReadiness = evaluateDocumentReadiness({ manifest, profile, cvRouting })
  const packet = buildApplicationPacket({
    jobId: job.id,
    jobsConfig,
    cvRoutingConfig: cvRouting,
    profile,
    answerBank,
  })

  const preflight = runDraftPreflight({
    job,
    packet,
    profile,
    answerBank,
    accountStatusFile,
    documentReadiness,
    cvRouting,
    flags: args.flags,
  })
  printPreflight(preflight, mask)

  if (!preflight.canInspect) {
    logger.error('Preflight refused the run entirely (see blockers above).')
    process.exitCode = 1
    return
  }
  const refusals: string[] = []
  if (args.flags.fillSafeFields && !preflight.canFillSafeFields) refusals.push('--fill-safe-fields')
  if (args.flags.fillConfirmedFields && !preflight.canFillConfirmedFields) refusals.push('--fill-confirmed-fields')
  if (args.flags.allowCvUpload && !preflight.canUploadCv) refusals.push('--allow-cv-upload')
  if (refusals.length > 0) {
    logger.error(
      `REFUSED: ${refusals.join(', ')} — requirements not met (account must be ` +
        `"${VERIFIED_ACCOUNT_STATUS}", documents clean for uploads). Nothing was opened or filled.`,
    )
    process.exitCode = 1
    return
  }

  const startedAt = new Date().toISOString()
  const runDir = path.join('draft-runs', draftRunStamp(new Date()))
  const actionLogger = new ActionLogger([path.join(runDir, 'action-log.jsonl')])
  actionLogger.log({
    jobId: job.id,
    event: 'draft_run_start',
    details: { provider: args.provider, mode: args.flags.inspectOnly ? 'inspect_only' : 'draft_fill', flags: args.flags },
  })

  const target: WorkdayDraftTarget =
    args.provider === 'fixture'
      ? new FixtureWorkdayTarget(path.resolve(process.cwd(), args.fixturePage))
      : await LiveWorkdayTarget.launch()

  const outcomes: FieldActionOutcome[] = []
  const screenshots: string[] = []
  try {
    const account = accountStatusFile.accounts[preflight.accountKey]
    const checkpointUrl = args.url ?? account?.entry_url ?? job.url
    const opened = await target.openCheckpoint(checkpointUrl, { clickApply: args.flags.clickApply })
    for (const note of opened.notes) logger.info(`  ${mask(note)}`)
    actionLogger.log({ jobId: job.id, event: 'checkpoint_opened', url: opened.finalUrl })

    const scan = await target.scan()
    const uploadRequested = args.flags.allowCvUpload && preflight.canUploadCv
    const guard = evaluateWorkdayPageGuards(scan, { uploadRequested })
    const mappedFields = mapWorkdayFields({
      fields: scan.fields,
      packet,
      answerBank,
      company: job.company,
      jobId: job.id,
      bucket: packet.bucket,
    })
    const plan = buildDraftPlan({
      job,
      packet,
      answerBank,
      documentReadiness,
      mappedFields,
      guard,
      preflight,
      flags: args.flags,
    })
    printPlanSummary(plan, mask)

    const jobDir = path.join(runDir, job.id)
    const shot = async (name: string): Promise<void> => {
      const filePath = path.join(jobDir, 'screenshots', name)
      if (await target.screenshot(filePath)) screenshots.push(filePath.split('\\').join('/'))
    }
    await shot('01-start.png')

    const page = target.livePage()
    if (!args.flags.inspectOnly && plan.plannedActions.length > 0 && page) {
      const executed = await executeDraftPlan({
        page,
        plan,
        recheckGuards: async () =>
          evaluateWorkdayPageGuards(await target.scan(), { uploadRequested }),
        logger: actionLogger,
        uploadGate: preflight.canUploadCv
          ? {
              allowCvUploadFlag: args.flags.allowCvUpload,
              documentReadiness,
              selectedCvKey: packet.selectedCvKey,
              selectedCvPath: packet.selectedCvPath,
              jobBucket: packet.bucket,
              cvRouting,
              guard,
            }
          : null,
      })
      outcomes.push(...executed)
      await shot('02-after-fill.png')
    } else if (!args.flags.inspectOnly && plan.plannedActions.length > 0 && !page) {
      logger.info('Fixture mode: plan built and recorded; no fields were touched (no browser).')
    }
    await shot('03-stop.png')

    writeDraftRun({ runDir, plan, scan, outcomes, flags: args.flags, notes: opened.notes, screenshots, startedAt })
    actionLogger.log({ jobId: job.id, event: 'draft_run_end', details: { executed: outcomes.length } })

    logger.info('')
    logger.info(`Draft run written to ${runDir} (gitignored).`)
    logger.info(
      `Executed: ${outcomes.length} action(s) | ` +
        `${outcomes.filter((o) => o.status === 'failed' || o.status === 'stopped_by_guard').length} stopped/failed.`,
    )
    logger.info('Review the plan before anything more: draft-plan.md in the run directory.')
    logger.info('Final submission remains impossible in Phase 6 — a human does that, always.')
  } finally {
    await target.close()
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) logger.error(err.message)
  else logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
})
