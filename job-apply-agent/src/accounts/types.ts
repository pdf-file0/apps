import type { z } from 'zod'
import type {
  AccountHistoryEntrySchema,
  AccountRecordSchema,
  AccountStatusFileSchema,
  AccountStatusValueSchema,
} from './accountStatus'

export type AccountStatusValue = z.infer<typeof AccountStatusValueSchema>
export type AccountHistoryEntry = z.infer<typeof AccountHistoryEntrySchema>
export type AccountRecord = z.infer<typeof AccountRecordSchema>
export type AccountStatusFile = z.infer<typeof AccountStatusFileSchema>

export type PortalKey = 'workday' | 'oracle_recruiting' | 'impress_ai' | 'talnet' | 'unknown'

/**
 * A fully assembled, human-first setup plan. The agent's entire role is the
 * agentActions list (open, navigate, observe, wait); everything that touches
 * the account itself lives in humanSteps.
 */
export interface AccountSetupPlan {
  jobId: string
  company: string
  portal: PortalKey
  accountKey: string
  /** Which email the human should register with; null when unknown. */
  accountEmail: string | null
  currentStatus: AccountStatusValue
  checkpointUrl: string
  checkpointSource: 'override' | 'account_entry_url' | 'job_url'
  agentActions: string[]
  humanSteps: string[]
  neverActions: string[]
  documentWarnings: string[]
  pauseReason: string
}

export interface PostLoginAssessment {
  signedInLikely: boolean
  evidence: string[]
}

export interface AccountSetupRunResult {
  checkpointUrl: string
  opened: boolean
  openError: string | null
  observedTitle: string | null
  /** Present only when the run was asked to capture after the human confirmed. */
  postLogin: (PostLoginAssessment & { url: string; title: string }) | null
}
