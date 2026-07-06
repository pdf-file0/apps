import { ConfigError } from '../config/loadConfig'
import { assertNoCredentialLikeContent } from './accountStatus'
import type {
  AccountHistoryEntry,
  AccountRecord,
  AccountStatusFile,
  AccountStatusValue,
  PostLoginAssessment,
} from './types'

export interface AccountTransitionInput {
  accountKey: string
  to: AccountStatusValue
  /** ISO date (YYYY-MM-DD) — passed in by the caller for determinism. */
  at: string
  note?: string
  /** Required only when the account record does not exist yet. */
  company?: string
  portal?: string
  email?: string
  entryUrl?: string
}

/**
 * Pure state transition: returns a NEW status file with the account updated
 * and a history entry appended. Never mutates the input; refuses any note
 * that looks like credential material.
 */
export function recordAccountTransition(
  file: AccountStatusFile,
  input: AccountTransitionInput,
): AccountStatusFile {
  if (input.note !== undefined) {
    assertNoCredentialLikeContent(input.note, `transition note for "${input.accountKey}"`)
  }
  const existing = file.accounts[input.accountKey]
  if (!existing && (!input.company || !input.portal || !input.email)) {
    throw new ConfigError(
      `Unknown account "${input.accountKey}" — provide company, portal, and email to create it ` +
        '(or add it to profiles/account_status.local.yaml first).',
    )
  }

  const from: AccountStatusValue = existing?.status ?? 'unknown'
  const historyEntry: AccountHistoryEntry = {
    at: input.at,
    from,
    to: input.to,
    ...(input.note !== undefined ? { note: input.note } : {}),
  }

  const record: AccountRecord = {
    company: existing?.company ?? input.company!,
    portal: existing?.portal ?? input.portal!,
    email: existing?.email ?? input.email!,
    ...(existing?.entry_url !== undefined || input.entryUrl !== undefined
      ? { entry_url: existing?.entry_url ?? input.entryUrl! }
      : {}),
    status: input.to,
    ...(input.to === 'login_verified' || input.to === 'created'
      ? { last_verified: input.at }
      : existing?.last_verified !== undefined
        ? { last_verified: existing.last_verified }
        : {}),
    ...(existing?.notes !== undefined ? { notes: existing.notes } : {}),
    history: [...(existing?.history ?? []), historyEntry],
  }

  return { accounts: { ...file.accounts, [input.accountKey]: record } }
}

/**
 * Turn a post-login capture into a status-file-safe note: evidence labels
 * only — never page text, URLs with tokens, or anything credential-shaped.
 */
export function buildPostLoginNote(assessment: PostLoginAssessment): string {
  return assessment.signedInLikely
    ? `post-login capture: signed-in signals observed (${assessment.evidence.join('; ')})`
    : 'post-login capture: no signed-in signals observed'
}
