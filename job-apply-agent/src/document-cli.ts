import { existsSync } from 'node:fs'
import { ConfigError, loadCvRoutingConfig } from './config/loadConfig'
import { evaluateDocumentReadiness } from './documents/documentReadiness'
import { loadDocumentManifest } from './documents/loadDocumentManifest'
import type { DocumentBlocker } from './documents/types'
import { logger } from './logging/logger'
import { loadProfile } from './profile/loadProfile'
import { maskEmailsInText } from './profile/redactProfile'
import type { CandidateProfile } from './profile/types'

const DEFAULT_MANIFEST = 'config/document_manifest.local.yaml'
const DEFAULT_PROFILE = 'profiles/candidate_profile.local.yaml'
const CV_ROUTING = 'config/cv_routing.yaml'

interface DocumentCliArgs {
  command: 'validate' | 'readiness'
  manifestPath: string
  profilePath: string
  showSensitive: boolean
}

function parseArgs(argv: string[]): DocumentCliArgs {
  const command = argv[0]
  if (command !== 'validate' && command !== 'readiness') {
    throw new ConfigError(
      'Usage: npm run documents:validate | npm run documents:readiness ' +
        '[-- --manifest <path>] [--profile <path>] [--show-sensitive]',
    )
  }
  const args: DocumentCliArgs = {
    command,
    manifestPath: DEFAULT_MANIFEST,
    profilePath: DEFAULT_PROFILE,
    showSensitive: false,
  }
  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new ConfigError(`Flag ${flag} requires a value.`)
    return value
  }
  for (let i = 1; i < argv.length; i++) {
    switch (argv[i]) {
      case '--manifest':
        args.manifestPath = takeValue('--manifest', i++)
        break
      case '--profile':
        args.profilePath = takeValue('--profile', i++)
        break
      case '--show-sensitive':
        args.showSensitive = true
        break
      default:
        throw new ConfigError(`Unknown flag "${argv[i]}".`)
    }
  }
  return args
}

function printBlocker(blocker: DocumentBlocker, mask: (text: string) => string): void {
  logger.warn(`[${blocker.code}]${blocker.documentKey ? ` (${blocker.documentKey})` : ''} ${mask(blocker.message)}`)
  logger.info(`    fix: ${mask(blocker.resolution)}`)
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const mask = args.showSensitive ? (text: string) => text : maskEmailsInText
  const manifest = loadDocumentManifest(args.manifestPath)

  if (args.command === 'validate') {
    logger.info(`Document manifest OK: ${args.manifestPath}`)
    logger.info(
      `Documents: ${manifest.documents.length} | required CVs: ${manifest.required_cv_keys.join(', ')} | ` +
        `NS status: ${manifest.national_service_status}`,
    )
    for (const doc of manifest.documents) {
      logger.info(`  - ${doc.key} (${doc.kind}) → ${doc.path}`)
    }
    return
  }

  // readiness — the Phase 5 gate.
  let profile: CandidateProfile | undefined
  if (existsSync(args.profilePath)) {
    profile = loadProfile(args.profilePath)
  } else {
    logger.warn(`Profile not found (${args.profilePath}) — profile-based checks skipped.`)
  }
  const cvRouting = loadCvRoutingConfig(CV_ROUTING)
  const readiness = evaluateDocumentReadiness({
    manifest,
    ...(profile ? { profile } : {}),
    cvRouting,
  })

  logger.info('Document readiness gate (Phase 5)')
  logger.info('')
  for (const doc of readiness.perDocument) {
    logger.info(`${doc.key} (${doc.kind}) — ${doc.path}`)
    for (const check of doc.checks) {
      const label = check.ok ? 'ok ' : doc.kind === 'cv' ? 'BLOCK' : 'warn '
      logger.info(`  ${label} ${check.check}: ${mask(check.detail)}`)
    }
  }

  if (readiness.blockers.length > 0) {
    logger.info('')
    logger.info(`Blockers (${readiness.blockers.length}) — CV upload stays impossible until ALL are resolved:`)
    for (const blocker of readiness.blockers) printBlocker(blocker, mask)
  }
  if (readiness.manualReviewItems.length > 0) {
    logger.info('')
    logger.info('Manual review if asked:')
    for (const item of readiness.manualReviewItems) printBlocker(item, mask)
  }
  if (readiness.warnings.length > 0) {
    logger.info('')
    for (const warning of readiness.warnings) logger.warn(mask(warning))
  }

  logger.info('')
  logger.info(
    readiness.ready_for_cv_upload
      ? 'ready_for_cv_upload: true — document blockers are clear (uploads still require a later phase and a human).'
      : 'ready_for_cv_upload: false — CV upload is BLOCKED.',
  )
  logger.info('ready_for_final_submit: false (always, by design)')
  if (!readiness.ready_for_cv_upload) process.exitCode = 1
}

try {
  main()
} catch (err) {
  if (err instanceof ConfigError) logger.error(err.message)
  else logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
}
