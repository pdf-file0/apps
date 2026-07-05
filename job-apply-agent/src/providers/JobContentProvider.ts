import type { ClickOutcome, CtaCandidate, OpenResult, PageView } from '../browser/types'
import type { JobRecord } from '../intelligence/types'

// Phase 1 seam (simple text fetch) re-exported for continuity.
export type { JobContentProvider } from '../intelligence/types'

/**
 * A reconnaissance target for one job: open the page, observe it, take
 * screenshots, and (at most) click one pre-validated job-page-level Apply
 * CTA. The interface intentionally offers NO way to fill fields, upload
 * files, accept terms, or submit anything.
 */
export interface ReconJobTarget {
  open(url: string): Promise<OpenResult>
  view(): Promise<PageView>
  /** Best-effort; returns false when unsupported (fixture) or capture fails. */
  screenshot(filePath: string): Promise<boolean>
  clickCta(cta: CtaCandidate): Promise<ClickOutcome>
  close(): Promise<void>
}

export interface ReconProvider {
  readonly name: string
  createTarget(job: JobRecord): Promise<ReconJobTarget>
  dispose(): Promise<void>
}
