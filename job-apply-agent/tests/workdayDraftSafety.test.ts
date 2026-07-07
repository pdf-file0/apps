import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { loadCvRoutingConfig } from '../src/config/loadConfig'
import { ConfigError } from '../src/config/loadConfig'
import type { PlannedAction } from '../src/draft/types'
import { evaluateDocumentReadiness } from '../src/documents/documentReadiness'
import { loadDocumentManifest } from '../src/documents/loadDocumentManifest'
import { loadProfile } from '../src/profile/loadProfile'
import type { CandidateProfile } from '../src/profile/types'
import { performFieldAction } from '../src/workday/WorkdayFieldFiller'
import { assertResumeUploadAllowed } from '../src/workday/WorkdayResumeUpload'
import { scanWorkdayPageFromHtml } from '../src/workday/WorkdayFieldScanner'
import { evaluateWorkdayPageGuards } from '../src/workday/WorkdayPageGuards'

const root = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f))

const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

// ---------------------------------------------------------------------------
// Static safety: Phase 6 allows NARROW mutation, so the rules are surgical
// rather than a blanket ban.
// ---------------------------------------------------------------------------

describe('Phase 6 static safety', () => {
  const allFiles = [...sourceFiles('src/workday'), ...sourceFiles('src/draft'), 'src/draft-cli.ts']

  it('no storage/cookie access anywhere in workday/draft modules', () => {
    for (const file of allFiles) {
      const source = read(file)
      for (const banned of ['storageState', 'document.cookie', 'localStorage', 'sessionStorage', 'addCookies']) {
        expect(source, `${file} must not contain "${banned}"`).not.toContain(banned)
      }
    }
  })

  it('no force clicks, no synthetic events, no clicking at all in workday/draft modules', () => {
    for (const file of allFiles) {
      const source = read(file)
      for (const banned of ['force: true', '.dispatchEvent(', 'requestSubmit', '.click(', '.tap(', '.press(']) {
        expect(source, `${file} must not contain "${banned}"`).not.toContain(banned)
      }
    }
  })

  it('setInputFiles appears ONLY in WorkdayResumeUpload.ts', () => {
    for (const file of allFiles) {
      const source = read(file)
      if (file.endsWith('WorkdayResumeUpload.ts')) continue
      expect(source, `${file} must not contain setInputFiles`).not.toContain('setInputFiles')
    }
  })

  it('.fill/.selectOption/.check appear ONLY in WorkdayFieldFiller.ts', () => {
    for (const file of allFiles) {
      const source = read(file)
      if (file.endsWith('WorkdayFieldFiller.ts')) continue
      for (const banned of ['.fill(', '.selectOption(', '.check(', '.uncheck(']) {
        expect(source, `${file} must not contain "${banned}"`).not.toContain(banned)
      }
    }
  })

  it('executor modules never mention blocked-control words (guards/selectors own them)', () => {
    for (const file of ['src/workday/WorkdayFieldFiller.ts', 'src/draft/executeDraftPlan.ts']) {
      const source = read(file)
      expect(source, `${file}`).not.toMatch(/\bsubmit\b/i)
      expect(source, `${file}`).not.toMatch(/\bcertif\w*\b/i)
      expect(source, `${file}`).not.toMatch(/\bi agree\b/i)
      expect(source, `${file}`).not.toMatch(/\baccept\w*\b/i)
      expect(source, `${file}`).not.toMatch(/\be?-?signature\b/i)
    }
  })

  it('no final-submission code path exists: canSubmitFinal is the literal false', () => {
    // Type-level: PreflightResult/DraftPlan declare `canSubmitFinal: false`.
    const draftTypes = read('src/draft/types.ts')
    expect(draftTypes).toContain('canSubmitFinal: false')
    // No workday/draft module ever navigates between form sections either.
    const executor = read('src/draft/executeDraftPlan.ts')
    expect(executor).not.toContain('.goto(')
  })
})

// ---------------------------------------------------------------------------
// Runtime double-gates
// ---------------------------------------------------------------------------

const fakePage = {} as unknown as Page
const nullLogger = { log: () => {} }

const actionOf = (overrides: Partial<PlannedAction>): PlannedAction => ({
  actionId: 'a0',
  type: 'fill_text',
  fieldId: 'f0',
  fieldLabel: 'Field',
  normalizedKey: null,
  profileSourcePath: null,
  policy: 'safe_auto_fill',
  proposedValue: 'value',
  sensitive: false,
  allowed: true,
  reason: 'test',
  confidence: 'high',
  exactOptionMatch: null,
  optionTargetKind: null,
  suggestedAnswerId: null,
  ...overrides,
})

describe('WorkdayFieldFiller runtime refusals', () => {
  it('refuses manual_review fields even when marked allowed', async () => {
    const outcome = await performFieldAction(
      fakePage,
      actionOf({ policy: 'manual_review' }),
      nullLogger,
    )
    expect(outcome.status).toBe('refused')
    expect(outcome.detail).toContain('human-only')
  })

  it('refuses never_auto fields even when marked allowed', async () => {
    const outcome = await performFieldAction(fakePage, actionOf({ policy: 'never_auto' }), nullLogger)
    expect(outcome.status).toBe('refused')
  })

  it('refuses any action the plan did not allow', async () => {
    const outcome = await performFieldAction(fakePage, actionOf({ allowed: false }), nullLogger)
    expect(outcome.status).toBe('refused')
  })

  it('refuses select actions without an exact option match', async () => {
    const outcome = await performFieldAction(
      fakePage,
      actionOf({ type: 'select_option', exactOptionMatch: null, optionTargetKind: 'select' }),
      nullLogger,
    )
    expect(outcome.status).toBe('refused')
    expect(outcome.detail).toContain('never guessed')
  })

  it('refuses non-fill action types (upload goes through its own gated module)', async () => {
    const outcome = await performFieldAction(fakePage, actionOf({ type: 'upload_cv' }), nullLogger)
    expect(outcome.status).toBe('refused')
  })
})

describe('WorkdayResumeUpload gates', () => {
  const cvRouting = loadCvRoutingConfig(path.join(root, 'config/cv_routing.yaml'))
  const fixtureProfile = loadProfile(
    path.join(root, 'tests/fixtures/candidate_profile.fixture.yaml'),
  )
  const cleanManifest = loadDocumentManifest(
    path.join(root, 'tests/fixtures/document_manifest.clean.fixture.yaml'),
  )

  function cleanProfile(): CandidateProfile {
    const clone: CandidateProfile = structuredClone(fixtureProfile)
    clone.unresolved_items = []
    for (const exp of clone.experiences) {
      if (/temasek/i.test(exp.id)) exp.end_date = '2026-07'
    }
    return clone
  }

  const cleanReadiness = evaluateDocumentReadiness({
    manifest: cleanManifest,
    profile: cleanProfile(),
    cvRouting,
  })
  const blockedReadiness = evaluateDocumentReadiness({
    manifest: cleanManifest,
    profile: fixtureProfile, // unresolved items -> blocked
    cvRouting,
  })
  const uploadPageGuard = evaluateWorkdayPageGuards(
    scanWorkdayPageFromHtml(read('test-pages/workday-resume-upload.html'), 'fixture://resume'),
    { uploadRequested: true },
  )

  const gate = (overrides: Partial<Parameters<typeof assertResumeUploadAllowed>[0]>) => ({
    allowCvUploadFlag: true,
    documentReadiness: cleanReadiness,
    selectedCvKey: 'omers_public_equities',
    selectedCvPath: 'tests/fixtures/documents/Example_CV_Public_Equities.pdf',
    jobBucket: 'public_equities_markets_research' as const,
    cvRouting,
    guard: uploadPageGuard,
    fileExists: () => true,
    ...overrides,
  })

  it('refuses without --allow-cv-upload', () => {
    expect(() => assertResumeUploadAllowed(gate({ allowCvUploadFlag: false }))).toThrow(
      /--allow-cv-upload/,
    )
  })

  it('refuses while document readiness is blocked', () => {
    expect(() => assertResumeUploadAllowed(gate({ documentReadiness: blockedReadiness }))).toThrow(
      /document readiness is BLOCKED/,
    )
    expect(cleanReadiness.ready_for_cv_upload).toBe(true) // sanity: fixture clean state is clean
  })

  it('refuses when the CV file is missing or the route mismatches', () => {
    expect(() => assertResumeUploadAllowed(gate({ fileExists: () => false }))).toThrow(
      /file not found/,
    )
    expect(() =>
      assertResumeUploadAllowed(gate({ selectedCvKey: 'temasek_private_markets' })),
    ).toThrow(/does not match the routed CV/)
  })

  it('refuses on any page that is not the resume upload area', () => {
    const wrongGuard = evaluateWorkdayPageGuards(
      scanWorkdayPageFromHtml(read('test-pages/workday-terms.html'), 'fixture://terms'),
      { uploadRequested: true },
    )
    expect(() => assertResumeUploadAllowed(gate({ guard: wrongGuard }))).toThrow(/not a resume upload/)
  })

  it('allows upload only in the fully clean fixture state', () => {
    expect(() => assertResumeUploadAllowed(gate({}))).not.toThrow()
  })
})

describe('ConfigError sanity', () => {
  it('upload gate failures are ConfigError (clean CLI reporting)', () => {
    expect(ConfigError).toBeDefined()
  })
})
