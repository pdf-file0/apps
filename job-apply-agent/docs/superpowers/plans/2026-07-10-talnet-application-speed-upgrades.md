# TAL.net Application Speed Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, fail-closed TAL.net application assistant that reduces active form-completion time by at least 20% while preserving every existing supported workflow's behavior.

**Architecture:** Freeze current behavior first, then add backwards-compatible candidate and packet data, platform-neutral application contracts, and isolated TAL.net scan/map/fill modules. A persistent runner uses page-scoped approvals, diff-aware verified batches, allowlisted intermediate navigation, redacted checkpoints, and a release benchmark; Workday and reconnaissance defaults remain unchanged.

**Tech Stack:** Node.js 20+, TypeScript 5.7 in strict mode, Vitest 2.1, Zod 3.24, YAML 2.6, Playwright Core 1.49, locally installed Chrome or Edge.

## Global Constraints

- Work in an isolated worktree created with `superpowers:using-git-worktrees` before Task 1.
- Preserve the normalized behavior of all existing reconnaissance, flow, account, profile, packet, document, and Workday commands.
- Existing CLI defaults, flags, exit categories, safety stops, and redacted artifact schemas may change only through additive versioned telemetry.
- TAL.net drafting is a new `draft:talnet` command, requires explicit `--provider tal_net`, and defaults to inspect-only.
- TAL.net mutation additionally requires `TALNET_MUTATION_ENABLED=true`, capability flags, an unchanged reviewed plan, and imminent page-scoped approvals.
- `canSubmitFinal` and `ready_for_final_submit` remain the literal `false`; declaration, certification, signature, and final-submit actions must not exist in executable unions.
- Account creation, passwords, OTP/email verification, CAPTCHA, terms, declarations, signatures, regulatory answers, salary answers, and final submission remain human-only pause states.
- Unknown fields, ambiguous repeat records, unknown options, and non-exact option matches remain manual; fuzzy matching is forbidden.
- Never log or commit field values, page body text, credentials, tokens, document contents, local profile data, or local document paths.
- Do not stage `profiles/*.local.yaml`, `config/*.local.yaml`, `documents/`, `tmp/`, `../scripts/`, `.browser-profile/`, or generated run directories.
- Every production change follows red-green-refactor: focused failing test, observed failure, minimal implementation, focused pass, characterization pass, full test pass, typecheck, then one focused commit.
- Performance results are evaluated only after correctness gates pass. A faster behaviorally different candidate is rejected.
- No new runtime dependency is added; fixture parsing follows existing deterministic scanner patterns.

---

## File and Responsibility Map

### Existing files modified incrementally

- `src/answers/selectAnswer.ts`, `src/draft/buildDraftPlan.ts`: shared answer authorization.
- `src/profile/schemas.ts`, `src/profile/types.ts`: optional backwards-compatible facts, answers, events, and blocker scope.
- `src/packets/types.ts`, `src/packets/buildApplicationPacket.ts`: structured records and explicit demographic consent.
- `src/documents/types.ts`, `src/documents/validateDocuments.ts`, `src/documents/documentReadiness.ts`: selected-document readiness.
- `src/workday/types.ts`, `src/workday/WorkdayFieldMapper.ts`: structural demographic consent only; no behavioral expansion.
- `package.json`, `.gitignore`, `README.md`: additive TAL commands, run directories, and usage documentation.

### New shared application modules

- `src/application/types.ts`: platform-neutral scan, plan, action, guard, transition, and state types.
- `src/application/approval.ts`: cryptographically scoped imminent approvals.
- `src/application/telemetry.ts`: strict PII-free monotonic event stream and active-time summary.
- `src/application/checkpoint.ts`: atomic redacted checkpoints and live-diff resume.
- `src/application/ApplicationRun.ts`: pure state transition plus persistent run orchestration.
- `src/application/featureFlags.ts`: TAL mutation kill switch.

### New TAL.net modules

- `src/talnet/types.ts`: TAL-specific scan identities and page kinds.
- `src/talnet/TalNetSelectors.ts`: stable stamped selector names and blocked-control patterns.
- `src/talnet/TalNetFieldScanner.ts`: offline/live scanner and value-free page signature.
- `src/talnet/TalNetPageGuards.ts`: fail-closed page and danger guards.
- `src/talnet/TalNetPortalSchema.ts`: versioned Bank of America campus field schema and reviewed aliases.
- `src/talnet/TalNetFieldMapper.ts`: exact field, option, education, and experience mapping.
- `src/talnet/TalNetControls.ts`: isolated text/select/checkbox/custom-combobox mutation primitives.
- `src/talnet/TalNetFieldFiller.ts`: diff, dependency ordering, execution, and batch verification.
- `src/talnet/TalNetResumeUpload.ts`: selected-document-scoped and filename-verified CV upload.
- `src/talnet/TalNetTransitions.ts`: allowlisted intermediate save-and-continue only.
- `src/talnet/TalNetDraftAdapter.ts`: composition of scanner, guard, mapper, and transition APIs.
- `src/talnet-cli.ts`: isolated CLI; existing `src/draft-cli.ts` stays behaviorally frozen.

### New regression and performance modules

- `tests/characterization/`: normalized golden behavior for current workflows.
- `src/regression/normalizeRegression.ts`, `src/regression/compareRegression.ts`: semantic differential gate.
- `src/benchmark/pairedBenchmark.ts`, `src/benchmark/report.ts`, `src/benchmark-cli.ts`: paired timing and release decision.
- `test-pages/talnet/`: synthetic ten-section TAL flow and guard variants using dummy identities only.

---

### Task 1: Freeze Existing Behavior Before Refactoring

**Files:**
- Create: `tests/characterization/normalizeBehavior.ts`
- Create: `tests/characterization/reconnaissance.characterization.test.ts`
- Create: `tests/characterization/workday.characterization.test.ts`
- Create: `tests/characterization/dataContracts.characterization.test.ts`
- Create: `tests/characterization/cli.characterization.test.ts`
- Create through Vitest snapshot update: `tests/characterization/__snapshots__/*.snap`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeBehavior<T>(value: T): unknown` and frozen snapshot contracts used by every later task.
- Consumes: existing public functions only; no production source is modified.

- [ ] **Step 1: Write normalization tests that fail because the helper does not exist**

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { scanWorkdayPageFromHtml } from '../../src/workday/WorkdayFieldScanner'
import { normalizeBehavior } from './normalizeBehavior'

const root = fileURLToPath(new URL('../..', import.meta.url))

it('matches the current normalized Workday scan behavior', () => {
  const capturedBehavior = scanWorkdayPageFromHtml(
    readFileSync(path.join(root, 'test-pages/workday-my-information.html'), 'utf8'),
    'fixture://workday-my-information',
  )
  expect(normalizeBehavior(capturedBehavior)).toMatchSnapshot()
})
```

Capture exact current outputs for:

- reconnaissance platform, CTA decision, stop reason, CV route, warning codes, and manual-review flag;
- all existing Workday fixture scans, page kinds, guards, mapped keys, exact options, and plan partitions;
- profile, answer-bank, account, packet, and document validation for all configured jobs;
- current CLI defaults, flag conflicts, and error categories; and
- redacted artifacts with fixture PII sentinels asserted absent.

- [ ] **Step 2: Run the characterization tests and observe the missing-module failure**

Run: `npx vitest run tests/characterization`

Expected: FAIL because `./normalizeBehavior` cannot be resolved.

- [ ] **Step 3: Implement deterministic normalization**

```ts
// tests/characterization/normalizeBehavior.ts
const OMIT = new Set([
  'startedAt',
  'finishedAt',
  'completedAt',
  'durationMs',
  'monotonicMs',
  'runDir',
  'telemetry',
])

export function normalizeBehavior<T>(value: T): unknown {
  if (Array.isArray(value)) return value.map(normalizeBehavior)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !OMIT.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, normalizeBehavior(child)]),
  )
}
```

Add the package script:

```json
"test:characterization": "vitest run tests/characterization"
```

- [ ] **Step 4: Generate and inspect the frozen snapshots**

Run: `npx vitest run tests/characterization -u`

Expected: PASS and snapshot files written. Inspect `git diff` and confirm snapshots contain dummy fixture data only and no local candidate values.

- [ ] **Step 5: Verify frozen behavior and the full baseline**

Run:

```text
npm run test:characterization
npm test
npm run typecheck
```

Expected: characterization tests pass; the existing baseline remains 28 test files and 276 tests plus the new characterization files; typecheck exits 0.

- [ ] **Step 6: Commit the characterization gate**

```text
git add package.json tests/characterization
git commit -m "test: freeze existing workflow behavior"
```

---

### Task 2: Centralize Answer Execution Authorization

**Files:**
- Create: `src/answers/isAnswerExecutable.ts`
- Create: `tests/answerAuthorization.test.ts`
- Modify: `src/answers/selectAnswer.ts`
- Modify: `src/draft/buildDraftPlan.ts`

**Interfaces:**
- Produces: `isAnswerExecutable(entry): boolean` used by selection and planning.
- Consumes: `AnswerBankEntry` from `src/profile/types.ts`.

- [ ] **Step 1: Write the eight-row permission test and cross-module regression**

```ts
import { describe, expect, it } from 'vitest'
import { isAnswerExecutable } from '../src/answers/isAnswerExecutable'

const base = {
  status: 'approved' as const,
  requires_review: false,
  allow_auto_use_later_phase: true,
  unapproved_story_requires_user_confirmation: false,
}

describe('answer execution authorization', () => {
  it('authorizes only approved, review-free, explicitly reusable answers', () => {
    expect(isAnswerExecutable(base)).toBe(true)
    expect(isAnswerExecutable({ ...base, status: 'draft' })).toBe(false)
    expect(isAnswerExecutable({ ...base, requires_review: true })).toBe(false)
    expect(isAnswerExecutable({ ...base, allow_auto_use_later_phase: false })).toBe(false)
    expect(isAnswerExecutable({ ...base, unapproved_story_requires_user_confirmation: true })).toBe(false)
  })
})
```

Add a `buildDraftPlan` assertion that an approved, review-free answer with
`allow_auto_use_later_phase: false` never appears in `plannedActions`.

- [ ] **Step 2: Run the test and observe the missing helper failure**

Run: `npx vitest run tests/answerAuthorization.test.ts tests/workdayDraftPlan.test.ts`

Expected: FAIL because `isAnswerExecutable` does not exist and the plan regression exposes the current two-field gate.

- [ ] **Step 3: Implement one shared predicate and use it in both modules**

```ts
// src/answers/isAnswerExecutable.ts
import type { AnswerBankEntry } from '../profile/types'

export type AnswerAuthorizationFields = Pick<
  AnswerBankEntry,
  | 'status'
  | 'requires_review'
  | 'allow_auto_use_later_phase'
  | 'unapproved_story_requires_user_confirmation'
>

export function isAnswerExecutable(entry: AnswerAuthorizationFields): boolean {
  return (
    entry.status === 'approved' &&
    entry.requires_review === false &&
    entry.allow_auto_use_later_phase === true &&
    entry.unapproved_story_requires_user_confirmation !== true
  )
}
```

Replace both inline authorization expressions with `isAnswerExecutable(entry)`.

- [ ] **Step 4: Run targeted and characterization tests**

Run:

```text
npx vitest run tests/answerAuthorization.test.ts tests/questionClassifier.test.ts tests/workdayDraftPlan.test.ts
npm run test:characterization
```

Expected: PASS. Characterization differences are limited to closing the unintended answer-authorization gap and must be explicitly accepted in the snapshot review.

- [ ] **Step 5: Run full verification**

Run: `npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add src/answers/isAnswerExecutable.ts src/answers/selectAnswer.ts src/draft/buildDraftPlan.ts tests/answerAuthorization.test.ts tests/workdayDraftPlan.test.ts tests/characterization
git commit -m "fix: centralize answer execution authorization"
```

---

### Task 3: Carry Demographic Permission Structurally

**Files:**
- Modify: `src/packets/types.ts`
- Modify: `src/packets/buildApplicationPacket.ts`
- Modify: `src/workday/types.ts`
- Modify: `src/workday/WorkdayFieldMapper.ts`
- Modify: `src/draft/types.ts`
- Modify: `src/draft/buildDraftPlan.ts`
- Modify: `tests/buildApplicationPacket.test.ts`
- Modify: `tests/workdayFieldMapper.test.ts`
- Modify: `tests/workdayDraftPlan.test.ts`

**Interfaces:**
- Produces: `demographicAutoFillAllowed` propagated from profile to packet, mapped field, and action.
- Preserves: all existing note text as explanatory output only.

- [ ] **Step 1: Write failing structural-consent tests**

```ts
it('cannot derive demographic permission from note text', () => {
  const field = packet.demographicFields.find((item) => item.key === 'gender')!
  expect(field.demographicAutoFillAllowed).toBe(true)
  field.note = 'allow_auto_fill: false; allow_auto_fill: true'
  expect(buildPlanWith(field).plannedActions.map((a) => a.normalizedKey)).toContain('gender')
})

it('does not authorize true_if_wording_is_clear', () => {
  const field = packet.demographicFields.find((item) => item.key === 'veteran_status')!
  expect(field.demographicAutoFillAllowed).toBe(false)
})
```

- [ ] **Step 2: Run the tests and observe missing boolean failures**

Run: `npx vitest run tests/buildApplicationPacket.test.ts tests/workdayFieldMapper.test.ts tests/workdayDraftPlan.test.ts`

Expected: FAIL because the boolean is absent and planning still parses the note.

- [ ] **Step 3: Add and propagate the explicit boolean**

Add this property to the three existing interfaces:

```ts
demographicAutoFillAllowed?: boolean
```

Set it in the packet builder:

```ts
demographicAutoFillAllowed:
  typeof entry === 'string' ? false : entry.allow_auto_fill === true,
```

Propagate it through `MappedWorkdayField` and `PlannedAction`, then replace the note regex with:

```ts
const packetAllows = mapped.demographicAutoFillAllowed === true
```

- [ ] **Step 4: Run targeted, characterization, and full checks**

Run:

```text
npx vitest run tests/buildApplicationPacket.test.ts tests/workdayFieldMapper.test.ts tests/workdayDraftPlan.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS with no semantic change to currently authorized demographic actions.

- [ ] **Step 5: Commit**

```text
git add src/packets src/workday src/draft tests/buildApplicationPacket.test.ts tests/workdayFieldMapper.test.ts tests/workdayDraftPlan.test.ts tests/characterization
git commit -m "fix: carry demographic consent structurally"
```

---

### Task 4: Add Backwards-Compatible Structured Profile and Answer Schemas

**Files:**
- Modify: `src/profile/schemas.ts`
- Modify: `src/profile/types.ts`
- Create: `src/profile/resolveProfile.ts`
- Create: `tests/profileMigration.test.ts`
- Modify: `profiles/candidate_profile.example.yaml`
- Modify: `profiles/answer_bank.example.yaml`
- Modify: `tests/fixtures/candidate_profile.fixture.yaml`
- Modify: `tests/fixtures/answer_bank.fixture.yaml`

**Interfaces:**
- Produces: `CanonicalCandidateFacts`, `CanonicalEducationRecord`, `resolveCandidateFacts`, and `resolveEducationRecords`.
- Preserves: unchanged local and fixture YAML continues to parse and produce current packet values.

- [ ] **Step 1: Write legacy compatibility and structured-resolution tests**

```ts
it('parses the unchanged legacy fixture', () => {
  expect(() => loadProfile(legacyFixturePath)).not.toThrow()
})

it('prefers explicit name, phone, address, language, and education facts', () => {
  const facts = resolveCandidateFacts(structuredProfile)
  expect(facts.givenName).toBe('Alex')
  expect(facts.familyName).toBe('Tan')
  expect(facts.phone.countryCode).toBe('+65')
  expect(facts.languages.map((language) => language.name)).toEqual(['English', 'Mandarin'])
  expect(resolveEducationRecords(structuredProfile)[0]?.recordId).toBe('example_bbm')
})
```

Also assert legacy education without an ID returns `recordId: null` and `mappingRequired: true`.

- [ ] **Step 2: Run the test and observe strict-schema rejection**

Run: `npx vitest run tests/profileMigration.test.ts tests/profileValidation.test.ts`

Expected: FAIL because the new strict-schema keys are unknown and the resolvers do not exist.

- [ ] **Step 3: Add exact optional schemas**

```ts
export const FactProvenanceSchema = z.object({
  source: z.string().min(1),
  confirmed_at: z.string().datetime(),
}).strict()

export const MonthYearSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(1900).max(2200),
}).strict()

export const StructuredPhoneSchema = z.object({
  country_code: z.string().min(1),
  national_number: z.string().min(4),
  device_type: z.enum(['mobile', 'home', 'work', 'other']),
}).strict()

export const LanguageSchema = z.object({
  name: z.string().min(1),
  native: z.boolean(),
  fluent: z.boolean(),
  reads: z.boolean().nullable(),
  writes: z.boolean(),
  provenance: FactProvenanceSchema,
}).strict()

export type FactProvenance = z.infer<typeof FactProvenanceSchema>

export interface CanonicalCandidateFacts {
  givenName: string
  familyName: string
  title: string | null
  secondaryEmail: string | null
  phone: z.infer<typeof StructuredPhoneSchema>
  address: CandidateIdentity['residential_address']
  languages: z.infer<typeof LanguageSchema>[]
  referralSource: string | null
}

export interface CanonicalEducationRecord {
  recordId: string | null
  mappingRequired: boolean
  institution: string
  degree: string
  major: string | null
  studyLocation: string | null
  startMonthYear: z.infer<typeof MonthYearSchema> | null
  completionMonthYear: z.infer<typeof MonthYearSchema> | null
  degreeStatus: string | null
  result: string | null
}
```

Add optional candidate keys `title`, `given_name`, `family_name`, `secondary_email`, `phone_details`, `languages`, and `referral_source`; optional address keys `city`, `region`, and `campus_address_status`; optional education keys `id`, `study_location`, `start_month_year`, `completion_month_year`, `completion_kind`, `degree_status`, `result`, and `previous_education`.

Add optional answer keys `question_aliases`, `scope`, `max_words`, `max_characters`, `length_variants`, `provenance`, and `approved_at` with strict nested schemas.

- [ ] **Step 4: Implement canonical resolvers without changing legacy output**

```ts
export function resolveCandidateFacts(profile: CandidateProfile): CanonicalCandidateFacts {
  const legacyParts = profile.candidate.legal_name.trim().split(/\s+/)
  return {
    givenName: profile.candidate.given_name ?? legacyParts[0] ?? profile.candidate.legal_name,
    familyName: profile.candidate.family_name ?? legacyParts.slice(1).join(' '),
    title: profile.candidate.title ?? null,
    secondaryEmail: profile.candidate.secondary_email ?? null,
    phone: profile.candidate.phone_details ?? {
      country_code: '',
      national_number: profile.candidate.phone,
      device_type: 'mobile',
    },
    address: profile.candidate.residential_address,
    languages: profile.candidate.languages ?? [],
    referralSource: profile.candidate.referral_source ?? null,
  }
}
```

`resolveEducationRecords` returns all records and preserves raw month/year values; it never invents a record ID.

- [ ] **Step 5: Update dummy examples and fixtures, then verify**

Run:

```text
npx vitest run tests/profileMigration.test.ts tests/profileValidation.test.ts tests/buildApplicationPacket.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS; legacy golden output remains equivalent and new fixture fields are additive.

- [ ] **Step 6: Commit**

```text
git add src/profile profiles/*.example.yaml tests/fixtures/candidate_profile.fixture.yaml tests/fixtures/answer_bank.fixture.yaml tests/profileMigration.test.ts tests/profileValidation.test.ts tests/characterization
git commit -m "feat: add backwards-compatible structured profile schemas"
```

---

### Task 5: Add Confirmed Application Events and Structured Packet Records

**Files:**
- Modify: `src/profile/schemas.ts`
- Create: `src/profile/applicationHistory.ts`
- Modify: `src/experience/types.ts`
- Modify: `src/experience/formatExperience.ts`
- Modify: `src/packets/types.ts`
- Modify: `src/packets/buildApplicationPacket.ts`
- Create: `src/packets/portalCompleteness.ts`
- Create: `tests/applicationHistory.test.ts`
- Modify: `tests/buildApplicationPacket.test.ts`

**Interfaces:**
- Produces: `resolveApplicationHistory`, `StructuredPacketExperience`, and `PortalCompletenessReport`.
- Consumes: the optional structured fields from Task 4.

- [ ] **Step 1: Write event, record, and completeness tests**

```ts
it('only confirmed submission events change prior-application history', () => {
  const history = resolveApplicationHistory(profileWithConfirmedEvent, 'bank_of_america')
  expect(history.previously_applied).toBe(true)
  expect(history.source).toBe('confirmed_submission_event')
})

it('preserves structured experience records in the packet', () => {
  const experience = packet.selectedExperiences[0]!
  expect(experience.recordId).toBe('omers_global_equities')
  expect(experience.startValue).toMatch(/^\d{4}-\d{2}$/)
  expect(experience.role.length).toBeGreaterThan(0)
})
```

Assert events for another company do not apply, unsupported event types fail schema parsing, legacy history stays unchanged, and TAL completeness names missing education IDs or approved portal descriptions.

- [ ] **Step 2: Run the tests and observe missing schema/function failures**

Run: `npx vitest run tests/applicationHistory.test.ts tests/buildApplicationPacket.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add the confirmed event and history resolver**

```ts
export const ConfirmedSubmissionEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal('confirmed_submission'),
  company_key: z.string().min(1),
  job_id: z.string().min(1),
  portal: z.enum(['workday', 'tal_net', 'oracle_recruiting', 'impress_ai']),
  occurred_at: z.string().datetime(),
  provenance: FactProvenanceSchema,
}).strict()
```

```ts
export interface ResolvedApplicationHistory {
  previously_applied: boolean | null
  previously_worked: boolean | null
  relatives_employed: boolean | null
  source: 'confirmed_submission_event' | 'legacy_application_history' | 'missing'
}

export function resolveApplicationHistory(
  profile: CandidateProfile,
  companyKey: string,
): ResolvedApplicationHistory {
  const submitted = (profile.application_events ?? []).some(
    (event) => event.type === 'confirmed_submission' && event.company_key === companyKey,
  )
  const legacy = profile.application_history[companyKey]
  if (submitted) return { previously_applied: true, previously_worked: legacy?.previously_worked ?? null, relatives_employed: legacy?.relatives_employed ?? null, source: 'confirmed_submission_event' }
  if (legacy) return { ...legacy, source: 'legacy_application_history' }
  return { previously_applied: null, previously_worked: null, relatives_employed: null, source: 'missing' }
}
```

- [ ] **Step 4: Preserve structured packet records additively**

```ts
export interface StructuredPacketExperience extends FormattedExperience {
  recordId: string
  role: string
  startValue: string
  endValue: string
  portalDescription: {
    text: string
    maxCharacters: number
    provenance: FactProvenance
    approvedAt: string
  } | null
}

export interface PortalCompletenessReport {
  portal: Platform
  complete: boolean
  missingPaths: string[]
  manualReviewPaths: string[]
}
```

Keep every existing formatted property. Legacy descriptions remain displayable but produce `portalDescription: null`, so TAL execution treats them as manual.

- [ ] **Step 5: Run targeted, characterization, and full checks**

Run:

```text
npx vitest run tests/applicationHistory.test.ts tests/buildApplicationPacket.test.ts tests/selectExperience.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS; existing golden differences are additive structured fields only.

- [ ] **Step 6: Commit**

```text
git add src/profile src/experience src/packets tests/applicationHistory.test.ts tests/buildApplicationPacket.test.ts tests/characterization
git commit -m "feat: preserve confirmed history and structured packet records"
```

---

### Task 6: Scope Document Blockers to the Selected CV

**Files:**
- Modify: `src/profile/schemas.ts`
- Modify: `src/documents/types.ts`
- Modify: `src/documents/validateDocuments.ts`
- Modify: `src/documents/documentReadiness.ts`
- Modify: `src/packets/buildApplicationPacket.ts`
- Create: `src/documents/blockerScope.ts`
- Modify: `tests/documentReadiness.test.ts`
- Modify: `tests/buildApplicationPacket.test.ts`
- Modify: `tests/workdayDraftSafety.test.ts`

**Interfaces:**
- Produces: `unresolvedItemApplies(item, context)` and selected-document readiness.
- Preserves: omitting `selection` reproduces current global readiness behavior.

```ts
export interface SelectedDocumentReadiness {
  documentKey: string
  documentPath: string
  bucket: Bucket
  jobId: string
  ready: boolean
  blockers: readonly DocumentBlocker[]
}
```

- [ ] **Step 1: Write selected-document readiness tests**

```ts
it('allows a clean selected public CV when only the private CV is stale', () => {
  const readiness = evaluateDocumentReadiness({
    manifest,
    profile,
    cvRouting,
    selection: {
      documentKey: 'omers_public_equities',
      bucket: 'public_equities_markets_research',
      jobId: 'barclays_research_2027_sg',
    },
  })
  expect(readiness.ready_for_cv_upload).toBe(true)
  expect(readiness.allBlockers.length).toBeGreaterThan(readiness.blockers.length)
})
```

Also test selected private CV remains blocked, legacy global blockers apply everywhere, resolved items do not block, scopes are conjunctive, and an upload gate rejects readiness for a different selected document.

- [ ] **Step 2: Run tests and observe global-blocking failures**

Run: `npx vitest run tests/documentReadiness.test.ts tests/buildApplicationPacket.test.ts tests/workdayDraftSafety.test.ts`

Expected: FAIL because `selection`, scoped items, and `allBlockers` do not exist.

- [ ] **Step 3: Add blocker scope and selection identity**

```ts
export type BlockedCapability =
  | 'cv_upload'
  | 'application_field_fill'
  | 'application_page_save'

export interface BlockerContext {
  capability: BlockedCapability
  documentKey: string | null
  bucket: Bucket | null
  jobId: string | null
}

export function unresolvedItemApplies(
  item: UnresolvedItem,
  context: BlockerContext,
): boolean {
  if (item.resolution_state === 'resolved') return false
  if (item.blocks && !item.blocks.includes(context.capability)) return false
  if (item.document_keys && context.documentKey && !item.document_keys.includes(context.documentKey)) return false
  if (item.buckets && context.bucket && !item.buckets.includes(context.bucket)) return false
  if (item.job_ids && context.jobId && !item.job_ids.includes(context.jobId)) return false
  return true
}
```

Add optional strict schema fields `blocks`, `document_keys`, `buckets`, `job_ids`, `resolution_state`, and `provenance`. Add `selection` to `ValidateDocumentsInput`; add `selectedDocument: SelectedDocumentReadiness | null` and `allBlockers: DocumentBlocker[]` to `DocumentReadiness`.

- [ ] **Step 4: Filter readiness without losing diagnostics**

Compute all blockers first. When `selection` exists, `blockers` contains global blockers plus matching document/profile blockers; `allBlockers` retains the full report. When omitted, set `blockers` and `allBlockers` to the same current global list.

- [ ] **Step 5: Verify all gates**

Run:

```text
npx vitest run tests/documentReadiness.test.ts tests/buildApplicationPacket.test.ts tests/workdayDraftSafety.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS; global legacy calls remain equivalent.

- [ ] **Step 6: Commit**

```text
git add src/profile/schemas.ts src/documents src/packets/buildApplicationPacket.ts tests/documentReadiness.test.ts tests/buildApplicationPacket.test.ts tests/workdayDraftSafety.test.ts tests/characterization
git commit -m "fix: scope document blockers to the selected CV"
```

---

### Task 7: Define Fail-Closed Shared Application Contracts

**Files:**
- Create: `src/application/types.ts`
- Create: `tests/applicationTypesSafety.test.ts`

**Interfaces:**
- Produces: the complete platform-neutral type surface consumed by every TAL task.
- Preserves: Workday types remain unchanged; no migration occurs in this task.

- [ ] **Step 1: Write static impossibility tests**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../src/application/types.ts', import.meta.url)),
  'utf8',
)

describe('application type safety', () => {
  it('has no executable declaration or final-submit action', () => {
    const actionUnion = source.slice(
      source.indexOf('export type ApplicationActionType'),
      source.indexOf('export interface ApplicationAction'),
    )
    expect(actionUnion).not.toMatch(/submit|declare|certif|signature/i)
    expect(source).toContain('canSubmitFinal: false')
  })
})
```

- [ ] **Step 2: Run the test and observe the missing-file failure**

Run: `npx vitest run tests/applicationTypesSafety.test.ts`

Expected: FAIL because `src/application/types.ts` does not exist.

- [ ] **Step 3: Add the shared contracts**

```ts
import type { Page } from 'playwright-core'
import type { AnswerBank } from '../profile/types'
import type { ApplicationPacket } from '../packets/types'
import type { Bucket } from '../intelligence/types'
import type { Platform } from '../reconnaissance/types'
import type { FieldPolicyCategory } from '../fieldPolicy/types'

export type PageSignature = string & { readonly __pageSignature: unique symbol }
export type ApplicationDataCategory =
  | 'identity' | 'contact' | 'address' | 'education' | 'experience'
  | 'work_authorization' | 'demographic' | 'answer' | 'document' | 'other'
export type ApplicationRunState =
  | 'OPEN_CHECKPOINT' | 'SCAN' | 'GUARD' | 'BUILD_PLAN'
  | 'WAIT_FOR_PAGE_APPROVAL' | 'EXECUTE_BATCH' | 'VERIFY_BATCH'
  | 'WAIT_FOR_INTERMEDIATE_SAVE_APPROVAL' | 'SAVE_AND_CONTINUE'
  | 'WAIT_FOR_NEW_PAGE_SIGNATURE' | 'PAUSED_LOGIN_OR_SESSION_EXPIRED'
  | 'PAUSED_EMAIL_VERIFICATION_OR_OTP' | 'PAUSED_CAPTCHA'
  | 'PAUSED_UNKNOWN_FIELD_OR_OPTION' | 'PAUSED_UPLOAD_APPROVAL'
  | 'PAUSED_VALIDATION_ERROR' | 'PAUSED_DECLARATION'
  | 'PAUSED_FINAL_SUBMIT' | 'COMPLETE_AT_REVIEW' | 'FAILED_CLOSED'
export type ApplicationControlType =
  | 'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea'
  | 'select' | 'radio' | 'checkbox' | 'combobox' | 'file' | 'unknown'
export type ValueStateToken =
  | 'empty' | 'nonempty' | 'checked' | 'unchecked' | 'selected' | 'unselected'
export type ApplicationGuardSignal =
  | 'login' | 'session_expired' | 'email_verification' | 'otp' | 'captcha'
  | 'declaration' | 'certification' | 'signature' | 'final_submit' | 'validation_error'

export interface ScannedApplicationField {
  fieldId: string
  stableId: string | null
  nativeName: string | null
  domId: string | null
  ariaLabel: string | null
  label: string
  sectionTitle: string
  repeatOrdinal: number
  controlType: ApplicationControlType
  currentValue: string | boolean | null
  currentValueState: ValueStateToken
  options: readonly string[]
  required: boolean
  visible: boolean
  validation: 'valid' | 'invalid' | 'unknown'
}

export interface ApplicationPageScan {
  platform: Platform
  url: string
  title: string
  eformId: string | null
  pageNumber: number | null
  sectionTitle: string
  signature: PageSignature
  fields: readonly ScannedApplicationField[]
  navigationControls: readonly {
    controlId: string
    label: string
    kind: 'save_and_continue' | 'declaration' | 'final_submit' | 'other'
  }[]
  signals: readonly ApplicationGuardSignal[]
}

export interface ApplicationPageGuard {
  mutationAllowed: boolean
  uploadAllowed: boolean
  transitionAllowed: boolean
  pauseState: Extract<ApplicationRunState, `PAUSED_${string}`> | null
  blocks: readonly { code: string; evidence: string }[]
}

export interface MapApplicationFieldsInput {
  scan: ApplicationPageScan
  packet: ApplicationPacket
  answerBank: AnswerBank
  company: string
  jobId: string
  bucket: Bucket
}

export interface MappedApplicationField {
  field: ScannedApplicationField
  normalizedKey: string | null
  profileSourcePath: string | null
  policy: FieldPolicyCategory
  proposedValue: string | boolean | null
  sensitive: boolean
  dataCategory: ApplicationDataCategory
  exactOptionMatch: string | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
  dependsOn: readonly string[]
}

export type ApplicationActionType =
  | 'fill_text' | 'select_option' | 'check_box' | 'upload_cv'

export interface ApplicationAction {
  actionId: string
  type: ApplicationActionType
  pageSignature: PageSignature
  fieldId: string
  normalizedKey: string | null
  profileSourcePath: string | null
  policy: FieldPolicyCategory
  proposedValue: string | boolean | null
  sensitive: boolean
  dataCategory: ApplicationDataCategory
  exactOptionMatch: string | null
  dependsOn: readonly string[]
  allowed: boolean
}

export interface ApplicationActionOutcome {
  actionId: string
  fieldId: string
  status: 'filled' | 'selected' | 'checked' | 'uploaded' | 'skipped_equal'
    | 'manual' | 'refused' | 'failed' | 'stopped_by_guard'
  verified: boolean
  errorCategory: 'locator' | 'timeout' | 'readback_mismatch' | 'validation' | 'guard' | null
}

export interface ApplicationPagePlan {
  schemaVersion: 1
  pageSignature: PageSignature
  actions: readonly ApplicationAction[]
  blocked: readonly ApplicationAction[]
  manual: readonly ApplicationAction[]
  canSubmitFinal: false
}

export interface IntermediateTransition {
  kind: 'save_and_continue'
  controlId: string
  label: string
  fromSignature: PageSignature
  pageNumber: number
  isFinal: false
}

export interface PlatformApplicationAdapter {
  readonly platform: Platform
  scanPage(page: Page): Promise<ApplicationPageScan>
  guardPage(scan: ApplicationPageScan): ApplicationPageGuard
  mapFields(input: MapApplicationFieldsInput): MappedApplicationField[]
  identifyTransition(scan: ApplicationPageScan): IntermediateTransition | null
  waitForTransition(page: Page, previous: PageSignature): Promise<ApplicationPageScan>
}
```

- [ ] **Step 4: Run targeted and full checks**

Run:

```text
npx vitest run tests/applicationTypesSafety.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS; existing modules are untouched.

- [ ] **Step 5: Commit**

```text
git add src/application/types.ts tests/applicationTypesSafety.test.ts
git commit -m "feat: define fail-closed application contracts"
```

---

### Task 8: Add Cryptographically Scoped Imminent Approvals

**Files:**
- Create: `src/application/approval.ts`
- Create: `tests/applicationApproval.test.ts`

**Interfaces:**
- Produces: `ApprovalProvider`, `createApprovalRequest`, and `assertApprovalMatches`.
- Consumes: `PageSignature`, `ApplicationDataCategory`, and `Platform`.

- [ ] **Step 1: Write scope and denial tests**

```ts
it('rejects an approval from another page or action set', () => {
  const request = createApprovalRequest(baseRequest)
  expect(() => assertApprovalMatches(request, {
    requestId: request.requestId,
    scopeKey: 'wrong',
    approved: true,
    decidedAt: '2026-07-10T00:00:00.000Z',
  })).toThrow(/scope/i)
})
```

Table-test wrong run, kind, host, page signature, action IDs, data categories, request ID, and denied decisions.

- [ ] **Step 2: Run the tests and observe missing APIs**

Run: `npx vitest run tests/applicationApproval.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement value-free scope hashing**

```ts
import { createHash } from 'node:crypto'
import { ConfigError } from '../config/loadConfig'
import type { ApplicationDataCategory, PageSignature } from './types'
import type { Platform } from '../reconnaissance/types'

export type ApprovalKind = 'page_batch' | 'intermediate_save' | 'cv_upload'
export interface ApprovalRequest {
  requestId: string
  runId: string
  kind: ApprovalKind
  platform: Platform
  destinationHost: string
  pageSignature: PageSignature
  pageNumber: number | null
  sectionTitle: string
  dataCategories: readonly ApplicationDataCategory[]
  actionIds: readonly string[]
  expiresAt: string
  scopeKey: string
}
export interface ApprovalDecision {
  requestId: string
  scopeKey: string
  approved: boolean
  decidedAt: string
}
export interface ApprovalProvider {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>
}

export function createApprovalRequest(
  input: Omit<ApprovalRequest, 'requestId' | 'scopeKey'>,
): ApprovalRequest {
  const stable = JSON.stringify({
    runId: input.runId,
    kind: input.kind,
    platform: input.platform,
    destinationHost: input.destinationHost,
    pageSignature: input.pageSignature,
    pageNumber: input.pageNumber,
    sectionTitle: input.sectionTitle,
    dataCategories: [...input.dataCategories].sort(),
    actionIds: [...input.actionIds].sort(),
    expiresAt: input.expiresAt,
  })
  const scopeKey = createHash('sha256').update(stable).digest('hex')
  return { ...input, requestId: scopeKey.slice(0, 16), scopeKey }
}

export function assertApprovalMatches(
  request: ApprovalRequest,
  decision: ApprovalDecision,
  now = new Date(),
): void {
  if (!decision.approved) throw new ConfigError('Approval denied.')
  if (now.getTime() > Date.parse(request.expiresAt)) {
    throw new ConfigError('Approval request expired before the imminent action.')
  }
  if (decision.requestId !== request.requestId || decision.scopeKey !== request.scopeKey) {
    throw new ConfigError('Approval does not match the imminent action scope.')
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/applicationApproval.test.ts && npm run test:characterization && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/application/approval.ts tests/applicationApproval.test.ts
git commit -m "feat: add page-scoped imminent approvals"
```

---

### Task 9: Add Strict PII-Free Monotonic Telemetry

**Files:**
- Create: `src/application/telemetry.ts`
- Create: `tests/applicationTelemetry.test.ts`

**Interfaces:**
- Produces: `ApplicationTelemetry`, `serializeTelemetryEvent`, and `summarizeApplicationTiming`.
- Constraint: does not reuse `ActionLogger` because `details: unknown` cannot guarantee privacy.

- [ ] **Step 1: Write whitelist, clock, and poison-PII tests**

```ts
it('rejects non-whitelisted detail keys and never serializes values', () => {
  expect(() => telemetry.emit({
    name: 'field_action_done',
    pageNumber: 1,
    fieldId: 'datafield_1',
    actionId: 'a1',
    category: 'identity',
    counters: { completed: 1 },
    value: 'alex.tan@example.edu',
  } as never)).toThrow(/telemetry key/i)
})
```

Test a backwards clock, active-span calculation, excluded transition waits, and explicit auth/verification/CAPTCHA pause subtraction.

- [ ] **Step 2: Run and observe missing telemetry APIs**

Run: `npx vitest run tests/applicationTelemetry.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement a closed event schema**

```ts
export type ApplicationTelemetryName =
  | 'form_active_start' | 'scan_start' | 'scan_end' | 'plan_ready'
  | 'approval_requested' | 'approval_received' | 'guard_start' | 'guard_end'
  | 'field_action_attempt' | 'field_action_done' | 'field_action_failed'
  | 'field_action_skipped_equal' | 'conditional_rescan_start'
  | 'conditional_rescan_end' | 'manual_pause' | 'resume'
  | 'page_ready_for_continue' | 'transition_start' | 'transition_end' | 'run_end'

export interface MonotonicClock { nowMs(): number }
export interface TelemetrySink { emit(event: ApplicationTelemetryEvent): void }
export interface ApplicationTelemetryCounters {
  planned?: number
  completed?: number
  failed?: number
  skipped?: number
  manual?: number
}
export interface ApplicationTelemetryEvent {
  schemaVersion: 1
  runId: string
  scenarioId: string
  name: ApplicationTelemetryName
  monotonicMs: number
  pageNumber: number | null
  fieldId: string | null
  actionId: string | null
  category: ApplicationDataCategory | null
  counters: Readonly<ApplicationTelemetryCounters>
}

export interface ApplicationTimingSpan {
  pageNumber: number
  startedAtMs: number
  endedAtMs: number
  activeMs: number
}

export interface ApplicationTimingSummary {
  activeFormCompletionMs: number
  pages: readonly ApplicationTimingSpan[]
  excludedPauseMs: number
  transitionMs: number
}

export type ApplicationTelemetryInput = Omit<
  ApplicationTelemetryEvent,
  'schemaVersion' | 'runId' | 'scenarioId' | 'monotonicMs'
>

export class ApplicationTelemetry {
  private readonly startedAtMs: number
  private lastMonotonicMs = 0

  constructor(
    private readonly runId: string,
    private readonly scenarioId: string,
    private readonly clock: MonotonicClock,
    private readonly sink: TelemetrySink,
  ) {
    this.startedAtMs = clock.nowMs()
  }

  emit(input: ApplicationTelemetryInput): ApplicationTelemetryEvent {
    const allowedInputKeys = new Set(['name', 'pageNumber', 'fieldId', 'actionId', 'category', 'counters'])
    const allowedCounterKeys = new Set(['planned', 'completed', 'failed', 'skipped', 'manual'])
    for (const key of Object.keys(input)) {
      if (!allowedInputKeys.has(key)) throw new Error(`Unknown telemetry key: ${key}`)
    }
    for (const key of Object.keys(input.counters)) {
      if (!allowedCounterKeys.has(key)) throw new Error(`Unknown telemetry counter: ${key}`)
    }
    const now = this.clock.nowMs() - this.startedAtMs
    if (!Number.isFinite(now) || now < this.lastMonotonicMs) {
      throw new Error('Telemetry clock must be finite and monotonic.')
    }
    this.lastMonotonicMs = now
    const event: ApplicationTelemetryEvent = {
      schemaVersion: 1,
      runId: this.runId,
      scenarioId: this.scenarioId,
      monotonicMs: now,
      ...input,
    }
    this.sink.emit(event)
    return event
  }
}
```

`ApplicationTelemetry.emit` builds this object from an exact-key input type, rejects non-finite or backwards timestamps, and never accepts arbitrary details. `summarizeApplicationTiming` pairs `form_active_start` with `page_ready_for_continue` and excludes `transition_start` to `transition_end`.

- [ ] **Step 4: Verify privacy and regression gates**

Run: `npx vitest run tests/applicationTelemetry.test.ts && npm run test:characterization && npm test && npm run typecheck`

Expected: PASS; serialized poison strings are absent.

- [ ] **Step 5: Commit**

```text
git add src/application/telemetry.ts tests/applicationTelemetry.test.ts
git commit -m "feat: add pii-free application telemetry"
```

---

### Task 10: Add the Synthetic Ten-Section TAL.net Fixture Corpus

**Files:**
- Create: `test-pages/talnet/01-personal-details.html`
- Create: `test-pages/talnet/02-additional-information.html`
- Create: `test-pages/talnet/03-university-education.html`
- Create: `test-pages/talnet/04-employment-extra-curricular.html`
- Create: `test-pages/talnet/05-business-specific-questions.html`
- Create: `test-pages/talnet/06-languages.html`
- Create: `test-pages/talnet/07-attach-documents.html`
- Create: `test-pages/talnet/08-referral-source.html`
- Create: `test-pages/talnet/09-inclusion.html`
- Create: `test-pages/talnet/10-declaration.html`
- Create: `test-pages/talnet/guard-login.html`
- Create: `test-pages/talnet/guard-verification.html`
- Create: `test-pages/talnet/guard-captcha.html`
- Create: `test-pages/talnet/guard-session-expired.html`
- Create: `test-pages/talnet/validation-error.html`
- Create: `tests/talnetFixtures.test.ts`

**Interfaces:**
- Produces: deterministic dummy pages for every TAL scanner, guard, mapper, runner, and benchmark test.
- Constraint: no real candidate name, email, phone, address, employer prose, document name, or application ID.

- [ ] **Step 1: Write fixture-presence and privacy tests first**

```ts
const sections = [
  '01-personal-details.html', '02-additional-information.html',
  '03-university-education.html', '04-employment-extra-curricular.html',
  '05-business-specific-questions.html', '06-languages.html',
  '07-attach-documents.html', '08-referral-source.html',
  '09-inclusion.html', '10-declaration.html',
]

it('contains ten stable dummy sections and no local PII', () => {
  for (const file of sections) {
    const html = readFileSync(path.join(root, 'test-pages/talnet', file), 'utf8')
    expect(html).toMatch(/data-eform-id="fixture-eform-1"/)
    for (const forbidden of ['Samuel Lim', '82883230', 'Fernvale', 'business.smu.edu.sg']) {
      expect(html).not.toContain(forbidden)
    }
  }
})
```

- [ ] **Step 2: Run and observe missing-file failures**

Run: `npx vitest run tests/talnetFixtures.test.ts`

Expected: FAIL because the corpus does not exist.

- [ ] **Step 3: Create realistic deterministic fixtures**

Every section must include `data-eform-id="fixture-eform-1"`, a numeric `data-page-number`, one exact section heading, realistic dummy `datafield_*` IDs, native names, required markers, current values, and navigation controls. Education and experience each contain two repeat instances with stable discriminators. Additional Information contains one controller and one initially hidden dependent field. Languages or Inclusion contains an ARIA combobox/listbox. The declaration page contains certification and final-submit controls for negative testing only.

- [ ] **Step 4: Verify fixtures**

Run: `npx vitest run tests/talnetFixtures.test.ts && npm run test:characterization && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add test-pages/talnet tests/talnetFixtures.test.ts
git commit -m "test: add synthetic TAL.net application fixtures"
```

---

### Task 11: Scan and Sign TAL.net Pages Without Values in the Signature

**Files:**
- Create: `src/talnet/types.ts`
- Create: `src/talnet/TalNetSelectors.ts`
- Create: `src/talnet/TalNetFieldScanner.ts`
- Create: `tests/talnetFieldScanner.test.ts`
- Create: `tests/talnetPageSignature.test.ts`

**Interfaces:**
- Produces: `TalNetPageScan`, offline/live scanners, and `computeTalNetPageSignature`.
- Consumes: `ApplicationPageScan`, `ScannedApplicationField`, and `PageSignature` from Task 7.

- [ ] **Step 1: Write scanner and signature tests**

```ts
it('keeps the signature stable when only values change', () => {
  const first = scanTalNetPageFromHtml(originalHtml, fixtureUrl)
  const second = scanTalNetPageFromHtml(
    originalHtml.replace('Alex Example', 'Jordan Fixture'),
    fixtureUrl,
  )
  expect(second.signature).toBe(first.signature)
})

it('changes the signature when options change', () => {
  const first = scanTalNetPageFromHtml(originalHtml, fixtureUrl)
  const changed = scanTalNetPageFromHtml(originalHtml.replace('Singapore', 'Canada'), fixtureUrl)
  expect(changed.signature).not.toBe(first.signature)
})
```

Also assert hidden/password controls are absent, repeated ordinals are correct, and ARIA combobox options and rendered value are captured.

- [ ] **Step 2: Run and observe missing scanner failures**

Run: `npx vitest run tests/talnetFieldScanner.test.ts tests/talnetPageSignature.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define TAL identities and scans**

```ts
export interface TalNetFieldIdentity {
  stableKey: string
  talFieldId: string | null
  nativeName: string | null
  domId: string | null
  ariaLabel: string | null
  normalizedLabel: string
  sectionTitle: string
  repeatGroup: 'education' | 'experience' | null
  repeatInstance: number
}

export interface TalNetScannedField extends ScannedApplicationField {
  identity: TalNetFieldIdentity
}

export interface TalNetPageScan extends ApplicationPageScan {
  platform: 'tal_net'
  eformId: string
  pageNumber: number
  fields: readonly TalNetScannedField[]
}
```

Stable identity resolution is TAL ID plus section and instance, then native name or DOM ID, then ARIA label and role, then exact normalized label.

- [ ] **Step 4: Implement a value-free SHA-256 signature**

```ts
import { createHash } from 'node:crypto'

export function computeTalNetPageSignature(
  scan: Omit<TalNetPageScan, 'signature'>,
): PageSignature {
  const payload = JSON.stringify({
    eformId: scan.eformId,
    pageNumber: scan.pageNumber,
    sectionTitle: scan.sectionTitle,
    fields: [...scan.fields]
      .filter((field) => field.visible)
      .map((field) => ({
        stableKey: field.identity.stableKey,
        controlType: field.controlType,
        options: [...field.options],
      }))
      .sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
  })
  return createHash('sha256').update(payload).digest('hex') as PageSignature
}
```

Implement `scanTalNetPageFromHtml` using the existing deterministic fixture-scanner pattern and `scanTalNetPage(page)` with a bounded in-page evaluation. Neither scanner reads storage, cookies, password values, file contents, or full body text.

- [ ] **Step 5: Verify**

Run:

```text
npx vitest run tests/talnetFieldScanner.test.ts tests/talnetPageSignature.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add src/talnet tests/talnetFieldScanner.test.ts tests/talnetPageSignature.test.ts
git commit -m "feat: scan and sign TAL.net application pages"
```

---

### Task 12: Add Fail-Closed TAL.net Page Guards

**Files:**
- Create: `src/talnet/TalNetPageGuards.ts`
- Create: `tests/talnetPageGuards.test.ts`

**Interfaces:**
- Produces: `evaluateTalNetPageGuards` and lightweight `scanTalNetDangerSignals`.
- Consumes: `TalNetPageScan` and `ApplicationPageGuard`.

- [ ] **Step 1: Write all pause and permission cases**

```ts
it('always pauses on the declaration page', () => {
  const guard = evaluateTalNetPageGuards(declarationScan, { uploadRequested: false })
  expect(guard.mutationAllowed).toBe(false)
  expect(guard.transitionAllowed).toBe(false)
  expect(guard.pauseState).toBe('PAUSED_DECLARATION')
})
```

Add cases for login, expired session, email verification, OTP, CAPTCHA, unknown page, unapproved upload, approved upload page, and all known pages 1–9.

- [ ] **Step 2: Run and observe missing guard failures**

Run: `npx vitest run tests/talnetPageGuards.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic guard precedence**

```ts
export interface TalNetGuardOptions { uploadRequested: boolean }

export function evaluateTalNetPageGuards(
  scan: TalNetPageScan,
  options: TalNetGuardOptions,
): ApplicationPageGuard {
  const knownNonFinal = scan.pageNumber >= 1 && scan.pageNumber <= 9
  const detectedPause =
    scan.signals.some((signal) => ['declaration', 'certification', 'signature'].includes(signal)) ? 'PAUSED_DECLARATION' :
    scan.signals.includes('final_submit') ? 'PAUSED_FINAL_SUBMIT' :
    scan.signals.includes('captcha') ? 'PAUSED_CAPTCHA' :
    scan.signals.some((signal) => ['email_verification', 'otp'].includes(signal)) ? 'PAUSED_EMAIL_VERIFICATION_OR_OTP' :
    scan.signals.some((signal) => ['login', 'session_expired'].includes(signal)) ? 'PAUSED_LOGIN_OR_SESSION_EXPIRED' :
    null
  const pauseState = detectedPause ?? (knownNonFinal ? null : 'PAUSED_UNKNOWN_FIELD_OR_OPTION')
  const uploadPage = scan.pageNumber === 7
  return {
    mutationAllowed: pauseState === null && knownNonFinal && !uploadPage,
    uploadAllowed: pauseState === null && uploadPage && options.uploadRequested,
    transitionAllowed: pauseState === null && knownNonFinal,
    pauseState,
    blocks: pauseState ? [{ code: pauseState, evidence: scan.sectionTitle }] : [],
  }
}
```

`scanTalNetDangerSignals(page)` returns categories and labels only; it never returns field values or body text.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/talnetPageGuards.test.ts && npm run test:characterization && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/talnet/TalNetPageGuards.ts tests/talnetPageGuards.test.ts
git commit -m "feat: add fail-closed TAL.net page guards"
```

---

### Task 13: Map TAL.net Fields and Repeated Records Exactly

**Files:**
- Create: `src/talnet/TalNetPortalSchema.ts`
- Create: `src/talnet/TalNetFieldMapper.ts`
- Create: `tests/talnetFieldMapper.test.ts`
- Create: `tests/talnetRepeatedRecords.test.ts`

**Interfaces:**
- Produces: `TALNET_BOFA_CAMPUS_SCHEMA_V1`, `mapTalNetFields`, `resolveExactTalNetOption`, and `bindTalNetRepeatedRecords`.
- Consumes: structured packet records from Task 5 and scan/signature types from Task 11.

- [ ] **Step 1: Write field, option, cache, and repeat-binding tests**

```ts
it('does not bind multiple blank repeated records by position', () => {
  const result = bindTalNetRepeatedRecords(
    'experience',
    blankExperienceInstances,
    packet.selectedExperiences,
    [],
  )
  expect(result.every((item) => item.status === 'manual')).toBe(true)
})

it('accepts exact options and reviewed aliases but rejects fuzzy matches', () => {
  expect(resolveExactTalNetOption(['Singapore +65'], 'Singapore +65', {})).toBe('Singapore +65')
  expect(resolveExactTalNetOption(['Company Careers Website'], 'company_site', {
    company_site: 'Company Careers Website',
  })).toBe('Company Careers Website')
  expect(resolveExactTalNetOption(['Mandarin'], 'Mand', {})).toBeNull()
})
```

Add tests for stable TAL ID precedence, name/DOM/ARIA/label fallback, cache invalidation on signature change, reversed education DOM order, employer-plus-role experience discriminator, explicit reviewed bindings, and ambiguous manual results.

- [ ] **Step 2: Run and observe missing mapper failures**

Run: `npx vitest run tests/talnetFieldMapper.test.ts tests/talnetRepeatedRecords.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define the versioned schema and reviewed aliases**

```ts
export interface TalNetFieldRule {
  pageNumber: number
  stableIds: readonly string[]
  nativeNames: readonly string[]
  ariaLabels: readonly string[]
  exactLabels: readonly string[]
  normalizedKey: string
  dataCategory: ApplicationDataCategory
  policy: FieldPolicyCategory
  repeatGroup: 'education' | 'experience' | null
  recordProperty: string | null
  dependsOn: readonly string[]
}

export interface TalNetPortalSchema {
  schemaVersion: 1
  portal: 'tal_net'
  brand: 'bank_of_america_campus'
  rules: readonly TalNetFieldRule[]
  optionAliases: Readonly<Record<string, string>>
}
```

`TALNET_BOFA_CAMPUS_SCHEMA_V1` must cover these audited canonical keys:

| Page | Canonical keys |
| --- | --- |
| 1 | `title`, `first_name`, `preferred_name`, `last_name`, `email`, `secondary_email`, `phone_country`, `phone`, `university_started`, `country`, `address_line_1`, `address_line_2`, `city`, `postal_code`, `has_campus_address` |
| 2 | `previously_worked`, `currently_employed_by_company`, `auditor_employment`, `legally_authorized_sg`, `work_authorization_details`, `requires_sponsorship`, `needs_adjustments`, `relatives_employed`, `client_referral`, `over_18`, `studying_abroad` |
| 3 | `study_location`, repeated `institution`, `education_start`, `degree`, `major`, `degree_status`, `expected_graduation`, `result_scale`, `gpa_scale`, `gpa`, `previous_education` |
| 4 | `has_experience`, `post_bachelors_experience`, repeated `industry`, `employer`, `employer_other`, `employment_type`, `experience_details` |
| 5 | `open_ended_question` |
| 6 | `native_language`, `other_fluent_languages`, `fluent_languages` |
| 7 | `cv_upload` |
| 8 | `referral_source` |
| 9 | `gender`, `race_ethnicity`, `nationality`, `additional_nationality` |
| 10 | no rules; declaration and final controls remain unmapped |

- [ ] **Step 4: Implement exact option and repeat resolution**

```ts
export function resolveExactTalNetOption(
  options: readonly string[],
  proposed: string | boolean | null,
  aliases: Readonly<Record<string, string>>,
): string | null {
  if (proposed === null) return null
  const raw = typeof proposed === 'boolean' ? (proposed ? 'Yes' : 'No') : proposed
  const wanted = aliases[raw] ?? raw
  return options.find((option) => option.trim() === wanted.trim()) ?? null
}

export interface TalNetRepeatBinding {
  group: 'education' | 'experience'
  repeatInstance: number
  recordId: string
}

export interface TalNetRepeatInstance {
  repeatInstance: number
  discriminators: readonly string[]
}

export interface TalNetRepeatRecord {
  recordId: string
  discriminators: readonly string[]
}

export interface RepeatRecordResolution {
  repeatInstance: number
  recordId: string | null
  status: 'bound' | 'manual'
  reason: 'exact_discriminator' | 'approved_binding' | 'sole_remainder' | 'ambiguous'
}

export function bindTalNetRepeatedRecords(
  group: 'education' | 'experience',
  instances: readonly TalNetRepeatInstance[],
  records: readonly TalNetRepeatRecord[],
  approvedBindings: readonly TalNetRepeatBinding[],
): RepeatRecordResolution[] {
  const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const unused = new Set(records.map((record) => record.recordId))
  const resolutions = new Map<number, RepeatRecordResolution>()
  for (const instance of instances) {
    const evidence = new Set(instance.discriminators.map(normalize).filter(Boolean))
    const exact = records.filter((record) =>
      unused.has(record.recordId) &&
      record.discriminators.some((value) => evidence.has(normalize(value))),
    )
    if (exact.length === 1) {
      unused.delete(exact[0]!.recordId)
      resolutions.set(instance.repeatInstance, { repeatInstance: instance.repeatInstance, recordId: exact[0]!.recordId, status: 'bound', reason: 'exact_discriminator' })
      continue
    }
    const approved = approvedBindings.find((binding) =>
      binding.group === group && binding.repeatInstance === instance.repeatInstance && unused.has(binding.recordId),
    )
    if (approved) {
      unused.delete(approved.recordId)
      resolutions.set(instance.repeatInstance, { repeatInstance: instance.repeatInstance, recordId: approved.recordId, status: 'bound', reason: 'approved_binding' })
    }
  }
  const unresolved = instances.filter((instance) => !resolutions.has(instance.repeatInstance))
  if (unresolved.length === 1 && unused.size === 1) {
    const recordId = [...unused][0]!
    resolutions.set(unresolved[0]!.repeatInstance, { repeatInstance: unresolved[0]!.repeatInstance, recordId, status: 'bound', reason: 'sole_remainder' })
  }
  return instances.map((instance) => resolutions.get(instance.repeatInstance) ?? {
    repeatInstance: instance.repeatInstance,
    recordId: null,
    status: 'manual',
    reason: 'ambiguous',
  })
}
```

- [ ] **Step 5: Implement mapping with signature-bound cache entries**

`mapTalNetFields` searches stable IDs, native names/DOM IDs, ARIA labels, then exact labels. Unknown fields receive `manual_review`, `proposedValue: null`, and low confidence. A cached mapping is accepted only when both schema version and page signature match.

- [ ] **Step 6: Verify**

Run:

```text
npx vitest run tests/talnetFieldMapper.test.ts tests/talnetRepeatedRecords.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS; all ten fixtures produce redacted inspect-only mappings and page 10 produces no executable mapping.

- [ ] **Step 7: Commit**

```text
git add src/talnet/TalNetPortalSchema.ts src/talnet/TalNetFieldMapper.ts tests/talnetFieldMapper.test.ts tests/talnetRepeatedRecords.test.ts
git commit -m "feat: map TAL.net fields and repeated records exactly"
```

---

### Task 14: Build Diff-Aware, Dependency-Ordered, Verified Field Batches

**Files:**
- Create: `src/talnet/TalNetControls.ts`
- Create: `src/talnet/TalNetFieldFiller.ts`
- Create: `tests/talnetFieldDiff.test.ts`
- Create: `tests/talnetControls.test.ts`
- Create: `tests/talnetFieldFiller.test.ts`

**Interfaces:**
- Produces: `diffTalNetActions`, `orderTalNetActions`, `applyTalNetFieldAction`, `verifyTalNetFieldBatch`, and `executeTalNetFieldBatch`.
- Constraint: only `TalNetControls.ts` may call text/select/checkbox/custom-option mutation primitives.

```ts
export interface TalNetActionDiff {
  pending: readonly ApplicationAction[]
  skipped: readonly ApplicationActionOutcome[]
}

export interface ExecuteTalNetFieldBatchInput {
  page: Page
  scan: TalNetPageScan
  plan: ApplicationPagePlan
  guardCheck(): Promise<ApplicationPageGuard>
  dangerCheck(): Promise<readonly ApplicationGuardSignal[]>
  rescan(): Promise<TalNetPageScan>
}

export interface TalNetBatchResult {
  outcomes: readonly ApplicationActionOutcome[]
  finalScan: TalNetPageScan
  conditionalRescans: 0 | 1
}
```

- [ ] **Step 1: Write diff, dependency, drift, and read-back tests**

```ts
it('skips equal fields without invoking a mutation primitive', async () => {
  const result = diffTalNetActions(scanWithEmail, [emailActionWithSameValue])
  expect(result.skipped.map((item) => item.status)).toEqual(['skipped_equal'])
  expect(result.pending).toHaveLength(0)
})

it('refuses a custom option when zero or multiple exact matches exist', async () => {
  await expect(applyTalNetFieldAction(pageWithDuplicateOptions, mandarinAction))
    .rejects.toThrow(/exact option/i)
})
```

Add tests for controllers first, exactly one conditional rescan, signature drift before mutation, one bounded batch read-back, native select read-back, mismatch stop, lightweight danger stop, and no repeated full-body scans.

- [ ] **Step 2: Run and observe missing filler APIs**

Run: `npx vitest run tests/talnetFieldDiff.test.ts tests/talnetControls.test.ts tests/talnetFieldFiller.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement value normalization, diff, and topological ordering**

```ts
export function normalizeTalNetComparable(value: string | boolean | null): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function diffTalNetActions(
  scan: TalNetPageScan,
  actions: readonly ApplicationAction[],
): TalNetActionDiff {
  const fields = new Map(scan.fields.map((field) => [field.fieldId, field]))
  const pending: ApplicationAction[] = []
  const skipped: ApplicationActionOutcome[] = []
  for (const action of actions) {
    const field = fields.get(action.fieldId)
    if (field && normalizeTalNetComparable(field.currentValue) === normalizeTalNetComparable(action.proposedValue)) {
      skipped.push({ actionId: action.actionId, fieldId: action.fieldId, status: 'skipped_equal', verified: true, errorCategory: null })
    } else {
      pending.push(action)
    }
  }
  return { pending, skipped }
}
```

`orderTalNetActions` performs a stable topological sort over `dependsOn`; cycles fail before mutation.

- [ ] **Step 4: Isolate control mutation and exact verification**

`applyTalNetFieldAction` supports only `fill_text`, `select_option`, and `check_box`. Custom combobox selection is scoped to the stamped field and its `aria-controls` listbox, requires exactly one exact option, and reads back the rendered value. Native select and checkbox actions also read back their state.

`verifyTalNetFieldBatch` uses one bounded page evaluation keyed by stamped field IDs. It returns one outcome per action and never returns sensitive values.

- [ ] **Step 5: Implement the batch stop rules**

Before the batch, compare the current signature with the plan signature. Run controller actions first, rescan and replan at most once if conditional visibility changes, then run independent actions. Between actions, run the lightweight danger scan. Stop on first failure, guard signal, or read-back mismatch.

- [ ] **Step 6: Verify**

Run:

```text
npx vitest run tests/talnetFieldDiff.test.ts tests/talnetControls.test.ts tests/talnetFieldFiller.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
git add src/talnet/TalNetControls.ts src/talnet/TalNetFieldFiller.ts tests/talnetFieldDiff.test.ts tests/talnetControls.test.ts tests/talnetFieldFiller.test.ts
git commit -m "feat: execute verified diff-aware TAL.net field batches"
```

---

### Task 15: Gate and Verify TAL.net CV Upload

**Files:**
- Create: `src/talnet/TalNetResumeUpload.ts`
- Create: `tests/talnetResumeUpload.test.ts`

**Interfaces:**
- Produces: `assertTalNetCvUploadAllowed` and `uploadTalNetCv`.
- Consumes: selected-document readiness, page-scoped upload approval, current signature, and TAL guard.

- [ ] **Step 1: Write one test for every upload gate and read-back result**

```ts
it('refuses signature drift before setInputFiles', async () => {
  await expect(uploadTalNetCv(page, {
    ...allowedInput,
    expectedPageSignature: differentSignature,
  })).rejects.toThrow(/signature/i)
  expect(setInputFilesCalls).toBe(0)
})
```

Test missing flag, approval mismatch, selected-CV blocker, route mismatch, destination mismatch, blocked page, missing file, exact filename success, and filename mismatch failure. Poison telemetry with path/filename sentinels and assert they are absent.

- [ ] **Step 2: Run and observe missing upload APIs**

Run: `npx vitest run tests/talnetResumeUpload.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the fail-closed gate**

```ts
export interface TalNetCvUploadGateInput {
  allowCvUploadFlag: boolean
  approvalRequest: ApprovalRequest
  approvalDecision: ApprovalDecision
  selectedDocument: SelectedDocumentReadiness
  expectedDestination: {
    platform: 'tal_net'
    eformId: string
    pageNumber: number
    fieldKey: string
  }
  expectedPageSignature: PageSignature
  currentScan: TalNetPageScan
  guard: ApplicationPageGuard
  fileExists?: (path: string) => boolean
}
```

`assertTalNetCvUploadAllowed` checks the flag, approval scope, selected-document readiness and identity, routed key/path, exact destination, unchanged signature, upload guard, and file existence in that order.

- [ ] **Step 4: Upload and verify the visible filename**

After `setInputFiles`, read `input.files[0].name` or the TAL-rendered filename and compare it to `path.basename(selectedPath)`. Return `verified: false` on mismatch. Telemetry records only the action ID and `document` data category, never document key, path, or filename.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/talnetResumeUpload.test.ts && npm run test:characterization && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add src/talnet/TalNetResumeUpload.ts tests/talnetResumeUpload.test.ts
git commit -m "feat: gate and verify TAL.net CV upload"
```

---

### Task 16: Persist Atomic Redacted Checkpoints and Resume by Live Diff

**Files:**
- Create: `src/application/checkpoint.ts`
- Create: `tests/applicationCheckpoint.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `ApplicationCheckpointStore`, `FileApplicationCheckpointStore`, and `redactApplicationPagePlan`.
- Constraint: resume always scans live state; a checkpoint never authorizes replay.

- [ ] **Step 1: Write round-trip, privacy, corruption, and resume tests**

```ts
it('never persists proposed values or sensitive option labels', async () => {
  await store.save(checkpointWithSensitivePlan)
  const serialized = readFileSync(checkpointPath, 'utf8')
  for (const forbidden of ['alex.tan@example.edu', '+65 1234 5678', 'Example_CV.pdf']) {
    expect(serialized).not.toContain(forbidden)
  }
})
```

Test atomic replacement, schema-version rejection, corrupt JSON, run-ID traversal, changed signature invalidation, and equal live value becoming `skipped_equal` rather than replayed.

- [ ] **Step 2: Run and observe missing checkpoint APIs**

Run: `npx vitest run tests/applicationCheckpoint.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the versioned redacted checkpoint**

```ts
export interface RedactedApplicationAction {
  actionId: string
  type: ApplicationActionType
  pageSignature: PageSignature
  fieldId: string
  normalizedKey: string | null
  profileSourcePath: string | null
  policy: FieldPolicyCategory
  sensitive: boolean
  dataCategory: ApplicationDataCategory
  dependsOn: readonly string[]
  allowed: boolean
  valueState: ValueStateToken
}

export interface RedactedApplicationPagePlan {
  schemaVersion: 1
  pageSignature: PageSignature
  actions: readonly RedactedApplicationAction[]
  blocked: readonly RedactedApplicationAction[]
  manual: readonly RedactedApplicationAction[]
  canSubmitFinal: false
}

export interface ApplicationCheckpointV1 {
  schemaVersion: 1
  runId: string
  platform: Platform
  jobId: string
  state: ApplicationRunState
  pageSignature: PageSignature | null
  redactedPlan: RedactedApplicationPagePlan | null
  verifiedOutcomes: readonly ApplicationActionOutcome[]
  completedSpans: readonly ApplicationTimingSpan[]
  pauseState: ApplicationRunState | null
  writtenAt: string
}

export interface ApplicationCheckpointStore {
  load(runId: string): Promise<ApplicationCheckpointV1 | null>
  save(checkpoint: ApplicationCheckpointV1): Promise<void>
}
```

`redactApplicationPagePlan` removes proposed values and sensitive option labels while keeping field IDs, source paths, policy, categories, and value-state tokens. `FileApplicationCheckpointStore` validates run IDs with `/^[a-zA-Z0-9_-]+$/`, writes a sibling temporary file, and renames atomically.

- [ ] **Step 4: Add the generated directory boundary**

Add to `.gitignore`:

```text
application-runs/
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/applicationCheckpoint.test.ts && npm run test:characterization && npm test && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add .gitignore src/application/checkpoint.ts tests/applicationCheckpoint.test.ts
git commit -m "feat: persist redacted application checkpoints"
```

---

### Task 17: Add the Persistent Guarded Runner and TAL Intermediate Transitions

**Files:**
- Create: `src/application/ApplicationRun.ts`
- Create: `src/talnet/TalNetTransitions.ts`
- Create: `tests/applicationRunState.test.ts`
- Create: `tests/applicationRun.integration.test.ts`
- Create: `tests/talnetTransitions.test.ts`

**Interfaces:**
- Produces: pure `transitionApplicationRun`, `startApplicationRun`, `resumeApplicationRun`, and allowlisted TAL transition APIs.
- Consumes: adapter, batch executor, approval provider, checkpoint store, and telemetry from previous tasks.

- [ ] **Step 1: Write the full state-transition table and fake-adapter integration**

```ts
it('requires approval before field mutation and page save', async () => {
  const result = await startApplicationRun(input, dependencies)
  expect(callOrder).toEqual([
    'scan', 'guard', 'map', 'buildPlan', 'pageApproval',
    'execute', 'verify', 'saveApproval', 'saveAndContinue', 'waitForTransition', 'scan',
  ])
  expect(result.canSubmitFinal).toBe(false)
})
```

Table-test every legal state edge from the design. Illegal events transition to `FAILED_CLOSED` and checkpoint. Resume must always re-enter `SCAN`. Test approval denial, validation failure, timeout, signature drift, login, OTP, CAPTCHA, declaration, and final-submit pause states.

- [ ] **Step 2: Run and observe missing state/transition APIs**

Run: `npx vitest run tests/applicationRunState.test.ts tests/applicationRun.integration.test.ts tests/talnetTransitions.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the pure state reducer and dependency contracts**

```ts
export type ApplicationRunEvent =
  | { type: 'CHECKPOINT_OPENED' }
  | { type: 'SCAN_COMPLETED' }
  | { type: 'GUARD_PASSED' }
  | { type: 'PLAN_BUILT' }
  | { type: 'PAGE_APPROVED' }
  | { type: 'BATCH_EXECUTED' }
  | { type: 'BATCH_VERIFIED' }
  | { type: 'SAVE_APPROVED' }
  | { type: 'SAVE_COMPLETED' }
  | { type: 'TRANSITION_COMPLETED' }
  | { type: 'PAUSE'; state: Extract<ApplicationRunState, `PAUSED_${string}`> }
  | { type: 'COMPLETE_AT_REVIEW' }
  | { type: 'FAIL' }

export function transitionApplicationRun(
  state: ApplicationRunState,
  event: ApplicationRunEvent,
): ApplicationRunState

export interface ApplicationBatchExecutor {
  execute(
    page: Page,
    plan: ApplicationPagePlan,
    telemetry: ApplicationTelemetry,
  ): Promise<readonly ApplicationActionOutcome[]>
  verify(
    page: Page,
    plan: ApplicationPagePlan,
    outcomes: readonly ApplicationActionOutcome[],
  ): Promise<readonly ApplicationActionOutcome[]>
}

export interface ApplicationRunDependencies {
  adapter: PlatformApplicationAdapter
  buildPlan(input: {
    scan: ApplicationPageScan
    mapped: readonly MappedApplicationField[]
    mode: 'inspect_only' | 'execute'
  }): ApplicationPagePlan
  batchExecutor: ApplicationBatchExecutor
  approvals: ApprovalProvider
  checkpoints: ApplicationCheckpointStore
  telemetry: ApplicationTelemetry
}

export interface StartApplicationRunInput {
  runId: string
  jobId: string
  page: Page
  packet: ApplicationPacket
  answerBank: AnswerBank
  mode: 'inspect_only' | 'execute'
}

export interface ResumeApplicationRunInput extends StartApplicationRunInput {
  expectedCheckpointRunId: string
}

export interface ApplicationRunResult {
  runId: string
  state: ApplicationRunState
  pageSignature: PageSignature | null
  outcomes: readonly ApplicationActionOutcome[]
  canSubmitFinal: false
}

export async function startApplicationRun(
  input: StartApplicationRunInput,
  dependencies: ApplicationRunDependencies,
): Promise<ApplicationRunResult>

export async function resumeApplicationRun(
  input: ResumeApplicationRunInput,
  dependencies: ApplicationRunDependencies,
): Promise<ApplicationRunResult>
```

`transitionApplicationRun` is a closed switch over state/event pairs. Unknown pairs return `FAILED_CLOSED`; no event can yield an executable declaration or final-submit state.

- [ ] **Step 4: Implement allowlisted TAL transitions without sleeps**

```ts
export function identifyTalNetTransition(
  scan: TalNetPageScan,
): IntermediateTransition | null

export async function saveAndContinue(
  page: Page,
  transition: IntermediateTransition,
  approvalRequest: ApprovalRequest,
  approvalDecision: ApprovalDecision,
  currentSignature: PageSignature,
  telemetry: ApplicationTelemetry,
): Promise<void>

export async function waitForTalNetTransition(
  page: Page,
  previous: PageSignature,
  options: { timeoutMs: number },
): Promise<TalNetPageScan>
```

`identifyTalNetTransition` returns only exact allowlisted save-and-continue controls on pages 1–9. `saveAndContinue` rechecks approval, signature, and guard immediately before the click. `waitForTalNetTransition` races page/signature change against validation, login, CAPTCHA, OTP, and timeout; it does not use fixed sleep or unconditional `networkidle`.

- [ ] **Step 5: Implement orchestration and checkpoint boundaries**

The runner follows scan, guard, map, plan, page approval, execute, verify, save approval, transition, wait, then scan. It checkpoints after each verified page and every pause/failure. Inspect-only stops after writing the redacted plan. Declaration and final-submit scans return pause results with `canSubmitFinal: false`.

- [ ] **Step 6: Verify**

Run:

```text
npx vitest run tests/applicationRunState.test.ts tests/applicationRun.integration.test.ts tests/talnetTransitions.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
git add src/application/ApplicationRun.ts src/talnet/TalNetTransitions.ts tests/applicationRunState.test.ts tests/applicationRun.integration.test.ts tests/talnetTransitions.test.ts
git commit -m "feat: add guarded multi-page application runner"
```

---

### Task 18: Compose the TAL Adapter and Add an Isolated Opt-In CLI

**Files:**
- Create: `src/talnet/TalNetDraftAdapter.ts`
- Create: `src/application/featureFlags.ts`
- Create: `src/talnet-cli.ts`
- Create: `tests/helpers/talnetFixtureServer.ts`
- Create: `tests/talnetDraftAdapter.test.ts`
- Create: `tests/talnetBrowserIntegration.test.ts`
- Create: `tests/talnetDraftSafety.test.ts`
- Create: `tests/talnetCli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `TalNetDraftAdapter`, `parseTalNetArgs`, and `runTalNetCli`.
- Preserves: `src/draft-cli.ts` and `draft:workday` behavior exactly.

- [ ] **Step 1: Write adapter, CLI default, kill-switch, and static safety tests**

```ts
it('defaults TAL drafting to inspect-only and refuses mutation with the kill switch off', () => {
  const inspect = parseTalNetArgs(['--provider', 'tal_net', '--job', 'bofa_gib_2027_sg'])
  expect(inspect.inspectOnly).toBe(true)
  expect(() => parseTalNetArgs([
    '--provider', 'tal_net', '--job', 'bofa_gib_2027_sg', '--fill-safe-fields',
  ], {})).toThrow(/TALNET_MUTATION_ENABLED/)
})
```

Static tests confine `setInputFiles` to `TalNetResumeUpload.ts`, form mutation primitives to `TalNetControls.ts`, intermediate `.click` to `TalNetTransitions.ts`, and forbid storage, cookies, synthetic events, request submission, direct HTTP form posts, force actions, declaration actions, and final-submit actions.

- [ ] **Step 2: Run and observe missing adapter/CLI failures**

Run: `npx vitest run tests/talnetDraftAdapter.test.ts tests/talnetDraftSafety.test.ts tests/talnetCli.test.ts`

Expected: FAIL.

- [ ] **Step 3: Compose the adapter**

`TalNetDraftAdapter` implements `PlatformApplicationAdapter` exactly and delegates each method to the tested TAL module. Declaration/final pages return no transition.

- [ ] **Step 4: Implement the kill switch and CLI parsing**

```ts
export function talNetMutationEnabled(env: NodeJS.ProcessEnv): boolean {
  return env['TALNET_MUTATION_ENABLED'] === 'true'
}

export interface TalNetArgs {
  provider: 'tal_net'
  transport: 'live' | 'fixture'
  jobId: string
  inspectOnly: boolean
  fillSafeFields: boolean
  fillConfirmedFields: boolean
  fillDraftAnswers: boolean
  fillDemographics: boolean
  allowCvUpload: boolean
  allowIntermediateSave: boolean
  headed: boolean
  resumeRunId: string | null
}

export interface TalNetCliDependencies {
  launchTarget(args: TalNetArgs): Promise<{ page: Page; close(): Promise<void> }>
  runApplication(args: TalNetArgs, page: Page): Promise<ApplicationRunResult>
}

export function parseTalNetArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): TalNetArgs

export async function runTalNetCli(
  args: TalNetArgs,
  dependencies: TalNetCliDependencies,
): Promise<ApplicationRunResult>
```

Require `--provider tal_net`. Default to inspect-only when no mutation flag is present. Any mutation flag requires the environment kill switch. Live execution requires headed mode. `--inspect-only` conflicts with mutation flags. `--resume` rescans live state before building a new plan.

Add:

```json
"draft:talnet": "tsx src/talnet-cli.ts"
```

- [ ] **Step 5: Run headed browser integration against local fixtures**

The fixture server exposes the ten pages locally. Verify one persistent session skips equal fields, performs one conditional rescan, fills exact values, crosses allowlisted intermediate pages only after approvals, and stops at the Declaration page with no final action.

Run:

```text
npx vitest run tests/talnetDraftAdapter.test.ts tests/talnetDraftSafety.test.ts tests/talnetCli.test.ts
npx vitest run tests/talnetBrowserIntegration.test.ts
npm run test:characterization
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```text
git add package.json src/application/featureFlags.ts src/talnet src/talnet-cli.ts tests/helpers/talnetFixtureServer.ts tests/talnetDraftAdapter.test.ts tests/talnetBrowserIntegration.test.ts tests/talnetDraftSafety.test.ts tests/talnetCli.test.ts
git commit -m "feat: add opt-in TAL.net runner and rollback switch"
```

---

### Task 19: Add Differential and Paired Performance Release Gates

**Files:**
- Create: `src/regression/normalizeRegression.ts`
- Create: `src/regression/compareRegression.ts`
- Create: `src/regression/runDifferential.ts`
- Create: `tests/differentialRegression.test.ts`
- Create: `tests/talnetDifferential.test.ts`
- Create: `src/benchmark/types.ts`
- Create: `src/benchmark/pairedBenchmark.ts`
- Create: `src/benchmark/report.ts`
- Create: `src/benchmark-cli.ts`
- Create: `tests/pairedBenchmark.test.ts`
- Create: `tests/benchmarkPrivacy.test.ts`
- Create: `tests/fixtures/benchmarks/talnet-ten-section.fixture.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify locally without staging: `profiles/candidate_profile.local.yaml`

**Interfaces:**
- Produces: `runDifferentialScenario`, `runPairedBenchmark`, `pairedBootstrapMedianCi`, and `evaluateBenchmark`.
- Consumes: characterization snapshots, telemetry summaries, the synthetic ten-section runner, and all safety counters.

- [ ] **Step 1: Write semantic-equivalence and benchmark-statistics tests**

```ts
it('fails a faster candidate whose semantic output changes', () => {
  expect(() => compareRegression(baseline, {
    ...candidate,
    allowedActions: ['different_field'],
  })).toThrow(/behavioral regression/i)
})

it('passes only when median and lower CI meet 20 percent and p90 does not regress', () => {
  const decision = evaluateBenchmark(qualifyingResult)
  expect(decision).toEqual({ accepted: true, reasons: [] })
})
```

Test ignored timing fields, additive telemetry, plan/guard/pause/DOM/exit/artifact mismatches, deterministic seeded bootstrap results, fewer than 30 pairs, manual interactions above 50, wrong-field mutations, guard violations, declaration/final mutations, and poison-PII output.

- [ ] **Step 2: Run and observe missing regression/benchmark APIs**

Run: `npx vitest run tests/differentialRegression.test.ts tests/talnetDifferential.test.ts tests/pairedBenchmark.test.ts tests/benchmarkPrivacy.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement strict semantic comparison**

`normalizeRegression` may remove only timestamps, monotonic durations, generated run-directory prefixes, and versioned additive telemetry. `compareRegression` compares page kinds, mapped keys/values/policies, allowed/blocked/manual actions, guards, pause/error categories, verified DOM state, exit category, and redacted artifact schemas.

Add package script:

```json
"test:differential": "vitest run tests/differentialRegression.test.ts tests/talnetDifferential.test.ts"
```

- [ ] **Step 4: Implement paired sampling and the release decision**

```ts
export interface BenchmarkObservation {
  activeFormCompletionMs: number
  manualInteractions: number
  wrongFieldMutations: number
  guardViolations: number
  declarationMutations: number
  finalSubmitMutations: number
}

export interface PairedSample {
  pairIndex: number
  order: 'baseline_candidate' | 'candidate_baseline'
  baseline: BenchmarkObservation
  candidate: BenchmarkObservation
}

export interface PairedBenchmarkResult {
  scenarioId: string
  samples: readonly PairedSample[]
  medianImprovement: number
  confidenceInterval: { estimate: number; lower: number; upper: number }
  baselineP90Ms: number
  candidateP90Ms: number
  candidateManualInteractions: number
  safetyTotals: {
    wrongFieldMutations: number
    guardViolations: number
    declarationMutations: number
    finalSubmitMutations: number
  }
}

export interface BenchmarkAcceptance {
  accepted: boolean
  reasons: readonly string[]
}

export async function runPairedBenchmark(options: {
  scenarioId: string
  warmups: number
  pairCount: number
  run(
    variant: 'baseline' | 'candidate',
    pairIndex: number,
  ): Promise<BenchmarkObservation>
}): Promise<PairedBenchmarkResult>

export function pairedBootstrapMedianCi(
  samples: readonly PairedSample[],
  options: { iterations: number; seed: number; confidence: 0.95 },
): { estimate: number; lower: number; upper: number }

export function evaluateBenchmark(
  result: PairedBenchmarkResult,
): BenchmarkAcceptance
```

Alternate pair order. Compute each pair's improvement as
`1 - candidate.activeFormCompletionMs / baseline.activeFormCompletionMs`. Bootstrap complete pairs with a seeded PRNG and take the median. `evaluateBenchmark` accepts only when median improvement and lower 95% bound are at least 20%, candidate p90 is no worse, manual interactions are at most 50, and all wrong-field, guard, declaration, and final mutation counters are zero.

Add scripts:

```json
"benchmark:talnet": "tsx src/benchmark-cli.ts",
"verify:talnet": "npm run test:characterization && npm run test:differential && npm test && npm run typecheck"
```

- [ ] **Step 5: Protect generated artifacts and document usage**

Add to `.gitignore`:

```text
benchmark-runs/
```

Update `README.md` with inspect-only and mutation examples, the kill switch, action-time approvals, pause states, rollback instructions, `verify:talnet`, benchmark acceptance criteria, and the permanent final-submit prohibition.

- [ ] **Step 6: Migrate the local language facts without staging PII**

Add this structured data to `profiles/candidate_profile.local.yaml` after Task 4's schema is available:

```yaml
  languages:
    - name: "English"
      native: true
      fluent: true
      reads: true
      writes: true
      provenance:
        source: "user-confirmed TAL.net application"
        confirmed_at: "2026-07-10T00:00:00+08:00"
    - name: "Mandarin"
      native: false
      fluent: true
      reads: null
      writes: true
      provenance:
        source: "user-confirmed TAL.net application"
        confirmed_at: "2026-07-10T00:00:00+08:00"
```

Do not stage this gitignored file. Keep the existing `language_fluency` answer-bank entry during the compatibility period. Run `npm run profile:validate -- --profile profiles/candidate_profile.local.yaml`.

- [ ] **Step 7: Run the complete correctness gate**

Run:

```text
npm run verify:talnet
git status --short
```

Expected: all characterization, differential, unit, integration, static safety, and type checks pass. Only intended tracked files are staged or modified; `profiles/candidate_profile.local.yaml`, `tmp/`, and `../scripts/` remain unstaged.

- [ ] **Step 8: Run the paired benchmark**

Run: `npm run benchmark:talnet -- --pairs 30 --warmups 5 --headed`

Expected release result:

- median paired active-time improvement at least 20%;
- lower paired-bootstrap 95% bound at least 20%;
- candidate p90 no worse than baseline;
- manual field interactions at most 50;
- zero wrong-field, guard, declaration, and final-submit mutations; and
- report contains environment metadata and no PII.

If any criterion fails, leave `TALNET_MUTATION_ENABLED` unset, keep inspect-only available, and do not claim the 20% target.

- [ ] **Step 9: Commit tracked release gates and documentation**

```text
git add .gitignore package.json README.md src/regression src/benchmark src/benchmark-cli.ts tests/differentialRegression.test.ts tests/talnetDifferential.test.ts tests/pairedBenchmark.test.ts tests/benchmarkPrivacy.test.ts tests/fixtures/benchmarks
git commit -m "perf: prove TAL.net speed without behavioral regressions"
```

---

## Specification Coverage Matrix

| Approved design requirement | Implementation tasks |
| --- | --- |
| Zero-regression characterization and semantic equivalence | 1, 19 |
| Correct answer and demographic authorization gates | 2, 3 |
| Backwards-compatible candidate, education, language, answer, and event data | 4, 5 |
| Structured repeatable experiences and portal completeness | 5, 13 |
| Selected-document blocker scope and verified CV upload | 6, 15 |
| Platform-neutral fail-closed contracts | 7 |
| Imminent page-scoped approvals | 8, 15, 17 |
| PII-free active-time telemetry | 9, 19 |
| Ten-section synthetic TAL flow | 10 |
| Stable field identity and value-free page signatures | 11 |
| Login, verification, CAPTCHA, declaration, final, and unknown-page guards | 12 |
| Exact option mapping and non-positional repeat binding | 13 |
| Diff-aware dependency ordering and verified batch execution | 14 |
| Atomic redacted checkpoint and live-diff resume | 16 |
| Persistent state machine and allowlisted intermediate navigation | 17 |
| Isolated inspect-only CLI, explicit mutation switch, and rollback | 18 |
| 20% paired benchmark, p90 guard, interaction target, privacy, and release proof | 19 |

The self-review found no approved-design requirement without an implementing task.

## Final Verification Checklist

- [ ] `npm run test:characterization` passes with no unexplained snapshot change.
- [ ] `npm run test:differential` passes with semantic equivalence.
- [ ] `npm test` passes all existing and new tests.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run profile:validate -- --profile profiles/candidate_profile.local.yaml` exits 0 without printing PII.
- [ ] Static safety tests prove mutation primitives remain confined to the named TAL modules.
- [ ] Synthetic ten-section flow stops at Declaration with `canSubmitFinal: false`.
- [ ] Live TAL rollout begins inspect-only and requires explicit plan review and approvals.
- [ ] Paired benchmark meets every 20% confidence, p90, interaction, and safety criterion.
- [ ] `git status --short` shows no staged local profile, local manifest, document, run, `tmp/`, or `../scripts/` file.
