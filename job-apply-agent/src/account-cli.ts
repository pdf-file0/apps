import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import {
  AccountStatusValueSchema,
  loadAccountStatusFile,
  saveAccountStatusFile,
} from './accounts/accountStatus'
import { buildAccountSetupPlan } from './accounts/accountSetupPlan'
import { runAccountSetup } from './accounts/accountSetupRunner'
import { buildPostLoginNote, recordAccountTransition } from './accounts/accountStateRecorder'
import type { AccountSetupPlan, AccountStatusValue } from './accounts/types'
import { ConfigError, loadCvRoutingConfig, loadJobsConfig } from './config/loadConfig'
import { evaluateDocumentReadiness } from './documents/documentReadiness'
import { loadDocumentManifest } from './documents/loadDocumentManifest'
import type { DocumentReadiness } from './documents/types'
import { logger } from './logging/logger'
import { loadProfile } from './profile/loadProfile'
import { maskEmail, maskEmailsInText } from './profile/redactProfile'

const DEFAULT_STATUS_FILE = 'profiles/account_status.local.yaml'
const DEFAULT_JOBS = 'config/jobs.yaml'
const DEFAULT_MANIFEST = 'config/document_manifest.local.yaml'
const DEFAULT_PROFILE = 'profiles/candidate_profile.local.yaml'

type Command = 'list' | 'plan' | 'setup' | 'record'

interface AccountCliArgs {
  command: Command
  statusFile: string
  jobsFile: string
  manifestPath: string
  profilePath: string
  jobId: string | null
  url: string | null
  capture: boolean
  mark: AccountStatusValue | null
  accountKey: string | null
  status: AccountStatusValue | null
  note: string | null
  company: string | null
  portal: string | null
  email: string | null
  showSensitive: boolean
}

const USAGE =
  'Usage:\n' +
  '  npm run accounts:list\n' +
  '  npm run accounts:plan  -- --job <id> [--url <checkpoint>]\n' +
  '  npm run accounts:setup -- --job <id> [--url <checkpoint>] [--capture] [--mark <status>]\n' +
  '  npm run accounts:record -- --account <key> --status <status> [--note <text>] ' +
  '[--company <c> --portal <p> --email <e>]\n' +
  'Common flags: [--status-file <path>] [--jobs <path>] [--manifest <path>] [--profile <path>] [--show-sensitive]'

function parseArgs(argv: string[]): AccountCliArgs {
  const command = argv[0]
  if (command !== 'list' && command !== 'plan' && command !== 'setup' && command !== 'record') {
    throw new ConfigError(USAGE)
  }
  const args: AccountCliArgs = {
    command,
    statusFile: DEFAULT_STATUS_FILE,
    jobsFile: DEFAULT_JOBS,
    manifestPath: DEFAULT_MANIFEST,
    profilePath: DEFAULT_PROFILE,
    jobId: null,
    url: null,
    capture: false,
    mark: null,
    accountKey: null,
    status: null,
    note: null,
    company: null,
    portal: null,
    email: null,
    showSensitive: false,
  }
  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new ConfigError(`Flag ${flag} requires a value.`)
    return value
  }
  const parseStatus = (flag: string, value: string): AccountStatusValue => {
    const result = AccountStatusValueSchema.safeParse(value)
    if (!result.success) {
      throw new ConfigError(
        `${flag} must be one of: ${AccountStatusValueSchema.options.join(', ')} (got "${value}").`,
      )
    }
    return result.data
  }
  for (let i = 1; i < argv.length; i++) {
    switch (argv[i]) {
      case '--status-file':
        args.statusFile = takeValue('--status-file', i++)
        break
      case '--jobs':
        args.jobsFile = takeValue('--jobs', i++)
        break
      case '--manifest':
        args.manifestPath = takeValue('--manifest', i++)
        break
      case '--profile':
        args.profilePath = takeValue('--profile', i++)
        break
      case '--job':
        args.jobId = takeValue('--job', i++)
        break
      case '--url':
        args.url = takeValue('--url', i++)
        break
      case '--capture':
        args.capture = true
        break
      case '--mark':
        args.mark = parseStatus('--mark', takeValue('--mark', i++))
        break
      case '--account':
        args.accountKey = takeValue('--account', i++)
        break
      case '--status':
        args.status = parseStatus('--status', takeValue('--status', i++))
        break
      case '--note':
        args.note = takeValue('--note', i++)
        break
      case '--company':
        args.company = takeValue('--company', i++)
        break
      case '--portal':
        args.portal = takeValue('--portal', i++)
        break
      case '--email':
        args.email = takeValue('--email', i++)
        break
      case '--show-sensitive':
        args.showSensitive = true
        break
      default:
        throw new ConfigError(`Unknown flag "${argv[i]}".\n${USAGE}`)
    }
  }
  return args
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadReadinessIfAvailable(args: AccountCliArgs): DocumentReadiness | undefined {
  if (!existsSync(args.manifestPath)) {
    logger.warn(
      `Document manifest not found (${args.manifestPath}) — treating CV upload as blocked.`,
    )
    return undefined
  }
  const manifest = loadDocumentManifest(args.manifestPath)
  const profile = existsSync(args.profilePath) ? loadProfile(args.profilePath) : undefined
  const cvRouting = loadCvRoutingConfig('config/cv_routing.yaml')
  return evaluateDocumentReadiness({ manifest, ...(profile ? { profile } : {}), cvRouting })
}

function buildPlanFromArgs(args: AccountCliArgs): AccountSetupPlan {
  if (!args.jobId) throw new ConfigError(`--job <id> is required.\n${USAGE}`)
  const jobsConfig = loadJobsConfig(args.jobsFile)
  const job = jobsConfig.jobs.find((j) => j.id === args.jobId)
  if (!job) throw new ConfigError(`--job "${args.jobId}" not found in ${args.jobsFile}.`)
  const statusFile = loadAccountStatusFile(args.statusFile, { allowMissing: true })
  const readiness = loadReadinessIfAvailable(args)
  const fallbackEmail = existsSync(args.profilePath)
    ? loadProfile(args.profilePath).candidate.preferred_application_email
    : undefined
  return buildAccountSetupPlan({
    job,
    statusFile,
    ...(readiness ? { documentReadiness: readiness } : {}),
    ...(fallbackEmail ? { fallbackEmail } : {}),
    ...(args.url ? { overrideUrl: args.url } : {}),
  })
}

function printPlan(plan: AccountSetupPlan, mask: (text: string) => string): void {
  logger.info(`Account setup plan — ${plan.jobId} (${plan.company})`)
  logger.info(`  portal:     ${plan.portal}`)
  logger.info(`  account:    ${plan.accountKey} (status: ${plan.currentStatus})`)
  logger.info(`  email:      ${plan.accountEmail ? mask(plan.accountEmail) : '(unknown — decide yourself)'}`)
  logger.info(`  checkpoint: ${plan.checkpointUrl} (${plan.checkpointSource})`)
  logger.info(`  pause:      ${plan.pauseReason}`)
  logger.info('')
  logger.info('The agent will ONLY:')
  for (const action of plan.agentActions) logger.info(`  - ${action}`)
  logger.info('')
  logger.info('YOU do, in the browser window:')
  plan.humanSteps.forEach((step, index) => logger.info(`  ${index + 1}. ${mask(step)}`))
  logger.info('')
  logger.info('The agent will NEVER:')
  for (const action of plan.neverActions) logger.info(`  - ${action}`)
  if (plan.documentWarnings.length > 0) {
    logger.info('')
    logger.info('Document blockers (CV upload stays blocked):')
    for (const warning of plan.documentWarnings) logger.warn(`  ${mask(warning)}`)
  }
}

function listAccounts(args: AccountCliArgs, mask: boolean): void {
  const file = loadAccountStatusFile(args.statusFile, { allowMissing: true })
  const entries = Object.entries(file.accounts)
  if (entries.length === 0) {
    logger.info(`No accounts tracked yet (${args.statusFile}).`)
    return
  }
  logger.info(`Account status (${args.statusFile}):`)
  for (const [key, account] of entries) {
    const email = mask ? maskEmail(account.email) : account.email
    logger.info(
      `  ${key}: ${account.status} | ${account.company} via ${account.portal} | ${email} | ` +
        `last verified: ${account.last_verified ?? '—'} | history: ${account.history.length} entr${account.history.length === 1 ? 'y' : 'ies'}`,
    )
  }
}

function recordCommand(args: AccountCliArgs): void {
  if (!args.accountKey || !args.status) {
    throw new ConfigError(`record needs --account <key> and --status <status>.\n${USAGE}`)
  }
  const file = loadAccountStatusFile(args.statusFile, { allowMissing: true })
  const updated = recordAccountTransition(file, {
    accountKey: args.accountKey,
    to: args.status,
    at: today(),
    ...(args.note ? { note: args.note } : {}),
    ...(args.company ? { company: args.company } : {}),
    ...(args.portal ? { portal: args.portal } : {}),
    ...(args.email ? { email: args.email } : {}),
  })
  saveAccountStatusFile(args.statusFile, updated)
  logger.info(`Recorded ${args.accountKey} → ${args.status} in ${args.statusFile}.`)
}

async function setupCommand(args: AccountCliArgs, mask: (text: string) => string): Promise<void> {
  const plan = buildPlanFromArgs(args)
  printPlan(plan, mask)
  logger.info('')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const result = await runAccountSetup({
    plan,
    capture: args.capture,
    waitForHuman: async (message) => {
      await rl.question(message)
    },
    log: (message) => logger.info(message),
  }).finally(() => rl.close())

  if (!result.opened) {
    logger.warn(`Checkpoint page did not load: ${result.openError ?? 'unknown error'}`)
  }

  if (result.postLogin) {
    logger.info('')
    logger.info(
      `Post-login capture: signedInLikely=${result.postLogin.signedInLikely} | ` +
        `evidence: ${result.postLogin.evidence.join('; ') || 'none'}`,
    )
    const captureDir = path.join('runs', `${today()}-account-setup`)
    mkdirSync(captureDir, { recursive: true })
    const capturePath = path.join(captureDir, `${plan.accountKey}.json`)
    writeFileSync(
      capturePath,
      `${JSON.stringify(
        {
          accountKey: plan.accountKey,
          jobId: plan.jobId,
          checkpointUrl: plan.checkpointUrl,
          capturedAt: today(),
          url: maskEmailsInText(result.postLogin.url),
          title: maskEmailsInText(result.postLogin.title),
          signedInLikely: result.postLogin.signedInLikely,
          evidence: result.postLogin.evidence,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    logger.info(`Capture written to ${capturePath} (gitignored).`)
  }

  const markStatus: AccountStatusValue | null =
    args.mark ?? (result.postLogin?.signedInLikely ? 'created' : null)
  if (markStatus) {
    const file = loadAccountStatusFile(args.statusFile, { allowMissing: true })
    const updated = recordAccountTransition(file, {
      accountKey: plan.accountKey,
      to: markStatus,
      at: today(),
      note: result.postLogin
        ? buildPostLoginNote(result.postLogin)
        : 'manual setup session (no capture)',
      ...(plan.accountEmail
        ? { company: plan.company, portal: plan.portal, email: plan.accountEmail, entryUrl: plan.checkpointUrl }
        : {}),
    })
    saveAccountStatusFile(args.statusFile, updated)
    logger.info(`Recorded ${plan.accountKey} → ${markStatus} in ${args.statusFile}.`)
  } else {
    logger.info(
      'Account status unchanged. Record it yourself with: ' +
        `npm run accounts:record -- --account ${plan.accountKey} --status <status>`,
    )
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const mask = args.showSensitive ? (text: string) => text : maskEmailsInText
  switch (args.command) {
    case 'list':
      listAccounts(args, !args.showSensitive)
      return
    case 'plan':
      printPlan(buildPlanFromArgs(args), mask)
      return
    case 'record':
      recordCommand(args)
      return
    case 'setup':
      await setupCommand(args, mask)
      return
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) logger.error(err.message)
  else logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
})
