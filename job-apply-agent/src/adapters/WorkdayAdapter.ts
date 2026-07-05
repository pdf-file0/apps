import type { PageSnapshot } from '../flow/types'
import { BaseAdapter } from './BaseAdapter'

export class WorkdayAdapter extends BaseAdapter {
  readonly platform = 'workday' as const
  readonly name = 'WorkdayAdapter'
  protected readonly blockedActionCodes = [
    'click_autofill_with_resume',
    'click_apply_manually',
    'create_account',
    'sign_in',
    'upload_resume',
    'continue_next',
    'submit',
  ] as const

  detectManualCheckpoints(snapshot: PageSnapshot): string[] {
    const checkpoints: string[] = []
    if (this.hasOptionKind(snapshot, 'create_account', 'register')) {
      checkpoints.push('account_creation_required')
    }
    if (
      this.hasOptionKind(snapshot, 'sign_in', 'login') ||
      snapshot.signals.passwordFieldCount > 0
    ) {
      checkpoints.push('login_required')
    }
    if (
      this.hasOptionKind(snapshot, 'resume_autofill', 'upload_resume') ||
      this.textMatches(snapshot, /autofill with resume|use my last application/)
    ) {
      checkpoints.push('resume_upload_choice')
    }
    if (this.textMatches(snapshot, /\bmy information\b/) && snapshot.signals.formFieldCount >= 3) {
      checkpoints.push('profile_form_detected')
    }
    return checkpoints
  }

  protected override notes(snapshot: PageSnapshot): string[] {
    const notes: string[] = []
    if (this.textMatches(snapshot, /start your application/)) {
      notes.push('Workday "Start Your Application" chooser detected — a human must pick the entry path.')
    }
    if (this.textMatches(snapshot, /candidate home/)) {
      notes.push('Workday Candidate Home wording present.')
    }
    return notes
  }
}
