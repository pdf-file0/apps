import type { PageSnapshot } from '../flow/types'
import { BaseAdapter } from './BaseAdapter'

export class TalNetAdapter extends BaseAdapter {
  readonly platform = 'tal_net' as const
  readonly name = 'TalNetAdapter'
  protected readonly blockedActionCodes = [
    'register',
    'sign_in',
    'continue_next',
    'upload_document',
    'submit',
  ] as const

  detectManualCheckpoints(snapshot: PageSnapshot): string[] {
    const checkpoints: string[] = []
    if (
      this.hasOptionKind(snapshot, 'register', 'create_account') ||
      this.textMatches(snapshot, /register|create an? account/)
    ) {
      checkpoints.push('account_creation_required')
    }
    if (
      this.hasOptionKind(snapshot, 'sign_in', 'login') ||
      snapshot.signals.passwordFieldCount > 0
    ) {
      checkpoints.push('login_required')
    }
    if (this.textMatches(snapshot, /candidate portal|campus (careers|profile)/)) {
      checkpoints.push('campus_profile_required')
    }
    return checkpoints
  }

  protected override notes(snapshot: PageSnapshot): string[] {
    return this.textMatches(snapshot, /application questions|document upload/)
      ? ['TAL.net application questions/document upload present — human handles all of it.']
      : []
  }
}
