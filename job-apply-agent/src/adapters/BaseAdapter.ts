import { detectEntryOptions } from '../flow/detectEntryOptions'
import type { AdapterSummary, PageSnapshot, PageStateResult } from '../flow/types'
import { detectExtendedPageState } from '../reconnaissance/detectPageState'
import type { PlatformDetection } from '../reconnaissance/types'
import type { PlatformAdapter } from './types'

/**
 * Base class for read-only platform adapters. Deliberately provides NO
 * interaction primitives: no fillForm, uploadResume, createAccount, signIn,
 * submit, typeIntoField, selectOption, or acceptTerms exist anywhere on the
 * adapter surface in Phase 4.
 */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: PlatformDetection['platform']
  abstract readonly name: string

  /** Blocked-action policy codes for this platform (policy, not visibility). */
  protected abstract readonly blockedActionCodes: readonly string[]

  canHandle(detection: PlatformDetection): boolean {
    return detection.platform === this.platform
  }

  mapEntryState(snapshot: PageSnapshot): PageStateResult {
    return detectExtendedPageState(snapshot)
  }

  detectBlockedActions(_snapshot: PageSnapshot): string[] {
    return [...this.blockedActionCodes]
  }

  abstract detectManualCheckpoints(snapshot: PageSnapshot): string[]

  protected notes(_snapshot: PageSnapshot): string[] {
    return []
  }

  buildAdapterSummary(snapshot: PageSnapshot): AdapterSummary {
    const entryState = this.mapEntryState(snapshot)
    return {
      adapter: this.name,
      platform: this.platform,
      entryState: entryState.state,
      entryStateEvidence: entryState.evidence,
      entryOptions: detectEntryOptions(snapshot),
      blockedActions: this.detectBlockedActions(snapshot),
      manualCheckpoints: [...new Set(this.detectManualCheckpoints(snapshot))].sort(),
      manualReviewRequired: this.platform === 'unknown',
      notes: this.notes(snapshot),
    }
  }

  /** Shared helpers for subclasses. */
  protected hasOptionKind(snapshot: PageSnapshot, ...kinds: string[]): boolean {
    return detectEntryOptions(snapshot).some((o) => kinds.includes(o.kind))
  }

  protected textMatches(snapshot: PageSnapshot, pattern: RegExp): boolean {
    return pattern.test(snapshot.text.toLowerCase())
  }
}
