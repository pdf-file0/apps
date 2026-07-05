import type { ReconJobResult, ReconSummary } from '../reconnaissance/types'
import { ReconSummarySchema } from '../reconnaissance/types'

export function buildReconSummary(input: {
  jobsFile: string
  provider: string
  clickApply: boolean
  startedAt: string
  runDir: string
  results: ReconJobResult[]
}): ReconSummary {
  const byStopReason: Record<string, number> = {}
  const byPlatform: Record<string, number> = {}
  for (const result of input.results) {
    byStopReason[result.stopReason] = (byStopReason[result.stopReason] ?? 0) + 1
    byPlatform[result.platform] = (byPlatform[result.platform] ?? 0) + 1
  }

  const summary: ReconSummary = {
    phase: 2,
    mode: 'reconnaissance_dry_run',
    jobsFile: input.jobsFile,
    provider: input.provider,
    clickApply: input.clickApply,
    startedAt: input.startedAt,
    runDir: input.runDir.split('\\').join('/'),
    totals: {
      jobs: input.results.length,
      manualReviewCount: input.results.filter((r) => r.manualReviewRequired).length,
      applyCtaClickedCount: input.results.filter((r) => r.applyCtaClicked).length,
      byStopReason,
      byPlatform,
    },
    results: input.results,
  }
  return ReconSummarySchema.parse(summary)
}
