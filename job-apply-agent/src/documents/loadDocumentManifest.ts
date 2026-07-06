import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigError } from '../config/loadConfig'
import { DocumentManifestSchema } from './schemas'
import type { DocumentManifest } from './types'

export function parseDocumentManifest(yamlText: string, source = 'inline yaml'): DocumentManifest {
  let data: unknown
  try {
    data = parse(yamlText)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(`Malformed YAML in document manifest (${source}): ${detail}`)
  }
  const result = DocumentManifestSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new ConfigError(`Invalid document manifest (${source}):\n${issues}`)
  }
  return result.data
}

export function loadDocumentManifest(filePath: string): DocumentManifest {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new ConfigError(
      `Cannot read document manifest "${filePath}": ${detail}\n` +
        'Local manifests are gitignored — create one from config/document_manifest.example.yaml.',
    )
  }
  return parseDocumentManifest(text, filePath)
}
