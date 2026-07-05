import type { JobRecord } from '../intelligence/types'
import type { ReconJobTarget, ReconProvider } from './JobContentProvider'

/**
 * Seam only. A Firecrawl-backed provider could fetch rendered page text
 * without driving a local browser, but Phase 2 does not implement it and
 * deliberately does not require an API key. Selecting it fails with a clear
 * message instead of half-working.
 */
export class FirecrawlJobContentProvider implements ReconProvider {
  readonly name = 'firecrawl'

  async createTarget(_job: JobRecord): Promise<ReconJobTarget> {
    throw new Error(
      'The firecrawl provider is a future seam and is not implemented in Phase 2. ' +
        'Use --provider live (default) or --provider fixture. ' +
        'A future phase may implement it behind FIRECRAWL_API_KEY (never committed to the repo).',
    )
  }

  async dispose(): Promise<void> {}
}
