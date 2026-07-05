import type { AdapterSummary, EntryOption, PageSnapshot, PageStateResult } from '../flow/types'
import type { PlatformDetection } from '../reconnaissance/types'

export type { AdapterSummary, EntryOption, PageSnapshot, PageStateResult, PlatformDetection }

/**
 * Phase 4 adapters are strictly NON-MUTATING observers. The contract has no
 * fill/type/upload/select/submit/accept surface at all — those capabilities
 * do not exist in this phase and can only be added later behind explicit
 * safety gates.
 */
export interface PlatformAdapter {
  readonly platform: PlatformDetection['platform']
  readonly name: string
  canHandle(detection: PlatformDetection): boolean
  mapEntryState(snapshot: PageSnapshot): PageStateResult
  detectBlockedActions(snapshot: PageSnapshot): string[]
  detectManualCheckpoints(snapshot: PageSnapshot): string[]
  buildAdapterSummary(snapshot: PageSnapshot): AdapterSummary
}
