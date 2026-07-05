import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { ZodTypeAny, z } from 'zod'
import {
  CandidateProfileConfigSchema,
  CvRoutingConfigSchema,
  JobsConfigSchema,
  SubmissionPolicySchema,
} from './schemas'

/** Thrown for any malformed or unreadable config; message names the file and fields. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function parseWith<S extends ZodTypeAny>(
  schema: S,
  yamlText: string,
  source: string,
  what: string,
): z.infer<S> {
  let data: unknown
  try {
    data = parse(yamlText)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(`Failed to parse YAML for ${what} config (${source}): ${detail}`)
  }
  const result = schema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new ConfigError(`Invalid ${what} config (${source}):\n${issues}`)
  }
  return result.data
}

function readFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(`Cannot read config file "${filePath}": ${detail}`)
  }
}

// parse* take raw YAML text (used directly by validation tests);
// load* read from disk.

export const parseJobsConfig = (yamlText: string, source = 'inline yaml') =>
  parseWith(JobsConfigSchema, yamlText, source, 'jobs')
export const loadJobsConfig = (filePath: string) => parseJobsConfig(readFile(filePath), filePath)

export const parseCvRoutingConfig = (yamlText: string, source = 'inline yaml') =>
  parseWith(CvRoutingConfigSchema, yamlText, source, 'cv_routing')
export const loadCvRoutingConfig = (filePath: string) =>
  parseCvRoutingConfig(readFile(filePath), filePath)

export const parseSubmissionPolicy = (yamlText: string, source = 'inline yaml') =>
  parseWith(SubmissionPolicySchema, yamlText, source, 'submission_policy')
export const loadSubmissionPolicy = (filePath: string) =>
  parseSubmissionPolicy(readFile(filePath), filePath)

export const parseCandidateProfileConfig = (yamlText: string, source = 'inline yaml') =>
  parseWith(CandidateProfileConfigSchema, yamlText, source, 'candidate_profile')
export const loadCandidateProfileConfig = (filePath: string) =>
  parseCandidateProfileConfig(readFile(filePath), filePath)
