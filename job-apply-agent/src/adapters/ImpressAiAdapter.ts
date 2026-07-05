import type { PageSnapshot } from '../flow/types'
import { BaseAdapter } from './BaseAdapter'

export class ImpressAiAdapter extends BaseAdapter {
  readonly platform = 'impress_ai' as const
  readonly name = 'ImpressAiAdapter'
  protected readonly blockedActionCodes = [
    'start_chat',
    'send_message',
    'upload_resume',
    'answer_question',
    'submit',
  ] as const

  detectManualCheckpoints(snapshot: PageSnapshot): string[] {
    const checkpoints: string[] = []
    if (this.textMatches(snapshot, /chatbot|virtual assistant|impress\.ai/)) {
      checkpoints.push('chatbot_application_flow')
    }
    if (
      this.hasOptionKind(snapshot, 'chatbot_start') ||
      snapshot.signals.formFieldCount > 0 ||
      this.textMatches(snapshot, /answer|prompt|type your/)
    ) {
      checkpoints.push('user_input_required')
    }
    if (
      snapshot.signals.fileInputCount > 0 ||
      this.textMatches(snapshot, /upload (your )?(resume|resumé|cv)/)
    ) {
      checkpoints.push('resume_upload_possible')
    }
    return checkpoints
  }

  protected override notes(_snapshot: PageSnapshot): string[] {
    return [
      'Chatbot-driven application: every message/answer is candidate input — all of it stays manual.',
    ]
  }
}
