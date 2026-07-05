import type { PlatformDetection } from '../reconnaissance/types'
import { ImpressAiAdapter } from './ImpressAiAdapter'
import { OracleRecruitingAdapter } from './OracleRecruitingAdapter'
import { TalNetAdapter } from './TalNetAdapter'
import type { PlatformAdapter } from './types'
import { UnknownPlatformAdapter } from './UnknownPlatformAdapter'
import { WorkdayAdapter } from './WorkdayAdapter'

export class AdapterRegistry {
  private readonly adapters: PlatformAdapter[]
  private readonly fallback: PlatformAdapter

  constructor(adapters?: PlatformAdapter[], fallback?: PlatformAdapter) {
    this.adapters = adapters ?? [
      new WorkdayAdapter(),
      new TalNetAdapter(),
      new OracleRecruitingAdapter(),
      new ImpressAiAdapter(),
    ]
    this.fallback = fallback ?? new UnknownPlatformAdapter()
  }

  select(detection: PlatformDetection): PlatformAdapter {
    return this.adapters.find((adapter) => adapter.canHandle(detection)) ?? this.fallback
  }
}

export const defaultAdapterRegistry = new AdapterRegistry()
