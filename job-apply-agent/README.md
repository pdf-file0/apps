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
| **1 (current)** | Offline classification, CV routing, config validation, CLI summary. Fully testable with no network or browser. |
| 2 | Job-content fetching (Firecrawl provider) and Playwright-based form *scaffolding* — still no account creation and no final submit without explicit human confirmation. |
| 3+ | Assisted form filling with a human confirming every submission. Auto-submit stays off by design. |

The Phase-2 provider seam already exists: `JobContentProvider` in
`src/intelligence/types.ts`. Phase 1 ships no network implementation of it.

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
npm test                                     # vitest unit + config-validation tests
npm run typecheck                            # tsc --noEmit
npm run classify -- --jobs config/jobs.yaml  # classify + write runs/latest-classification-summary.json
```

Run everything from the repo root (`job-apply-agent/`).

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
