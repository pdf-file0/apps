# TAL.net Application Speed Upgrade Design

**Date:** 2026-07-10

**Status:** Awaiting written-spec review

**Primary target:** Bank of America campus applications on TAL.net

**Secondary goal:** Reusable contracts for later Workday and Oracle implementations

## 1. Objective

Reduce active application-form completion time by at least 20% while preserving the
project's fail-closed safety model. The first production target is the ten-section
Bank of America TAL.net application flow that was audited in July 2026.

The read-only live audit found approximately 63 visible field-level controls across
ten sections. Personal Details, Additional Information, University Education, and
Employment / Extra Curricular Experience account for 52 controls, or roughly 83% of
the interaction load. Automating at least 13 currently manual interactions is enough
to clear the interaction-count proxy for a 20% improvement.

The upgrade must improve completion speed without automating account creation,
passwords, OTP or email verification, CAPTCHAs, legal declarations, signatures, or
final submission.

For every currently supported workflow, the only permitted observable change is
lower latency. Existing field values, mappings, policy decisions, CLI defaults, exit
behavior, artifacts, and safety stops must remain behaviorally equivalent. TAL.net
drafting is a new opt-in capability, isolated from existing flows and inspect-only by
default; it must not alter Workday, reconnaissance, account-planning, packet, or
document-readiness behavior unless an additive, backwards-compatible schema field is
explicitly introduced by this design.

## 2. Success Criteria

### User-time target

The primary metric is `active_form_completion_ms`, summed across application pages.
It starts when an authenticated supported form is ready and the user starts assisted
completion. It ends when all visible required fields on that page are filled,
verified, or explicitly resolved and the page is ready for the next human-approved
transition.

The metric includes scanning, planning, automated filling, human reading and entry,
verification, recoverable errors, and review. It excludes explicitly logged waits
for authentication, OTP/email verification, CAPTCHA, inter-page network loading,
browser-hidden or abandoned time, and final submission.

The release passes only when all of the following hold:

1. Median paired application-level active time improves by at least 20%.
2. The paired-bootstrap 95% confidence interval lower bound is at least 20% before
   making a strict "proven 20%" claim.
3. Candidate p90 active time does not regress.
4. Manual field-level interactions fall from approximately 63 to 50 or fewer on the
   audited TAL.net scenario.
5. Every successful automated field action is read back and verified.
6. There are zero wrong-field mutations, guarded-page mutations, declaration
   actions, and final-submit actions.

The implementation should target a 25-30% median improvement so ordinary timing
noise does not erase the required 20% lower confidence bound.

### Correctness and safety target

- Existing policy categories remain fail-closed.
- Unknown fields, ambiguous repeated groups, and non-exact options remain manual.
- A changed page signature invalidates the prepared plan before mutation.
- Sensitive data is never written to logs or benchmark artifacts.
- The application stays open for the user at every required manual checkpoint.
- `canSubmitFinal` remains `false` in every code path.

### Zero-regression contract

The upgrade has a zero-regression budget. A performance change is rejected if it
changes an existing supported flow's semantic result, even when it is faster.

Before implementation, characterization tests freeze the current behavior of:

- reconnaissance platform detection, CTA policy, stop reasons, exit codes, and
  redacted artifacts;
- Workday scan, map, plan, guard, fill, upload-gate, and failure behavior;
- profile, answer-bank, account-status, packet, and document validation;
- CLI defaults and required flags; and
- PII redaction and gitignored artifact boundaries.

For existing workflows, baseline and candidate runs must produce the same normalized
plan, allowed/blocked/manual action sets, selected values, page end state, and error or
pause category. Comparisons ignore only timestamps, measured durations, generated run
directory names, and explicitly versioned additive telemetry fields. Independent
field actions may execute in a different order only when a dependency analysis proves
that order cannot change visible fields, validation, or results.

No existing command becomes mutating by default. No existing safety flag is removed,
renamed, weakened, or implicitly enabled. New TAL.net mutation requires an explicit
provider selection, the existing category-specific fill permissions, an unchanged
reviewed plan, and the runtime approval gates defined below.

## 3. Scope

### Included

1. A TAL.net-specific draft adapter and guarded multi-page application runner.
2. A richer candidate profile and application packet for repeated factual fields.
3. Structured repeatable education and experience mapping.
4. Reachable, scoped, length-aware approved answers with a corrected authorization
   gate.
5. Page-batched, diff-aware execution and portal-aware transition waits.
6. PII-free timing and coverage instrumentation with a repeatable benchmark harness.
7. Backwards-compatible support for existing local profile and answer-bank files.
8. Characterization and differential regression tests proving existing supported
   behavior is unchanged apart from measured latency and additive telemetry.

### Excluded

- Automatic account creation, password entry or storage, OTP/email verification,
  CAPTCHA handling, terms acceptance, declarations, signatures, and final submit.
- Editing the user's CV or other source documents.
- A production Oracle or generic cross-portal filler in this release.
- Fuzzy option selection or model-generated guesses for factual fields.
- Direct HTTP form submission or bypassing the visible portal UI.
- Using the user's live Bank of America application as an automated mutation test.

## 4. Approaches Considered

### A. TAL.net first, reusable application-run contracts — selected

Implement the audited TAL.net flow first behind a platform-neutral application-run
interface. This produces the fastest measurable user benefit while leaving clear
extension points for Workday and Oracle.

### B. Universal cross-portal engine immediately — deferred

A fully generic engine would reduce later duplication, but custom controls,
repeatable sections, validation behavior, and transition semantics differ too much
between portals. Starting generic would delay the first reliable 20% improvement and
increase the chance of unsafe abstractions.

### C. Browser macro or fixed selector script — rejected

A fixed macro would be quick to build but would be brittle under option, layout, and
page-order changes. It would also lack the project's mapping, policy, verification,
and audit guarantees.

## 5. Architecture

### 5.1 Preserve the reconnaissance boundary

The existing `TalNetAdapter` remains a read-only flow/reconnaissance adapter. Its
blocked-action policy is not weakened. Drafting is implemented in a new `talnet/`
module family so reconnaissance and controlled mutation remain separately testable.

Shared abstractions are extracted only after characterization tests cover the current
behavior. The first refactor step must be behavior-preserving: move or wrap existing
logic without changing normalized outputs. TAL.net support is then added through new
implementations of those contracts rather than conditional branches inside existing
Workday behavior.

### 5.2 Platform application adapter

Introduce a platform-neutral contract used by the application runner:

```ts
interface PlatformApplicationAdapter {
  readonly platform: Platform
  scanPage(page: Page): Promise<ApplicationPageScan>
  guardPage(scan: ApplicationPageScan): ApplicationPageGuard
  mapFields(input: MapApplicationFieldsInput): MappedApplicationField[]
  identifyTransition(scan: ApplicationPageScan): IntermediateTransition | null
  waitForTransition(page: Page, previous: PageSignature): Promise<ApplicationPageScan>
}
```

The interface exposes observation, policy, mapping, and transition identification.
It does not expose declaration or final-submit operations.

### 5.3 Application-run state machine

Add a persistent `ApplicationRun` over one authenticated browser session:

```text
OPEN_CHECKPOINT
  -> SCAN
  -> GUARD
  -> BUILD_PLAN
  -> WAIT_FOR_PAGE_APPROVAL
  -> EXECUTE_BATCH
  -> VERIFY_BATCH
  -> WAIT_FOR_INTERMEDIATE_SAVE_APPROVAL
  -> SAVE_AND_CONTINUE
  -> WAIT_FOR_NEW_PAGE_SIGNATURE
  -> SCAN
```

Terminal and pause states are:

- `PAUSED_LOGIN_OR_SESSION_EXPIRED`
- `PAUSED_EMAIL_VERIFICATION_OR_OTP`
- `PAUSED_CAPTCHA`
- `PAUSED_UNKNOWN_FIELD_OR_OPTION`
- `PAUSED_UPLOAD_APPROVAL`
- `PAUSED_VALIDATION_ERROR`
- `PAUSED_DECLARATION`
- `PAUSED_FINAL_SUBMIT`
- `COMPLETE_AT_REVIEW`
- `FAILED_CLOSED`

The runner may cross an intermediate page boundary only when:

1. the page is a known non-final TAL.net section;
2. all planned field actions were verified or explicitly left manual;
3. the transition control matches the platform allowlist;
4. the user has approved the imminent page save/representational action;
5. the before-transition guard passes; and
6. the next page produces a different valid signature within bounded time.

Declaration and final-submit controls are not represented as executable transition
types. They can only produce pause states.

### 5.4 TAL.net page model

`TalNetDraftAdapter` models each page using:

- e-form identifier;
- page number and section title;
- stable TAL `datafield_*` identifier or native form name;
- repeat-instance ordinal;
- control type and exact visible option labels;
- required state, current value, validation state, and visibility;
- page navigation controls; and
- guard signals for login, verification, CAPTCHA, declaration, and final submit.

`PageSignature` is a hash of the e-form ID, page number, section title, visible stable
field IDs, control types, and option labels. Current values and PII are excluded.

### 5.5 Stable field resolution

Field identity is resolved in this order:

1. known stable TAL field ID plus page section and instance;
2. native `name` or DOM ID;
3. ARIA label and role;
4. exact normalized visible label;
5. manual review.

Mappings use a versioned portal schema. A cached mapping is reused only when its page
signature matches. Cache drift invalidates the mapping and returns to inspect-only
planning.

Options use exact labels or an explicit reviewed alias table. Fuzzy matching is not
allowed. Custom comboboxes are handled by a dedicated TAL control adapter that
selects and verifies the rendered value.

## 6. Candidate Data and Answer Model

### 6.1 Backwards-compatible profile expansion

Add optional structured fields first, retain the current fields during migration,
and render one canonical application packet from either representation.

New candidate facts include:

- title and explicit given/family name components;
- secondary email;
- phone country code, national number, and device type;
- address line 2, city, region, and campus-address status;
- native and fluent languages with read/write proficiency;
- referral source;
- confirmed recurring factual disclosures, each with provenance and confirmation
  timestamp; and
- an application-event ledger used to derive prior-application answers after a
  confirmed submission.

New education facts include:

- location of study;
- start and expected/actual completion month and year;
- degree status;
- result scale and denominator;
- previous-education status; and
- stable record identity for repeated education sections.

Experiences remain structured through the packet instead of being reduced to display
strings. Every selected experience carries a stable record ID, employer or
organization, role, type, start/end values, location, and approved portal-length
description.

### 6.2 Reusable factual disclosures

Recurring yes/no answers are typed fields rather than free-text answer-bank entries.
Company-specific questions use an explicit company scope. Regulatory, legal, salary,
conflict, declaration, and signature questions remain manual unless separately
designed and approved in a future scope.

### 6.3 Answer bank

Answer entries gain:

- question aliases;
- company, role-bucket, track, and portal scope;
- optional maximum word/character constraints;
- approved length variants; and
- provenance and approval timestamp.

An answer is executable only when all three conditions are true:

```text
status == approved
requires_review == false
allow_auto_use_later_phase == true
```

Both answer selection and plan building enforce the same typed predicate. The plan
must not infer permission from a note or from only two of the three fields.

Language proficiency moves into the candidate profile. The existing
`language_fluency` answer-bank entry is migrated into structured profile data after
the schema exists.

### 6.4 Demographic consent and document blockers

Demographic auto-fill permission is carried as a structured boolean on the packet and
mapped action. It is never reconstructed from a note with a regular expression.
Exact-option matching remains mandatory.

Unresolved items gain structured capability, document-key, bucket/job scope,
provenance, and resolution state. Document readiness is evaluated for the selected CV
rather than globally blocking every route because one unrelated document is stale.

## 7. Planning and Execution

### 7.1 Two-stage run

Every new page uses two stages:

1. **Inspect and plan:** scan, guard, map, diff, and render a redacted page plan.
2. **Approved execution:** verify the page signature is unchanged, obtain the required
   imminent-action approval, execute only allowed actions, and verify results.

A plan contains immutable field IDs, expected control types, non-sensitive value-state
tokens such as `empty`, `nonempty`, or `checked`, exact option targets, policy
categories, source paths, and the page signature. Sensitive current values and their
hashes are not persisted because low-entropy personal values can be guessed from a
hash. The plan never contains passwords, OTPs, or declaration/final-submit actions.

### 7.2 Dependency-aware batching

Within a stable page:

1. skip fields whose normalized current value already equals the proposed value;
2. execute controlling yes/no or select fields first;
3. rescan once if those controls reveal or hide conditional fields;
4. fill independent deterministic fields with bounded sequential actions;
5. verify the resulting values in one bounded DOM read; and
6. replan only after a conditional reveal, validation failure, or signature change.

The implementation does not perform an expensive full-page body-text scan before
every independent field. A lightweight danger check runs between actions and the full
guard is re-evaluated before every page save, upload, and state transition.

### 7.3 Intermediate transitions

The transition module supports only an allowlisted `save_and_continue` action on a
known non-final page. It waits on a race between:

- URL or page-number change;
- section-heading and page-signature change;
- validation error appearance;
- session-expiry/login appearance;
- CAPTCHA or verification appearance; and
- a bounded timeout.

Generic sleeps and unconditional `networkidle` waits are not used as the success
signal. If a validation error appears, the runner records its label without PII,
leaves the page open, and pauses.

### 7.4 Resume support

After every page, write a local gitignored checkpoint containing the page signature,
redacted plan, verified action outcomes, timing spans, and next pause reason. On
resume, rescan and diff against live values. Never replay an action solely because it
was present in the previous checkpoint.

## 8. Approval and Safety Policy

The following actions require an explicit imminent-action approval gate:

- typing or selecting sensitive profile data into a third-party form;
- saving an application page;
- uploading the selected CV; and
- any other representational action allowed by a future policy.

The approval prompt names the destination, data categories, page, and next action.
Approval is scoped to that imminent page batch and cannot authorize declarations or
final submission.

The following always pause for the user and have no executable action type:

- account creation;
- password change or password-manager save;
- email verification and OTP;
- CAPTCHA;
- legal terms outside ordinary account-creation consent;
- declaration, certification, or signature;
- final submission; and
- unknown regulatory or conflict disclosures.

CV upload remains a separate gated action. It requires document readiness for the
selected file, exact destination confirmation, an unchanged page signature, and
post-upload filename verification.

## 9. Error Handling

- **Unknown field:** record as manual review and continue planning other fields.
- **Unknown option:** do not guess; leave untouched and pause if required.
- **Ambiguous repeated record:** do not use position alone; pause for record mapping.
- **Page drift:** invalidate the plan before mutation and return to inspect-only.
- **Action failure:** stop the current batch, capture a bounded diagnostic, and leave
  the browser on the page.
- **Validation error:** report the affected field label and error category without its
  value; do not loop retries.
- **Session expiry/login/verification/CAPTCHA:** pause immediately.
- **Partial completion:** persist verified outcomes and resume through live diffing.
- **Declaration/final-submit detection:** enter a terminal pause state.

## 10. Telemetry and Benchmarking

Emit PII-free monotonic events:

- `form_active_start`
- `scan_start` / `scan_end`
- `plan_ready`
- `approval_requested` / `approval_received`
- `guard_start` / `guard_end`
- `field_action_attempt` / `done` / `failed` / `skipped_equal`
- `conditional_rescan_start` / `end`
- `manual_pause` / `resume`
- `page_ready_for_continue`
- `transition_start` / `end`
- `run_end`

Record commit SHA, browser/version, OS, headed mode, scenario ID, and fixture hash.
Never record field values, page body text, credentials, tokens, or document contents in
benchmark output.

The benchmark suite runs five warmups and at least 30 alternating paired baseline and
candidate samples per fixture. User-facing validation starts with 12 paired synthetic
multi-page sessions and expands if the confidence interval is inconclusive. The suite
reports p50, p90, seconds per required field, automated coverage, manual interactions,
wrong-field mutations, guard violations, and candidate failure rate.

## 11. Test Strategy

Implementation follows test-driven phases. Production logic is not written before a
failing test captures the required behavior.

### Characterization and differential tests

Before optimizing or extracting shared code, record normalized golden results for all
current fixtures and CLIs. Each phase runs a baseline-versus-candidate differential
suite that compares:

- normalized scans and page kinds;
- mapped keys, values, confidence, and policy categories;
- planned, blocked, manual-review, and never-auto actions;
- guard decisions and pause/failure categories;
- verified field outcomes and final fixture DOM state;
- CLI exit codes and redacted artifact schemas; and
- redaction of emails, phone numbers, addresses, documents, and credentials.

The differential comparison permits only runtime/timestamp differences and additive
versioned telemetry. Any other difference is a failing regression that blocks the
phase regardless of benchmark improvement.

### Unit tests

- answer authorization predicate requires all three permission fields;
- demographic permission is structured and exact-match only;
- backwards-compatible profile migrations and validation;
- application-event ledger derivation;
- selected-document blocker scoping;
- TAL page signature and stable field identity;
- exact option and reviewed-alias resolution;
- repeated education/experience mapping;
- current-value diff and dependency ordering;
- declaration/final controls have no executable action type; and
- PII-free telemetry serialization.

### Fixture integration tests

Create synthetic TAL.net fixtures corresponding to the ten audited section types:

1. Personal Details
2. Additional Information
3. University Education
4. Employment / Extra Curricular Experience
5. Business Specific Questions
6. Languages
7. Attach Documents
8. Referral Source
9. Inclusion
10. Declaration

Fixtures contain dummy identities and documents only. Tests cover conditional fields,
custom comboboxes, repeated records, validation errors, session expiry, CAPTCHA,
unknown options, upload gating, intermediate transitions, and declaration/final
pauses.

### Browser integration tests

Run the real scan-map-plan-execute-verify path against local served fixtures in a
headed browser. Verify that intermediate navigation works, already-correct fields are
skipped, conditional fields replan once, and no final action is possible.

### Regression suite

The existing 28 test files and 276 tests, TypeScript typecheck, profile validation,
document readiness checks, and static safety tests remain required. New TAL modules
receive equivalent static safety assertions.

Every phase must pass the full suite and the differential suite before the next phase
starts. Performance benchmarks run only after correctness passes, so a faster failing
or behaviorally different candidate cannot be accepted.

## 12. Implementation Phases

### Phase 0 — Safety prerequisites

- Capture characterization fixtures and normalized golden results for every current
  supported workflow before refactoring shared code.
- Centralize the answer execution predicate and add red/green regression tests.
- Replace demographic note parsing with structured permission.
- Define shared application action and pause types.
- Add static assertions that declaration and final submit cannot be executed.

### Phase 1 — Candidate data and packets

- Add backwards-compatible structured candidate, phone, address, language,
  education, application-event, blocker-scope, and answer-variant schemas.
- Migrate example and test fixtures.
- Preserve structured experiences in application packets.
- Add portal-specific completeness reporting.

### Phase 2 — TAL.net inspection and mapping

- Add synthetic TAL fixtures.
- Implement page scanning, stable identities, page signatures, guards, option
  extraction, and exact mappings.
- Produce inspect-only redacted plans for all ten section types.

### Phase 3 — Diff-aware page execution

- Implement current-value diffing, dependency ordering, TAL text/select/checkbox and
  custom-combobox actions, batch verification, and checkpoint persistence.
- Keep navigation disabled until all page execution tests pass.

### Phase 4 — Guarded multi-page runner

- Add the persistent application-run state machine.
- Add per-page approval gates and allowlisted intermediate save-and-continue.
- Add portal-aware transition waits and resume support.
- Stop at upload, login/verification/CAPTCHA, declaration, and final-submit states.

### Phase 5 — Upload and approved answer paths

- Add separately gated TAL CV upload with selected-document readiness and filename
  verification.
- Enable approved, scoped answer variants only through the corrected authorization
  predicate.
- Keep unsupported or review-gated answers manual.

### Phase 6 — Performance proof and controlled live rollout

- Add PII-free benchmark spans and paired A/B reporting.
- Meet fixture correctness and safety gates.
- Run live TAL inspect-only against a non-final saved application page.
- Run controlled page execution only after the user reviews the generated page plan
  and approves the imminent action.
- Stop at Declaration and report measured results.

## 13. Expected File Boundaries

New modules are expected under:

```text
src/application/
  ApplicationRun.ts
  approval.ts
  telemetry.ts
  types.ts

src/talnet/
  TalNetDraftAdapter.ts
  TalNetFieldScanner.ts
  TalNetFieldMapper.ts
  TalNetFieldFiller.ts
  TalNetPageGuards.ts
  TalNetTransitions.ts
  TalNetResumeUpload.ts
  types.ts
```

Existing Workday modules continue to operate while shared packet, approval, and
telemetry contracts are introduced incrementally. Large portal-specific selectors and
mappings stay out of the shared application runner.

## 14. Rollout and Compatibility

- New profile fields are optional during migration; existing local files continue to
  parse.
- Example and fixture profiles never contain real PII.
- Existing Workday CLI behavior remains unchanged until explicitly migrated.
- TAL execution defaults to inspect-only.
- TAL mutation requires explicit `tal_net` provider selection and cannot be reached
  through an existing default command or provider.
- Each mutating capability requires its own explicit flag and runtime approval.
- Live rollout begins with one page, then the four dense sections, then the remaining
  non-final sections.
- Any safety regression disables TAL mutation while retaining inspect-only output.
- Each rollout step has an immediate feature-flag rollback that disables the new TAL
  mutation path without reverting profile data or affecting existing providers.
- An optimization is retained only when differential tests show behavioral
  equivalence and paired benchmarks show no p50 or p90 regression. Otherwise the
  existing implementation remains active.

## 15. Definition of Done

The upgrade is complete when:

1. all seven phases above are implemented with tests;
2. all existing and new tests and typechecking pass;
3. the ten-section synthetic TAL flow reaches Declaration with no declaration or
   final-submit action available;
4. the four dense sections are mapped and executed with exact-value verification;
5. unknown and guarded scenarios fail closed;
6. the paired benchmark satisfies the 20% acceptance rule and safety guardrails; and
7. the user receives a redacted run report showing time, coverage, manual checkpoints,
   and the unsubmitted final state.
8. every existing supported workflow is behaviorally equivalent to its characterized
   baseline, with differences limited to lower latency and additive versioned
   telemetry.
