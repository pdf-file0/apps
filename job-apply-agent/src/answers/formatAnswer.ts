import type { AnswerSelection } from './types'

/** Render one suggested answer as review-ready Markdown. */
export function formatAnswerMarkdown(selection: AnswerSelection): string {
  const lines = [`### ${selection.questionText}`, '']
  if (selection.answerId && selection.draftAnswer) {
    lines.push(
      `*Draft answer \`${selection.answerId}\` — confidence: ${selection.confidence}, ` +
        `requires review: ${selection.requiresReview ? 'YES' : 'no'}*`,
      '',
      selection.draftAnswer,
    )
  } else {
    lines.push(`*No suitable draft — ${selection.reason}*`)
  }
  lines.push('')
  return lines.join('\n')
}
