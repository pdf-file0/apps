import { BUCKET_VALUES, RunSummarySchema } from '../config/schemas'
import type { Bucket, JobResult, RunSummary, Warning } from '../intelligence/types'

/**
 * Build the deterministic run summary written to
 * runs/latest-classification-summary.json. No timestamps, stable key order:
 * identical inputs always produce byte-identical output.
 */
export function buildRunSummary(input: {
  jobsFile: string
  results: JobResult[]
  candidateDocumentWarnings: Warning[]
}): RunSummary {
  const byBucket = {} as Record<Bucket, number>
  for (const bucket of BUCKET_VALUES) byBucket[bucket] = 0
  for (const result of input.results) byBucket[result.classification.bucket] += 1

  const summary: RunSummary = {
    phase: 1,
    mode: 'classification_only',
    jobsFile: input.jobsFile,
    totals: {
      jobs: input.results.length,
      byBucket,
      manualReviewCount: input.results.filter((r) => r.cvSelection.requiresManualReview).length,
      warningsCount: input.results.reduce((n, r) => n + r.classification.warnings.length, 0),
    },
    candidateDocumentWarnings: input.candidateDocumentWarnings,
    results: input.results,
  }

  return RunSummarySchema.parse(summary)
}
