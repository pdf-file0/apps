import { normalizeLabel, SAFE_APPLY_LABELS } from '../reconnaissance/findApplyCta'
import type { EntryOption, EntryOptionKind, EntryOptionSafety, PageSnapshot } from './types'

interface LabelRule {
  kind: EntryOptionKind
  safety: EntryOptionSafety
  labels?: string[]
  pattern?: RegExp
  reason: string
}

// Checked in order; first match wins. never_auto before blocked before benign.
const RULES: LabelRule[] = [
  {
    kind: 'submit',
    safety: 'never_auto',
    labels: ['submit', 'submit application', 'complete application'],
    reason: 'submission control — human only, in every phase',
  },
  {
    kind: 'accept_terms',
    safety: 'never_auto',
    labels: ['accept', 'i agree', 'accept all', 'accept terms', 'certify', 'i certify'],
    reason: 'terms/certification control — human only, in every phase',
  },
  {
    kind: 'resume_autofill',
    safety: 'blocked_phase_4',
    labels: ['autofill with resume', 'resume autofill', 'autofill'],
    reason: 'starts a resume upload/parse — blocked in Phase 4',
  },
  {
    kind: 'apply_manually',
    safety: 'blocked_phase_4',
    labels: ['apply manually', 'use my last application'],
    reason: 'enters the application form flow — blocked in Phase 4',
  },
  {
    kind: 'create_account',
    safety: 'blocked_phase_4',
    labels: ['create account', 'create an account', 'create new account'],
    reason: 'account creation — blocked in Phase 4 (manual per submission policy)',
  },
  {
    kind: 'register',
    safety: 'blocked_phase_4',
    labels: ['register', 'sign up'],
    reason: 'registration — blocked in Phase 4 (manual per submission policy)',
  },
  {
    kind: 'sign_in',
    safety: 'blocked_phase_4',
    labels: ['sign in'],
    reason: 'authentication — blocked in Phase 4 (manual per submission policy)',
  },
  {
    kind: 'login',
    safety: 'blocked_phase_4',
    labels: ['login', 'log in'],
    reason: 'authentication — blocked in Phase 4 (manual per submission policy)',
  },
  {
    kind: 'continue_next',
    safety: 'blocked_phase_4',
    labels: ['continue', 'next', 'save and continue'],
    reason: 'advances an application flow — blocked in Phase 4',
  },
  {
    kind: 'upload_resume',
    safety: 'blocked_phase_4',
    pattern: /\bupload\b|\battach\b/,
    reason: 'document upload — blocked in Phase 4',
  },
  {
    kind: 'chatbot_start',
    safety: 'blocked_phase_4',
    labels: ['start', 'begin', 'get started', 'start chat', 'start conversation', "let's begin"],
    reason: 'starts a chatbot/application conversation — blocked in Phase 4',
  },
]

function classifyLabel(snapshot: PageSnapshot, rawLabel: string, clickable: boolean): EntryOption {
  const label = normalizeLabel(rawLabel)
  if (SAFE_APPLY_LABELS.includes(label)) {
    if (snapshot.phase === 'pre_click' && clickable) {
      return {
        label: rawLabel,
        kind: 'apply_cta',
        safety: 'safe_apply_click_only',
        reason: 'job-page-level apply CTA — the ONLY clickable control, and only with --click-apply',
      }
    }
    return {
      label: rawLabel,
      kind: 'apply_cta',
      safety: 'blocked_phase_4',
      reason:
        snapshot.phase === 'post_click'
          ? 'apply-labelled control beyond the original job page — blocked'
          : 'apply CTA not clickable (hidden/disabled) — blocked',
    }
  }
  for (const rule of RULES) {
    if (rule.labels?.includes(label) || rule.pattern?.test(label)) {
      return { label: rawLabel, kind: rule.kind, safety: rule.safety, reason: rule.reason }
    }
  }
  if (/reject all|decline/.test(label)) {
    return {
      label: rawLabel,
      kind: 'unknown',
      safety: 'safe_read_only',
      reason: 'cookie/consent decline — the only non-apply control recon may click',
    }
  }
  if (/\bapply\b|\bapplication\b/.test(label)) {
    return {
      label: rawLabel,
      kind: 'apply_cta',
      safety: 'blocked_phase_4',
      reason: 'apply-like label not on the exact-match safe list — never clicked',
    }
  }
  return {
    label: rawLabel,
    kind: 'unknown',
    safety: 'safe_read_only',
    reason: 'unclassified control — observed only, never clicked',
  }
}

/**
 * Enumerate the application entry options visible on a page, each tagged
 * with what it is and whether Phase 4 may interact with it. Also surfaces
 * non-CTA signals (password fields, captcha) as never_auto entries.
 */
export function detectEntryOptions(snapshot: PageSnapshot): EntryOption[] {
  const options: EntryOption[] = []
  for (const cta of snapshot.ctas) {
    if (!cta.visible || !cta.text.trim()) continue
    options.push(classifyLabel(snapshot, cta.text, cta.visible && cta.enabled))
  }
  if (snapshot.signals.passwordFieldCount > 0) {
    options.push({
      label: '(password field)',
      kind: 'login',
      safety: 'never_auto',
      reason: 'password entry — never automated, in any phase',
    })
  }
  if (snapshot.signals.captchaDetected) {
    options.push({
      label: '(captcha challenge)',
      kind: 'unknown',
      safety: 'never_auto',
      reason: 'captcha — never bypassed or solved, in any phase',
    })
  }
  if (snapshot.signals.fileInputCount > 0) {
    options.push({
      label: '(file upload input)',
      kind: 'upload_resume',
      safety: 'blocked_phase_4',
      reason: 'document upload input — blocked in Phase 4',
    })
  }
  return options
}
