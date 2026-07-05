import type { PageSnapshot } from '../flow/types'
import { BaseAdapter } from './BaseAdapter'

export class OracleRecruitingAdapter extends BaseAdapter {
  readonly platform = 'oracle_recruiting' as const
  readonly name = 'OracleRecruitingAdapter'
  protected readonly blockedActionCodes = [
    'create_account',
    'sign_in',
    'apply_manually',
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
      this.textMatches(snapshot, /upload (your )?(resume|resumé|cv)/)
    ) {
      checkpoints.push('resume_upload_choice')
    }
    return checkpoints
  }

  protected override notes(snapshot: PageSnapshot): string[] {
    return this.textMatches(snapshot, /candidate experience|job application/)
      ? ['Oracle Candidate Experience flow detected.']
      : []
  }
}
