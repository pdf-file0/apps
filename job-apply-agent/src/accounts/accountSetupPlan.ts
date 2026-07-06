import type { DocumentReadiness } from '../documents/types'
import type { JobRecord } from '../intelligence/types'
import { normalizeText } from '../intelligence/normalizeText'
import type { AccountSetupPlan, AccountStatusFile, PortalKey } from './types'

/**
 * The canonical do-not list. Every plan carries it verbatim so a human (or a
 * later phase reading the plan) can never miss the boundary.
 */
export const NEVER_ACTIONS: readonly string[] = [
  'create an account automatically',
  'click Continue, Next, Submit, Certify, Apply Manually, Autofill with Resume, Create Account, Sign In, Register, or Login',
  'type or store passwords',
  'store OTPs, cookies, session tokens, or any credentials',
  'upload a CV or any other document',
  'fill application form fields',
  'answer application questions',
  'accept terms or certify anything',
  'bypass or solve captchas',
]

export function portalFromHint(platformHint: string | undefined): PortalKey {
  const hint = (platformHint ?? '').toLowerCase()
  if (hint.includes('workday')) return 'workday'
  if (hint.includes('oracle')) return 'oracle_recruiting'
  if (hint.includes('impress')) return 'impress_ai'
  if (hint.includes('tal.net') || hint.includes('talnet') || hint.includes('campus')) return 'talnet'
  return 'unknown'
}

export function companyKey(company: string): string {
  return normalizeText(company).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export function accountKeyFor(company: string, portal: PortalKey): string {
  return `${companyKey(company)}_${portal}`
}

function portalSteps(portal: PortalKey, emailLabel: string): string[] {
  switch (portal) {
    case 'workday':
      return [
        'On the Workday job page, click "Apply" yourself when you are ready.',
        'If Workday offers "Autofill with Resume" vs "Apply Manually", the choice is yours — the agent never picks.',
        `Choose "Create Account" yourself and register with ${emailLabel}.`,
      ]
    case 'oracle_recruiting':
      return [
        'This role runs on Oracle Recruiting (higher.gs.com). Open the role and click "Apply" yourself.',
        `Create your candidate login yourself, using ${emailLabel}.`,
      ]
    case 'impress_ai':
      return [
        'This flow may run through an impress.ai chatbot. Start the chat yourself if you choose to.',
        `If it offers to create an account, do it yourself with ${emailLabel}.`,
        'Answer chatbot questions yourself — the agent never answers for you.',
      ]
    case 'talnet':
      return [
        'This careers site runs on TAL.net. Click "Apply" / "Register" yourself.',
        `Register with ${emailLabel}.`,
      ]
    case 'unknown':
      return [
        'Platform unknown — proceed carefully; every click is yours.',
        `If you create an account, use ${emailLabel}.`,
      ]
  }
}

export interface BuildAccountSetupPlanInput {
  job: JobRecord
  statusFile?: AccountStatusFile
  documentReadiness?: DocumentReadiness
  /** Used when no account record exists yet (e.g. the profile's application email). */
  fallbackEmail?: string
  /** Explicit checkpoint URL; wins over the account record and the job URL. */
  overrideUrl?: string
}

/**
 * Build the human-in-the-loop setup plan for one job's portal. Pure — no
 * browser, no filesystem. The runner and CLI only render/execute this plan.
 */
export function buildAccountSetupPlan(input: BuildAccountSetupPlanInput): AccountSetupPlan {
  const { job, documentReadiness } = input
  const portal = portalFromHint(job.platformHint)
  const accountKey = accountKeyFor(job.company, portal)
  const account = input.statusFile?.accounts[accountKey]
  const accountEmail = account?.email ?? input.fallbackEmail ?? null
  const emailLabel = accountEmail ?? 'your preferred application email'

  let checkpointUrl: string
  let checkpointSource: AccountSetupPlan['checkpointSource']
  if (input.overrideUrl) {
    checkpointUrl = input.overrideUrl
    checkpointSource = 'override'
  } else if (account?.entry_url) {
    checkpointUrl = account.entry_url
    checkpointSource = 'account_entry_url'
  } else {
    checkpointUrl = job.url
    checkpointSource = 'job_url'
  }

  // Conservative defaults: with no readiness report, treat NS as unresolved
  // and CV upload as blocked.
  const nsUnresolved = documentReadiness
    ? documentReadiness.manualReviewItems.some((item) => item.code === 'national_service_status_unknown')
    : true
  const cvBlocked = documentReadiness ? !documentReadiness.ready_for_cv_upload : true

  const humanSteps = [
    ...portalSteps(portal, emailLabel),
    'Create the password yourself in the browser — the agent never sees, types, or stores it.',
    'Complete any email verification or OTP yourself; never paste the code into this terminal.',
    'Read any terms and conditions yourself before accepting — the agent never accepts terms.',
    'Complete any captcha yourself — the agent never bypasses captchas.',
    ...(nsUnresolved
      ? ['If the portal asks about National Service status, STOP — the status is unresolved.']
      : []),
    'Stop once the account exists and you are logged in — do NOT start the application form.',
    ...(cvBlocked
      ? [
          'Do NOT upload any CV — document blockers are unresolved (run: npm run documents:readiness).',
        ]
      : []),
  ]

  const agentActions = [
    'launch a headed browser window using the local .browser-profile (gitignored)',
    `navigate to the checkpoint URL (source: ${checkpointSource})`,
    'observe the page read-only — no clicking, no typing, no filling',
    'pause and wait for you to complete every account step manually',
    'optionally re-observe the page after you confirm, to record account status locally (status only — never credentials)',
  ]

  const documentWarnings = documentReadiness
    ? documentReadiness.blockers.map((b) => `[${b.code}] ${b.message}`)
    : ['document readiness not evaluated — treat CV upload as blocked']

  return {
    jobId: job.id,
    company: job.company,
    portal,
    accountKey,
    accountEmail,
    currentStatus: account?.status ?? 'unknown',
    checkpointUrl,
    checkpointSource,
    agentActions,
    humanSteps,
    neverActions: [...NEVER_ACTIONS],
    documentWarnings,
    pauseReason:
      'Account creation, passwords, OTP codes, terms, and captchas are strictly human-only actions.',
  }
}
