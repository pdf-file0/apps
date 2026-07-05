# job-apply-agent

A local assistant that classifies job postings into CV buckets, selects the
right CV for each application, and produces a deterministic run summary.

**Phase 1 (this repo state) is classification-only.** It does **not**:

- ❌ apply to any job or click any submit button
- ❌ create accounts on any careers portal
- ❌ upload CVs or any other document
- ❌ use browser automation or make network requests (all input is local fixture text)
- ❌ store passwords, OTPs, cookies, or credentials anywhere in the repo
- ❌ print candidate PII (emails, phone numbers) in console output

What it **does**:

- ✅ validates all config files with strict Zod schemas
- ✅ classifies each job into a CV bucket via deterministic keyword scoring
- ✅ selects the matching CV (or flags manual review) per `config/cv_routing.yaml`
- ✅ records confidence, matched terms, rationale, and warnings per job
- ✅ prints a readable table and writes `runs/latest-classification-summary.json`

## Phase roadmap

| Phase | Scope |
| --- | --- |
| 1 | Offline classification, CV routing, config validation, CLI summary. Fully testable with no network or browser. |
| 2 | Browser reconnaissance / dry run: open each job URL, capture evidence, classify from live text, detect the ATS platform, optionally click ONE safe job-page-level Apply CTA, and stop before any login/account/form. |
| **3 (current)** | Offline candidate profile, experience bank, answer bank, field automation policy, and per-job application packets for human review. No browser, no forms, no uploads. |
| 4+ | Assisted form filling with a human confirming every submission. Auto-submit stays off by design. |

## Safety rules

1. Never submit applications by default — `config/submission_policy.yaml`
   hard-locks `autoSubmit: false` (and friends) as **Zod literals**: flipping a
   flag makes config validation fail rather than enabling the behavior.
2. Never create accounts, upload CVs, or click final submit in Phase 1.
3. Never store passwords, OTPs, cookies, or credentials in repo files
   (`.env` is gitignored; `.env.example` holds empty placeholders only).
4. Ambiguous or track-dependent roles are routed to `manual_review` /
   `track_dependent` and flagged `requiresManualReview: true` — a human decides.
5. Roles that are not summer internships (e.g. "New Analyst") get an explicit
   `not_summer_internship` warning.
6. Console output prints warning **codes** only where messages could contain
   PII; full text lives in the local JSON summary.

## Commands

```bash
npm install                                  # one-time setup
npm test                                     # vitest unit + config-validation tests (all offline)
npm run typecheck                            # tsc --noEmit
npm run classify -- --jobs config/jobs.yaml  # classify + write runs/latest-classification-summary.json
npm run recon -- --jobs config/jobs.yaml     # Phase 2 live reconnaissance (see below)
npm run recon:fixture -- --jobs config/jobs.yaml  # offline recon over local test pages
```

Run everything from the repo root (`job-apply-agent/`).

## Phase 2: browser reconnaissance (dry run)

Reconnaissance opens each job URL in your locally installed Chrome (via
`playwright-core`, channel `chrome`; falls back to Edge — **no browser
downloads**), then for each job:

1. captures a screenshot of the job page (`01-job-page.png`),
2. extracts the visible page text and re-runs the Phase 1 classifier on it,
3. selects the CV via the same routing as `npm run classify`,
4. detects the application platform (Workday / TAL.net / Oracle Recruiting /
   Impress.ai / Greenhouse / Lever / LinkedIn / unknown) with evidence,
5. scans and logs every clickable CTA on the page,
6. **optionally** — only with `--click-apply` — clicks at most ONE
   job-page-level Apply CTA whose label exactly matches the safe list
   (`Apply`, `Apply now`, `Start application`, `Apply for this job`,
   `Apply to this job`), then screenshots, re-detects the platform, and
   **stops immediately**.

### What Phase 2 does NOT do

There is no code path that fills a field, uploads a document, creates an
account, enters a password, handles an OTP, solves a captcha, accepts terms,
or clicks anything submit-like (`Submit`, `Continue`, `Next`, `Save and
continue`, `Create account`, `Sign in`, `Register`, `Accept`, `I agree`,
`Certify` are all on a hard blocklist). If the page is detected as a login,
account-creation, captcha, or application-form page — before *or* after the
Apply click — reconnaissance records the state and stops. When unsure, it
does not click and records `manual_review_required`.

Cookie banners: handling is **decline-only**. If a consent dialog blocks the
page, recon clicks an exact-match decline label (`Reject All`, `Decline`,
`Necessary cookies only`, …) and logs it. It never clicks `Accept All`,
`I agree`, or `Manage Cookies`, and never accepts any terms.

### Running reconnaissance

```bash
# all jobs, live browser, no clicking (default):
npm run recon -- --jobs config/jobs.yaml --headed

# one job:
npm run recon -- --jobs config/jobs.yaml --headed --job barclays_research_2027_sg

# first N jobs:
npm run recon -- --jobs config/jobs.yaml --headed --limit 1

# explicitly allow the single safe Apply-CTA click:
npm run recon -- --jobs config/jobs.yaml --headed --job barclays_research_2027_sg --click-apply

# fully offline (parses test-pages/*.html, no browser, no network):
npm run recon -- --jobs config/jobs.yaml --provider fixture
```

`--click-apply` is **off by default**; `--no-click-apply` forces it off.
Headed mode is the default so you can watch; `--headless` hides the window.
Live recon uses an isolated profile in `.browser-profile/` (gitignored).

### Where output goes

Each run creates `runs/<timestamp>-recon/` containing `summary.json`,
`action-log.jsonl`, and one folder per job with screenshots
(`01-job-page.png`, `02-after-apply-click.png`), `extracted-job-page.txt`,
`job-page-metadata.json`, `live-classification.json`,
`platform-detection.json`, `cta-candidates.json`, and a per-job
`action-log.jsonl`. The latest summary is also copied to
`runs/latest-recon-summary.json`. Console output never contains candidate
PII; local JSON contains job URLs/titles/platform/classification only —
never CV contents, passwords, cookies, or credentials.

### Interpreting manualReviewRequired

A job is flagged `manualReviewRequired: true` when any of these hold: live
classification is `manual_review` or `track_dependent`; live classification
disagrees with the `expectedBucket` in `config/jobs.yaml`; no live text could
be extracted; only unsafe/ambiguous apply CTAs exist; a captcha, login,
account-creation, or application form was detected; navigation timed out or
errored. Those jobs need a human decision before anything else happens.

## Phase 3: candidate profile & application packets (offline)

Phase 3 models everything a future assisted form-fill needs — entirely
offline, with no browser, no network, no uploads, and no submissions.

### Profile & answer bank privacy

- **Real data lives only in gitignored local files**:
  `profiles/candidate_profile.local.yaml` and `profiles/answer_bank.local.yaml`
  (`profiles/*.local.yaml` is in `.gitignore`). Generated `packets/` are also
  gitignored. This keeps PII, draft answers, and application strategy out of
  git history entirely.
- **Committed counterparts use dummy data**: `profiles/*.example.yaml` and
  `tests/fixtures/*` — copy an example to `*.local.yaml` to get started.
- The profile schema **hard-locks the risky policies as literals**:
  `password_creation: manual`, `otp_email_verification: manual`,
  `captcha: manual`, `account_terms: manual_review`,
  `final_submit: explicit_approval_only`. Any other value fails validation.
- Every answer-bank entry is a **draft** (`requires_review: true`,
  `allow_auto_use_later_phase: false`); a draft can never be marked
  auto-usable, and behavioural stories additionally carry
  `unapproved_story_requires_user_confirmation: true`.

### Commands

```bash
npm run profile:validate -- --profile profiles/candidate_profile.local.yaml
npm run profile:summary  -- --profile profiles/candidate_profile.local.yaml   # redacted output only

# one job:
npm run packet -- --job barclays_research_2027_sg --profile profiles/candidate_profile.local.yaml --answers profiles/answer_bank.local.yaml
# GIC with a chosen track:
npm run packet -- --job gic_internship_programme --selected-track public_equities --profile profiles/candidate_profile.local.yaml --answers profiles/answer_bank.local.yaml
# everything:
npm run packet -- --all --profile profiles/candidate_profile.local.yaml --answers profiles/answer_bank.local.yaml
```

Console output is **redacted by default** (masked email/phone, no address,
no DOB); pass `--show-sensitive` to print full values. Full-fidelity JSON and
Markdown packets are written to `packets/<timestamp>-packet/<jobId>/`
(`application-packet.json`, `.redacted.json`, `.md`) plus run-level
`summary.json` / `summary.redacted.json` — all local and gitignored.

### Field automation policy

Every form field/question is classified into one of five categories
(`src/fieldPolicy/`): `safe_auto_fill` (name, email, education …),
`auto_if_confirmed` (work authorization, sponsorship, prior applications,
availability), `demographic_exact_match_only` (gender, race, disability … —
filled later only when a portal option exactly matches the profile value),
`manual_review` (salary, essays, cover letters, National Service status,
declarations), and `never_auto` (password, OTP, captcha, accept-terms,
certify, final submit, e-signature). Unknown fields default to
`manual_review` — the system never guesses that a field is safe.

### Readiness flags

- `ready_for_dry_form_fill` — profile has the required factual fields; a
  future dry run could stage values (still no submission).
- `ready_for_cv_upload` — false while blocking document items are unresolved
  (stale Temasek end date, CV email mismatch, private-CV deal-count
  corrections).
- `ready_for_final_submit` — **always false in Phase 3**, structurally.

`manualReviewRequired` is true for track-dependent jobs without a selected
track, manual-review classifications, and non-summer-internship roles
(e.g. GS New Analyst).

### What Phase 3 does NOT do

No browser automation, no live website calls, no account creation, no form
filling, no CV uploads, no Apply clicks, no submissions, and no credentials
of any kind stored anywhere.

### How Phase 2 prepares for Phase 3

Phase 2 produces exactly the evidence Phase 3 (assisted form filling with
per-submission human confirmation) will need: the confirmed ATS platform per
job, the post-Apply entry URL, CTA inventories, live-text classification and
CV choice, and screenshots to review. Phase 3 will build on the same
provider/target interfaces — with every submission gated on explicit human
confirmation, and auto-submit permanently off.

## How classification works

`classifyRole(inputText, jobMetadata?)` in `src/intelligence/classifyRole.ts`:

1. Normalizes the text (case, unicode dashes/quotes, whitespace).
2. Counts distinct keyword hits against three deterministic term lists:
   - **public_equities_markets_research** — research, equities, FICC, FX,
     rates, commodities, sales and trading, macro, quant strats, …
   - **private_markets_ibd_deals** — investment banking, M&A, ECM/DCM,
     valuation, due diligence, private equity, infrastructure, real estate, …
   - **track-dependent signals** — "multiple tracks", "public and private
     markets", "investment professionals", "corporate services", …
3. Applies rules in order:
   - ≥2 track signals **and** hits on both term lists → `track_dependent` (medium confidence).
   - Both scores high (≥4) and close (margin ≤2) → ambiguous: the configured
     `expectedBucket` (known job ids) breaks the tie at medium confidence,
     otherwise `manual_review`.
   - Otherwise the higher score wins; weak evidence drops to `manual_review`.
4. Adds warnings: `not_summer_internship` (New Analyst roles),
   `goldman_sachs_application_limit` (up to 4 business/location combinations
   per recruiting year), `track_dependent_cv`, `ambiguous_classification`, etc.

## How CV routing works

`selectCv(classification, cvRoutingConfig)` maps the bucket to an entry in
`config/cv_routing.yaml`:

| Bucket | CV |
| --- | --- |
| `public_equities_markets_research` | OMERS / public equities CV (`documents/Samuel_Lim_CV_Public_Equities_Markets.pdf`) |
| `private_markets_ibd_deals` | Temasek-expanded / private markets CV (`documents/Samuel_Lim_CV_Private_Markets_IBD.pdf`) |
| `track_dependent` | none — manual until the selected track is known |
| `manual_review` | none — a human picks |

`requiresManualReview` is `true` for `track_dependent`, `manual_review`, and
any low-confidence classification. The PDF paths are placeholders; Phase 1
never reads or modifies the documents.

For multi-track applications (GIC), `trackRouting` in `config/jobs.yaml`
records which bucket each track resolves to once the track is chosen.

## How to add a new job

1. Save the job-description text as `tests/fixtures/<job_id>.txt`
   (plain text; Phase 1 has no fetching).
2. Append an entry to `config/jobs.yaml`:

   ```yaml
   - id: my_new_job
     url: https://example.com/job/123
     company: Example Corp
     platformHint: Workday          # optional
     fixture: tests/fixtures/my_new_job.txt
     expectedBucket: private_markets_ibd_deals   # optional tie-break only
     notes: Anything useful for a human reviewer # optional
   ```

3. Run `npm run classify -- --jobs config/jobs.yaml` and check the table.
4. Optionally add a case to `tests/classifyRole.test.ts` to pin the expected
   bucket/confidence/warnings.

## Config files

| File | Purpose |
| --- | --- |
| `config/jobs.yaml` | Known jobs: id, URL, company, fixture path, optional expected bucket and track routing. |
| `config/cv_routing.yaml` | CV definitions and bucket→CV routes. |
| `config/candidate_profile.schema.yaml` | Candidate profile field schema (Phase 2) plus **document warnings**: CV email mismatch, stale Temasek end date, Temasek deal-count corrections. Phase 1 records these; it never edits PDFs. |
| `config/submission_policy.yaml` | Hard safety gate. All risky actions locked off via schema literals. |

## Known candidate document warnings

Recorded in `config/candidate_profile.schema.yaml` and echoed into every run
summary (fix these manually **before** any future upload):

- `cv_email_mismatch` — CVs may show the old `@business.smu.edu.sg` email; the
  application email should be the `@smu.edu.sg` one.
- `temasek_end_date_stale` — Temasek role has ended; CVs may still say
  "Jan 2026 – Present".
- `temasek_deal_counts_incorrect` — private-markets CV should state 6 live
  investment deals, 4 direct investments, 3 fund investments, and the US$500m
  investment into a US$5b Series H round for the autonomous defence company.

## Output

`npm run classify` prints a table (job id, bucket, selected CV, confidence,
warning codes) and writes `runs/latest-classification-summary.json` — a
deterministic JSON document (no timestamps) validated against
`RunSummarySchema`, containing per-job classification, CV selection, track
routing, and the candidate document warnings.
