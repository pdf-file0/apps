import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { ConfigError } from '../config/loadConfig'
import type { AccountStatusFile } from './types'

// ---------------------------------------------------------------------------
// Local account status — tracks WHETHER portal accounts exist. It must never
// hold credential material: the schema rejects credential-looking free text,
// and .strict() rejects any extra key (password:, token:, …) outright.
// ---------------------------------------------------------------------------

export const CREDENTIAL_LIKE_PATTERN =
  /(password|passwd|pwd|otp|one[-_ ]?time[-_ ]?(code|password)|token|cookie|secret|session[-_ ]?id)\s*[:=]/i

export function assertNoCredentialLikeContent(text: string, where: string): void {
  if (CREDENTIAL_LIKE_PATTERN.test(text)) {
    throw new ConfigError(
      `${where} looks like it contains credential material (password/OTP/token/cookie/secret). ` +
        'Account records must NEVER store credentials — remove it.',
    )
  }
}

const safeText = (what: string) =>
  z
    .string()
    .min(1)
    .refine((text) => !CREDENTIAL_LIKE_PATTERN.test(text), {
      message: `${what} must never contain credential material (password/OTP/token/cookie/secret)`,
    })

export const AccountStatusValueSchema = z.enum([
  'not_created',
  'created_pending_verification',
  'created',
  'login_verified',
  'unknown',
])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const AccountHistoryEntrySchema = z
  .object({
    at: z.string().regex(ISO_DATE, 'must be YYYY-MM-DD'),
    from: AccountStatusValueSchema,
    to: AccountStatusValueSchema,
    note: safeText('history note').optional(),
  })
  .strict()

export const AccountRecordSchema = z
  .object({
    company: z.string().min(1),
    portal: z.string().min(1),
    email: z.string().email(),
    entry_url: z.string().url().optional(),
    status: AccountStatusValueSchema,
    last_verified: z.string().regex(ISO_DATE, 'must be YYYY-MM-DD').optional(),
    notes: safeText('account notes').optional(),
    history: z.array(AccountHistoryEntrySchema).default([]),
  })
  .strict()

export const AccountStatusFileSchema = z
  .object({
    accounts: z.record(z.string(), AccountRecordSchema),
  })
  .strict()

export interface LoadAccountStatusOptions {
  /** When true, a missing file yields an empty account list instead of erroring. */
  allowMissing?: boolean
}

export function parseAccountStatusFile(yamlText: string, source = 'inline yaml'): AccountStatusFile {
  let data: unknown
  try {
    data = parse(yamlText)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(`Malformed YAML in account status file (${source}): ${detail}`)
  }
  const result = AccountStatusFileSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new ConfigError(`Invalid account status file (${source}):\n${issues}`)
  }
  return result.data
}

export function loadAccountStatusFile(
  filePath: string,
  options: LoadAccountStatusOptions = {},
): AccountStatusFile {
  if (!existsSync(filePath)) {
    if (options.allowMissing) return { accounts: {} }
    throw new ConfigError(
      `Cannot read account status file "${filePath}".\n` +
        'Local account status files are gitignored — create one from profiles/account_status.example.yaml.',
    )
  }
  return parseAccountStatusFile(readFileSync(filePath, 'utf8'), filePath)
}

const FILE_HEADER = [
  '# Local account status — gitignored. Tracks WHETHER portal accounts exist,',
  '# never how to get into them. NEVER store passwords, OTPs, cookies, session',
  '# tokens, or security answers here.',
].join('\n')

export function saveAccountStatusFile(filePath: string, file: AccountStatusFile): void {
  // Re-validate on the way out so a bad in-memory object can never be persisted.
  const result = AccountStatusFileSchema.safeParse(file)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new ConfigError(`Refusing to save invalid account status file:\n${issues}`)
  }
  writeFileSync(filePath, `${FILE_HEADER}\n\n${stringify(result.data)}`, 'utf8')
}
