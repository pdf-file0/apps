import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ConfigError, loadCvRoutingConfig, loadJobsConfig } from './config/loadConfig'
import { logger } from './logging/logger'
import { buildApplicationPacket } from './packets/buildApplicationPacket'
import { redactPacket, writeApplicationPacket } from './packets/writeApplicationPacket'
import type { ApplicationPacket } from './packets/types'
import { loadAnswerBank, loadProfile } from './profile/loadProfile'
import { maskEmailsInText } from './profile/redactProfile'

interface PacketArgs {
  jobId: string | null
  all: boolean
  jobsFile: string
  profilePath: string
  answersPath: string
  selectedTrack: string | null
  showSensitive: boolean
}

function parseArgs(argv: string[]): PacketArgs {
  const args: PacketArgs = {
    jobId: null,
    all: false,
    jobsFile: 'config/jobs.yaml',
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
      case '--job':
        args.jobId = takeValue('--job', i)
        i++
        break
      case '--all':
        args.all = true
        break
      case '--jobs':
        args.jobsFile = takeValue('--jobs', i)
        i++
        break
      case '--profile':
        args.profilePath = takeValue('--profile', i)
        i++
        break
      case '--answers':
        args.answersPath = takeValue('--answers', i)
        i++
        break
      case '--selected-track':
        args.selectedTrack = takeValue('--selected-track', i)
        i++
        break
      case '--show-sensitive':
        args.showSensitive = true
        break
      default:
        throw new ConfigError(
          `Unknown flag "${argv[i]}". Usage: npm run packet -- (--job <id> | --all) ` +
            '[--selected-track <track>] [--profile <path>] [--answers <path>] [--show-sensitive]',
        )
    }
  }
  if (!args.jobId && !args.all) throw new ConfigError('Pass --job <id> or --all.')
  return args
}

function packetStamp(date: Date): string {
  const iso = date.toISOString()
  return `${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, '')}Z-packet`
}

function consoleSummary(packet: ApplicationPacket, showSensitive: boolean): void {
  const summary = showSensitive
    ? packet.candidateFieldSummary.full
    : packet.candidateFieldSummary.redacted
  logger.info(`\n→ ${packet.jobId} (${packet.company})`)
  logger.info(`  bucket: ${packet.bucket}${packet.resolvedTrack ? ` [track: ${packet.resolvedTrack}]` : ''}`)
  logger.info(`  CV: ${packet.selectedCvHumanLabel ?? '—'}`)
  logger.info(`  program type: ${packet.programType}`)
  logger.info(`  applicant: ${summary['name']} <${summary['email']}>`)
  logger.info(
    `  fields: ${packet.safeAutoFillFields.length} safe / ${packet.autoIfConfirmedFields.length} confirm / ` +
      `${packet.demographicFields.length} demographic / ${packet.manualReviewFields.length} manual / ` +
      `${packet.neverAutoFields.length} never-auto`,
  )
  logger.info(
    `  experiences: ${packet.selectedExperiences.map((e) => e.id).join(', ') || '(manual review)'}`,
  )
  logger.info(
    `  readiness: dry-fill=${packet.readiness.ready_for_dry_form_fill} cv-upload=${packet.readiness.ready_for_cv_upload} ` +
      `final-submit=${packet.readiness.ready_for_final_submit} | manual review: ${packet.manualReviewRequired}`,
  )
  for (const warning of packet.warnings) {
    const message = showSensitive ? warning.message : maskEmailsInText(warning.message)
    logger.warn(`  [${warning.code}] ${message}`)
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  logger.info('job-apply-agent — Phase 3 application packets (offline, local only)')
  logger.info(
    'Safety: nothing is submitted or uploaded; packets are local, gitignored review documents.\n',
  )

  const jobsConfig = loadJobsConfig(args.jobsFile)
  const cvRoutingConfig = loadCvRoutingConfig('config/cv_routing.yaml')
  const profile = loadProfile(args.profilePath)
  const answerBank = loadAnswerBank(args.answersPath)

  const jobIds = args.all ? jobsConfig.jobs.map((j) => j.id) : [args.jobId as string]
  const runDir = path.join('packets', packetStamp(new Date()))
  mkdirSync(runDir, { recursive: true })

  const packets: ApplicationPacket[] = []
  for (const jobId of jobIds) {
    const packet = buildApplicationPacket({
      jobId,
      jobsConfig,
      cvRoutingConfig,
      profile,
      answerBank,
      ...(args.selectedTrack ? { selectedTrack: args.selectedTrack } : {}),
    })
    packets.push(packet)
    writeApplicationPacket(packet, runDir)
    consoleSummary(packet, args.showSensitive)
  }

  const summary = { phase: 3, mode: 'application_packets', generated: packets.length, packets }
  const redactedSummary = { ...summary, packets: packets.map(redactPacket) }
  writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  writeFileSync(
    path.join(runDir, 'summary.redacted.json'),
    `${JSON.stringify(redactedSummary, null, 2)}\n`,
    'utf8',
  )
  logger.info(`\nPackets written to ${runDir} (local only — this directory is gitignored).`)
  logger.info(
    `Manual review required: ${packets.filter((p) => p.manualReviewRequired).length}/${packets.length} packet(s).`,
  )
}

try {
  main()
} catch (err) {
  if (err instanceof ConfigError) logger.error(err.message)
  else logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
}
