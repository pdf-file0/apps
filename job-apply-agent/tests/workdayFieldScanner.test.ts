import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  scanWorkdayFieldsFromHtml,
  scanWorkdayPageFromHtml,
} from '../src/workday/WorkdayFieldScanner'

const root = fileURLToPath(new URL('..', import.meta.url))
const page = (name: string): string =>
  readFileSync(path.join(root, 'test-pages', name), 'utf8')

describe('WorkdayFieldScanner (offline)', () => {
  it('extracts labels, input types, required flags, and sections from My Information', () => {
    const fields = scanWorkdayFieldsFromHtml(page('workday-my-information.html'))
    const byId = new Map(fields.map((f) => [f.fieldId, f]))

    const first = byId.get('firstName')!
    expect(first.label).toBe('First Name')
    expect(first.inputType).toBe('text')
    expect(first.required).toBe(true)
    expect(first.sectionHeading).toBe('My Information')
    expect(first.automationId).toBe('legalNameSection_firstName')

    expect(byId.get('email')!.inputType).toBe('email')
    expect(byId.get('email')!.helpText).toContain('application updates')
    expect(byId.get('phone')!.inputType).toBe('tel')
    expect(byId.get('linkedin')!.inputType).toBe('url')

    const country = byId.get('country')!
    expect(country.inputType).toBe('select')
    expect(country.options).toContain('Singapore')
    expect(country.options).not.toContain('Select One') // placeholder filtered
  })

  it('groups radios into one field with legend label and option list', () => {
    const fields = scanWorkdayFieldsFromHtml(page('workday-application-questions.html'))
    const workAuth = fields.find((f) => f.fieldId === 'workAuth')!
    expect(workAuth.inputType).toBe('radio')
    expect(workAuth.label).toBe('Are you legally authorized to work in Singapore?')
    expect(workAuth.options).toEqual(['Yes', 'No'])
    expect(workAuth.currentValue).toBeNull()
    // four radio groups, not eight radio fields
    expect(fields.filter((f) => f.inputType === 'radio')).toHaveLength(4)
  })

  it('never captures password values and skips hidden inputs', () => {
    const html = `
      <h2>Account</h2>
      <label for="pw">Password</label>
      <input type="password" id="pw" name="pw" value="super-secret-value" />
      <input type="hidden" id="tok" name="tok" value="hidden-token" />
      <label for="vis">Visible</label>
      <input type="text" id="vis" name="vis" value="ok" style="display:none" />`
    const fields = scanWorkdayFieldsFromHtml(html)
    expect(fields).toHaveLength(1)
    const pw = fields[0]!
    expect(pw.inputType).toBe('password')
    expect(pw.currentValue).toBeNull()
    expect(JSON.stringify(fields)).not.toContain('super-secret-value')
    expect(JSON.stringify(fields)).not.toContain('hidden-token')
  })

  it('page scan collects title, buttons, and signals', () => {
    const scan = scanWorkdayPageFromHtml(page('workday-review-submit.html'), 'fixture://review')
    expect(scan.title).toContain('Review')
    expect(scan.buttons).toContain('Submit')
    expect(scan.signals.captchaDetected).toBe(false)

    const captcha = scanWorkdayPageFromHtml(page('workday-captcha.html'), 'fixture://captcha')
    expect(captcha.signals.captchaDetected).toBe(true)

    const resume = scanWorkdayPageFromHtml(page('workday-resume-upload.html'), 'fixture://resume')
    expect(resume.signals.fileInputCount).toBe(1)
    expect(resume.fields.find((f) => f.fieldId === 'resumeFile')!.inputType).toBe('file')
  })
})
