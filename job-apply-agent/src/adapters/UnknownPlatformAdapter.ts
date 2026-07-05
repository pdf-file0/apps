import type { PageSnapshot } from '../flow/types'
import type { PlatformDetection } from '../reconnaissance/types'
import { BaseAdapter } from './BaseAdapter'

/**
 * Fallback when no platform matched. Proposes NO automated action of any
 * kind and always requires manual review.
 */
export class UnknownPlatformAdapter extends BaseAdapter {
  readonly platform = 'unknown' as const
  readonly name = 'UnknownPlatformAdapter'
  protected readonly blockedActionCodes = ['all_interactions'] as const

  override canHandle(_detection: PlatformDetection): boolean {
    return true // catch-all, registered last
  }

  detectManualCheckpoints(_snapshot: PageSnapshot): string[] {
    return ['platform_unknown']
  }

  protected override notes(_snapshot: PageSnapshot): string[] {
    return ['Unknown platform: no automated action is proposed; a human must review this flow.']
  }
}
