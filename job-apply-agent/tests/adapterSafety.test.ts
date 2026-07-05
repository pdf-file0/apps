import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f))

/**
 * Static safety net: Phase 4 adapter/flow code must contain NO Playwright
 * mutation calls. The only click primitive lives in src/browser/safeClick.ts
 * (gated by the apply-CTA allowlist), which is intentionally out of scope.
 */
describe('Phase 4 static safety', () => {
  const files = [
    ...sourceFiles('src/adapters'),
    ...sourceFiles('src/flow'),
    'src/flow-cli.ts',
  ]
  const forbidden = [
    '.fill(',
    '.type(',
    '.press(',
    '.setInputFiles(',
    '.selectOption(',
    '.check(',
    '.uncheck(',
    '.dispatchEvent(',
    'requestSubmit',
    'form.submit',
  ]

  for (const file of files) {
    it(`${file} contains no mutating browser calls`, () => {
      const source = readFileSync(path.join(root, file), 'utf8')
      for (const pattern of forbidden) {
        expect(source, `${file} must not contain "${pattern}"`).not.toContain(pattern)
      }
    })
  }

  it('adapter contract exposes no mutation methods', async () => {
    const source = readFileSync(path.join(root, 'src/adapters/types.ts'), 'utf8')
    for (const banned of ['fillForm', 'uploadResume', 'createAccount', 'signIn', 'submit(', 'typeIntoField', 'selectOption', 'acceptTerms']) {
      expect(source).not.toContain(banned)
    }
  })
})
