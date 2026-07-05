import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigError } from '../config/loadConfig'
import { AnswerBankSchema, CandidateProfileFileSchema } from './schemas'
import type { AnswerBank, CandidateProfile } from './types'
import { validateProfile } from './validateProfile'

function readYaml(filePath: string, what: string): unknown {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(
      `Cannot read ${what} file "${filePath}": ${detail}\n` +
        `Local ${what} files are gitignored — create one from the committed *.example.yaml.`,
    )
  }
  try {
    return parse(text)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(`Malformed YAML in ${what} file (${filePath}): ${detail}`)
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

export interface LoadProfileOptions {
  /**
   * When true, loading FAILS if any unresolved item is blocking — used by
   * future phases that prepare uploads/submissions. Phase 3 commands load
   * with finalReadyMode: false and surface the warnings instead.
   */
  finalReadyMode?: boolean
}

export function loadProfile(profilePath: string, options: LoadProfileOptions = {}): CandidateProfile {
  const data = readYaml(profilePath, 'candidate profile')
  const result = CandidateProfileFileSchema.safeParse(data)
  if (!result.success) {
    throw new ConfigError(
      `Invalid candidate profile (${profilePath}):\n${formatIssues(result.error.issues)}`,
    )
  }
  const profile = result.data
  if (options.finalReadyMode) {
    const blocking = validateProfile(profile).blockingItems
    if (blocking.length > 0) {
      throw new ConfigError(
        `Profile has unresolved BLOCKING items and cannot be used in final-ready mode (${profilePath}):\n` +
          blocking.map((item) => `  - [${item.id}] ${item.message}`).join('\n'),
      )
    }
  }
  return profile
}

export function loadAnswerBank(answerBankPath: string): AnswerBank {
  const data = readYaml(answerBankPath, 'answer bank')
  const result = AnswerBankSchema.safeParse(data)
  if (!result.success) {
    throw new ConfigError(
      `Invalid answer bank (${answerBankPath}):\n${formatIssues(result.error.issues)}`,
    )
  }
  return result.data
}
