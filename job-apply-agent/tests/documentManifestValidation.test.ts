import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/config/loadConfig'
import { parseDocumentManifest } from '../src/documents/loadDocumentManifest'

const root = fileURLToPath(new URL('..', import.meta.url))

const VALID_MANIFEST = `
expected_application_email: "alex.tan@example.edu"
national_service_status: "unknown"
required_cv_keys:
  - public_cv
documents:
  - key: public_cv
    kind: cv
    human_label: "Public CV"
    path: documents/public.pdf
    cv_bucket: public_equities_markets_research
    email_shown: "alex.tan@example.edu"
    experiences_shown:
      - experience_id: temasek_innovation
        end_date_shown: "2026-07"
`

describe('document manifest validation', () => {
  it('accepts a valid manifest', () => {
    const manifest = parseDocumentManifest(VALID_MANIFEST)
    expect(manifest.documents).toHaveLength(1)
    expect(manifest.documents[0]?.key).toBe('public_cv')
  })

  it('the committed example manifest parses', () => {
    const text = readFileSync(path.join(root, 'config/document_manifest.example.yaml'), 'utf8')
    const manifest = parseDocumentManifest(text, 'config/document_manifest.example.yaml')
    expect(manifest.required_cv_keys).toContain('omers_public_equities')
    expect(manifest.required_cv_keys).toContain('temasek_private_markets')
    // The example must stay dummy-only: no real addresses.
    expect(text).not.toContain('smu.edu.sg')
  })

  it('rejects duplicate document keys', () => {
    const dup = VALID_MANIFEST + VALID_MANIFEST.slice(VALID_MANIFEST.indexOf('  - key: public_cv'))
    expect(() => parseDocumentManifest(dup)).toThrow(ConfigError)
    expect(() => parseDocumentManifest(dup)).toThrow(/duplicate document key/)
  })

  it('rejects required_cv_keys that reference no document', () => {
    const bad = VALID_MANIFEST.replace('- public_cv', '- nonexistent_cv')
    expect(() => parseDocumentManifest(bad)).toThrow(/references unknown document/)
  })

  it('rejects a CV without email_shown', () => {
    const bad = VALID_MANIFEST.replace('    email_shown: "alex.tan@example.edu"\n', '')
    expect(() => parseDocumentManifest(bad)).toThrow(/must declare email_shown/)
  })

  it('rejects a CV without cv_bucket', () => {
    const bad = VALID_MANIFEST.replace('    cv_bucket: public_equities_markets_research\n', '')
    expect(() => parseDocumentManifest(bad)).toThrow(/must declare cv_bucket/)
  })

  it('rejects free-form end_date_shown values', () => {
    const bad = VALID_MANIFEST.replace('end_date_shown: "2026-07"', 'end_date_shown: "Jan 2026 - Present"')
    expect(() => parseDocumentManifest(bad)).toThrow(/YYYY-MM/)
  })

  it('rejects unknown top-level keys (strict schema)', () => {
    const bad = `${VALID_MANIFEST}\nupload_now: true\n`
    expect(() => parseDocumentManifest(bad)).toThrow(ConfigError)
  })

  it('rejects malformed YAML with a helpful message', () => {
    expect(() => parseDocumentManifest('documents: [unclosed')).toThrow(/Malformed YAML/)
  })
})
