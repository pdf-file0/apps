import { describe, expect, it } from 'vitest'
import { parseAccountStatusFile } from '../src/accounts/accountStatus'
import { buildPostLoginNote, recordAccountTransition } from '../src/accounts/accountStateRecorder'
import type { AccountStatusFile } from '../src/accounts/types'
import { ConfigError } from '../src/config/loadConfig'

function baseFile(): AccountStatusFile {
  return {
    accounts: {
      barclays_workday: {
        company: 'Barclays',
        portal: 'workday',
        email: 'alex.tan@example.edu',
        entry_url: 'https://example.wd3.myworkdayjobs.com/entry',
        status: 'not_created',
        history: [],
      },
    },
  }
}

describe('recordAccountTransition', () => {
  it('updates status and appends a history entry without mutating the input', () => {
    const file = baseFile()
    const updated = recordAccountTransition(file, {
      accountKey: 'barclays_workday',
      to: 'created',
      at: '2026-07-06',
      note: 'created manually during setup session',
    })
    expect(updated.accounts['barclays_workday']!.status).toBe('created')
    expect(updated.accounts['barclays_workday']!.history).toEqual([
      { at: '2026-07-06', from: 'not_created', to: 'created', note: 'created manually during setup session' },
    ])
    // input untouched
    expect(file.accounts['barclays_workday']!.status).toBe('not_created')
    expect(file.accounts['barclays_workday']!.history).toEqual([])
  })

  it('sets last_verified when the account is created or login-verified', () => {
    const created = recordAccountTransition(baseFile(), {
      accountKey: 'barclays_workday',
      to: 'login_verified',
      at: '2026-07-06',
    })
    expect(created.accounts['barclays_workday']!.last_verified).toBe('2026-07-06')
  })

  it('creates a new record when company/portal/email are provided', () => {
    const updated = recordAccountTransition(
      { accounts: {} },
      {
        accountKey: 'gic_impress_ai',
        to: 'not_created',
        at: '2026-07-06',
        company: 'GIC',
        portal: 'impress_ai',
        email: 'alex.tan@example.edu',
      },
    )
    expect(updated.accounts['gic_impress_ai']!.status).toBe('not_created')
    expect(updated.accounts['gic_impress_ai']!.history[0]!.from).toBe('unknown')
  })

  it('refuses to create a record without identifying fields', () => {
    expect(() =>
      recordAccountTransition({ accounts: {} }, { accountKey: 'mystery', to: 'created', at: '2026-07-06' }),
    ).toThrow(ConfigError)
  })

  it('rejects notes that look like credential material', () => {
    for (const note of ['password: hunter2', 'otp=123456', 'session_id: abc', 'token = xyz']) {
      expect(() =>
        recordAccountTransition(baseFile(), {
          accountKey: 'barclays_workday',
          to: 'created',
          at: '2026-07-06',
          note,
        }),
      ).toThrow(/credential/i)
    }
  })

  it('accepts benign notes that merely mention manual password creation', () => {
    const updated = recordAccountTransition(baseFile(), {
      accountKey: 'barclays_workday',
      to: 'created',
      at: '2026-07-06',
      note: 'human created the password themselves in the browser',
    })
    expect(updated.accounts['barclays_workday']!.history[0]!.note).toContain('themselves')
  })
})

describe('account status schema hard-blocks credentials', () => {
  it('rejects extra keys such as password (strict schema)', () => {
    const yaml = `
accounts:
  barclays_workday:
    company: Barclays
    portal: workday
    email: "alex.tan@example.edu"
    status: created
    password: "hunter2"
    history: []
`
    expect(() => parseAccountStatusFile(yaml)).toThrow(ConfigError)
  })

  it('rejects credential-looking notes in the file itself', () => {
    const yaml = `
accounts:
  barclays_workday:
    company: Barclays
    portal: workday
    email: "alex.tan@example.edu"
    status: created
    notes: "temp password: hunter2"
    history: []
`
    expect(() => parseAccountStatusFile(yaml)).toThrow(/credential/i)
  })

  it('accepts the committed example file shape', () => {
    const yaml = `
accounts:
  barclays_workday:
    company: Barclays
    portal: workday
    email: "alex.tan@example.edu"
    entry_url: "https://example.wd3.myworkdayjobs.com/example_careers"
    status: not_created
    notes: "Create manually via accounts:setup."
    history: []
`
    const file = parseAccountStatusFile(yaml)
    expect(file.accounts['barclays_workday']!.status).toBe('not_created')
  })
})

describe('buildPostLoginNote', () => {
  it('stores evidence labels only', () => {
    const note = buildPostLoginNote({ signedInLikely: true, evidence: ['sign-out control visible'] })
    expect(note).toBe('post-login capture: signed-in signals observed (sign-out control visible)')
  })

  it('reports the negative case plainly', () => {
    expect(buildPostLoginNote({ signedInLikely: false, evidence: [] })).toContain('no signed-in signals')
  })
})
