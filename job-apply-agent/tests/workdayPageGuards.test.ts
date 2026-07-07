import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scanWorkdayPageFromHtml } from '../src/workday/WorkdayFieldScanner'
import { evaluateWorkdayPageGuards } from '../src/workday/WorkdayPageGuards'
import type { WorkdayPageScan } from '../src/workday/types'

const root = fileURLToPath(new URL('..', import.meta.url))
const scanOf = (name: string): WorkdayPageScan =>
  scanWorkdayPageFromHtml(
    readFileSync(path.join(root, 'test-pages', name), 'utf8'),
    `fixture://${name}`,
  )

describe('WorkdayPageGuards', () => {
  it('final review page: blocks all mutation (final submit + certification + button)', () => {
    const guard = evaluateWorkdayPageGuards(scanOf('workday-review-submit.html'), { uploadRequested: true })
    expect(guard.pageKind).toBe('review_submit')
    expect(guard.mutationAllowed).toBe(false)
    expect(guard.uploadAllowed).toBe(false)
    const codes = guard.blocks.map((b) => b.code)
    expect(codes).toContain('final_submit_page')
    expect(codes).toContain('submit_button_present')
    expect(codes).toContain('certification_present')
  })

  it('terms page: blocks all mutation', () => {
    const guard = evaluateWorkdayPageGuards(scanOf('workday-terms.html'), { uploadRequested: false })
    expect(guard.pageKind).toBe('terms')
    expect(guard.mutationAllowed).toBe(false)
    expect(guard.blocks.map((b) => b.code)).toContain('terms_page')
  })

  it('captcha page: blocks all mutation', () => {
    const guard = evaluateWorkdayPageGuards(scanOf('workday-captcha.html'), { uploadRequested: false })
    expect(guard.pageKind).toBe('captcha')
    expect(guard.mutationAllowed).toBe(false)
    expect(guard.blocks.map((b) => b.code)).toContain('captcha_present')
  })

  it('login/password page: blocks all mutation', () => {
    const html = `
      <title>Start Your Application</title>
      <body><h2>Start Your Application</h2>
      <p>Sign in to continue, or create an account.</p>
      <label for="em">Email</label><input type="email" id="em" />
      <label for="pw">Password</label><input type="password" id="pw" />
      <button>Next</button></body>`
    const guard = evaluateWorkdayPageGuards(scanWorkdayPageFromHtml(html, 'fixture://login'), {
      uploadRequested: false,
    })
    expect(guard.pageKind).toBe('login_or_account')
    expect(guard.mutationAllowed).toBe(false)
    const codes = guard.blocks.map((b) => b.code)
    expect(codes).toContain('login_or_account_page')
    expect(codes).toContain('password_field_present')
  })

  it('already-submitted and expired-job wording blocks mutation', () => {
    const html = `
      <title>My Information</title>
      <body><h2>My Information</h2>
      <p>Your application has been submitted. This job is no longer accepting applications.</p>
      <label for="x">First Name</label><input type="text" id="x" /></body>`
    const guard = evaluateWorkdayPageGuards(scanWorkdayPageFromHtml(html, 'fixture://done'), {
      uploadRequested: false,
    })
    const codes = guard.blocks.map((b) => b.code)
    expect(codes).toContain('already_submitted')
    expect(codes).toContain('job_expired')
    expect(guard.mutationAllowed).toBe(false)
  })

  it('unknown forms are never filled blind', () => {
    const html = `
      <title>Untitled Step</title>
      <body><p>Some additional step.</p>
      <label for="mystery">Mystery Field</label><input type="text" id="mystery" /></body>`
    const guard = evaluateWorkdayPageGuards(scanWorkdayPageFromHtml(html, 'fixture://mystery'), {
      uploadRequested: false,
    })
    expect(guard.pageKind).toBe('unknown')
    expect(guard.mutationAllowed).toBe(false)
    expect(guard.blocks.map((b) => b.code)).toContain('unknown_form')
  })

  it('ordinary form pages allow mutation', () => {
    for (const name of [
      'workday-my-information.html',
      'workday-education.html',
      'workday-experience.html',
      'workday-application-questions.html',
    ]) {
      const guard = evaluateWorkdayPageGuards(scanOf(name), { uploadRequested: false })
      expect(guard.mutationAllowed, name).toBe(true)
      expect(guard.uploadAllowed, name).toBe(false)
    }
  })

  it('file inputs block upload unless explicitly requested — and only on the resume page', () => {
    const withoutFlag = evaluateWorkdayPageGuards(scanOf('workday-resume-upload.html'), {
      uploadRequested: false,
    })
    expect(withoutFlag.pageKind).toBe('resume_upload')
    expect(withoutFlag.uploadAllowed).toBe(false)
    expect(withoutFlag.blocks.map((b) => b.code)).toContain('file_upload_not_allowed')
    expect(withoutFlag.mutationAllowed).toBe(true) // ordinary fields unaffected

    const withFlag = evaluateWorkdayPageGuards(scanOf('workday-resume-upload.html'), {
      uploadRequested: true,
    })
    expect(withFlag.uploadAllowed).toBe(true)

    // even with the flag, a non-resume page never allows upload
    const wrongPage = evaluateWorkdayPageGuards(scanOf('workday-my-information.html'), {
      uploadRequested: true,
    })
    expect(wrongPage.uploadAllowed).toBe(false)
  })
})
