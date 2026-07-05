import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  ConfigError,
  loadCandidateProfileConfig,
  loadCvRoutingConfig,
  loadJobsConfig,
  loadSubmissionPolicy,
} from './config/loadConfig'
import { classifyRole } from './intelligence/classifyRole'
import { selectCv } from './intelligence/selectCv'
import type { JobResult } from './intelligence/types'
import { logger } from './logging/logger'
import { buildRunSummary } from './reporting/buildRunSummary'

const CV_ROUTING_FILE = 'config/cv_routing.yaml'
const CANDIDATE_PROFILE_FILE = 'config/candidate_profile.schema.yaml'
const SUBMISSION_POLICY_FILE = 'config/submission_policy.yaml'
const SUMMARY_FILE = path.join('runs', 'latest-classification-summary.json')

function parseArgs(argv: string[]): { jobsFile: string } {
  const flagIndex = argv.indexOf('--jobs')
  if (flagIndex >= 0) {
    const value = argv[flagIndex + 1]
    if (!value || value.startsWith('--')) {
      throw new ConfigError('Usage: npm run classify -- --jobs config/jobs.yaml')
    }
    return { jobsFile: value }
  }
  return { jobsFile: 'config/jobs.yaml' }
}

function renderTable(header: string[], rows: string[][]): string {
  const all = [header, ...rows]
  const widths = header.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)))
  const line = (row: string[]) =>
    row.map((cell, col) => cell.padEnd(widths[col] ?? cell.length)).join('  | ')
  const separator = widths.map((w) => '-'.repeat(w)).join('--|-')
  return [line(header), separator, ...rows.map(line)].join('\n')
}

function main(): void {
  const { jobsFile } = parseArgs(process.argv.slice(2))

  // Safety gate: validation fails hard if any risky flag is flipped on.
  loadSubmissionPolicy(SUBMISSION_POLICY_FILE)
  logger.info('job-apply-agent — Phase 1 (classification only)')
  logger.info(
    'Safety: no applications submitted, no accounts created, no CVs uploaded, no browser automation.\n',
  )

  const cvRouting = loadCvRoutingConfig(CV_ROUTING_FILE)
  const candidateProfile = loadCandidateProfileConfig(CANDIDATE_PROFILE_FILE)
  const jobsConfig = loadJobsConfig(jobsFile)

  const results: JobResult[] = []
  for (const job of jobsConfig.jobs) {
    const fixturePath = path.resolve(process.cwd(), job.fixture)
    if (!existsSync(fixturePath)) {
      throw new ConfigError(`Job "${job.id}": fixture file not found: ${job.fixture}`)
    }
    const jobText = readFileSync(fixturePath, 'utf8')
    const classification = classifyRole(jobText, {
      id: job.id,
      company: job.company,
      url: job.url,
      platformHint: job.platformHint,
      expectedBucket: job.expectedBucket,
      programTypeHint: job.programTypeHint,
      trackRouting: job.trackRouting,
    })
    const cvSelection = selectCv(classification, cvRouting)
    results.push({
      jobId: job.id,
      company: job.company,
      url: job.url,
      ...(job.platformHint !== undefined ? { platformHint: job.platformHint } : {}),
      classification,
      cvSelection,
      ...(job.trackRouting !== undefined ? { trackRouting: job.trackRouting } : {}),
    })
  }

  const table = renderTable(
    ['Job ID', 'Bucket', 'Selected CV', 'Confidence', 'Warnings'],
    results.map((r) => [
      r.jobId,
      r.classification.bucket,
      r.cvSelection.humanLabel,
      r.classification.confidence,
      r.classification.warnings.map((w) => w.code).join(', ') || '-',
    ]),
  )
  logger.info(table)

  const withWarnings = results.filter((r) => r.classification.warnings.length > 0)
  if (withWarnings.length > 0) {
    logger.info('\nWarnings detail:')
    for (const r of withWarnings) {
      for (const w of r.classification.warnings) {
        logger.warn(`${r.jobId}: [${w.code}] ${w.message}`)
      }
    }
  }

  if (candidateProfile.documentWarnings.length > 0) {
    logger.info('\nCandidate document warnings (details in the JSON summary):')
    for (const w of candidateProfile.documentWarnings) {
      logger.warn(`[${w.code}]`)
    }
  }

  const missingCvPaths = [
    ...new Set(
      results
        .map((r) => r.cvSelection.selectedCvPath)
        .filter((p): p is string => p !== null && !existsSync(path.resolve(process.cwd(), p))),
    ),
  ]
  if (missingCvPaths.length > 0) {
    logger.info('')
    logger.warn(
      `CV placeholder file(s) not found on disk (expected in Phase 1): ${missingCvPaths.join(', ')}. Add the PDFs before Phase 2.`,
    )
  }

  const summary = buildRunSummary({
    jobsFile,
    results,
    candidateDocumentWarnings: candidateProfile.documentWarnings,
  })
  mkdirSync('runs', { recursive: true })
  writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  logger.info(`\nSummary written to ${SUMMARY_FILE}`)
  logger.info(
    `Totals: ${summary.totals.jobs} jobs, ${summary.totals.manualReviewCount} need manual review, ${summary.totals.warningsCount} warnings.`,
  )
}

try {
  main()
} catch (err) {
  if (err instanceof ConfigError) {
    logger.error(err.message)
  } else {
    logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  }
  process.exitCode = 1
}
