import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildAccountSetupPlan } from '../src/accounts/accountSetupPlan'
import { assessPostLoginSignals, runAccountSetup } from '../src/accounts/accountSetupRunner'
import { ConfigError } from '../src/config/loadConfig'
import type { JobRecord } from '../src/intelligence/types'

const root = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f))

/**
 * Static safety net: Phase 5 document/account code must contain NO browser
 * mutation calls at all — not even the gated click primitive. The agent's
 * only browser verbs during account setup are goto + read-only scan.
 */
describe('Phase 5 static safety', () => {
  const files = [
    ...sourceFiles('src/documents'),
    ...sourceFiles('src/accounts'),
    'src/document-cli.ts',
    'src/account-cli.ts',
  ]
  const forbidden = [
    '.click(',
    '.fill(',
    '.type(',
    '.press(',
    '.tap(',
    '.setInputFiles(',
    '.selectOption(',
    '.check(',
    '.uncheck(',
    '.dispatchEvent(',
    'requestSubmit',
    'form.submit',
    'keyboard.',
    'mouse.',
    'addCookies',
    'storageState',
    'clickCtaAndObserve',
  ]

  for (const file of files) {
    it(`${file} contains no mutating or credential-touching browser calls`, () => {
      const source = readFileSync(path.join(root, file), 'utf8')
      for (const pattern of forbidden) {
        expect(source, `${file} must not contain "${pattern}"`).not.toContain(pattern)
      }
    })
  }

  it('account modules never import the click primitive', () => {
    for (const file of [...sourceFiles('src/accounts'), 'src/account-cli.ts']) {
      const source = readFileSync(path.join(root, file), 'utf8')
      expect(source, `${file} must not import safeClick`).not.toContain('safeClick')
    }
  })
})

describe('runAccountSetup runtime safety', () => {
  it('refuses to run headless — before any browser launches', async () => {
    const job: JobRecord = {
      id: 'test_job',
      url: 'https://example.com/job',
      company: 'Example',
      platformHint: 'Workday',
      fixture: 'tests/fixtures/barclays_ib.txt',
    }
    const plan = buildAccountSetupPlan({ job })
    await expect(
      runAccountSetup({
        plan,
        capture: false,
        headed: false,
        waitForHuman: async () => {},
      }),
    ).rejects.toThrow(ConfigError)
  })
})

describe('assessPostLoginSignals', () => {
  it('detects signed-in signals from page text', () => {
    const result = assessPostLoginSignals('Welcome back Alex! My Applications | Sign Out')
    expect(result.signedInLikely).toBe(true)
    expect(result.evidence).toContain('sign-out control visible')
    expect(result.evidence).toContain('applications area visible')
  })

  it('reports no signals on a logged-out page', () => {
    const result = assessPostLoginSignals('Search jobs. Sign in or create an account to apply.')
    expect(result.signedInLikely).toBe(false)
    expect(result.evidence).toEqual([])
  })

  it('stores evidence labels only — never the page text itself', () => {
    const result = assessPostLoginSignals('Signed in as alex.tan@example.edu — Log out')
    expect(JSON.stringify(result)).not.toContain('alex.tan@example.edu')
  })
})
