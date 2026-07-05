import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCvRoutingConfig, loadJobsConfig } from '../src/config/loadConfig'
import { buildApplicationPacket } from '../src/packets/buildApplicationPacket'
import { redactPacket } from '../src/packets/writeApplicationPacket'
import { loadAnswerBank, loadProfile } from '../src/profile/loadProfile'

const root = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url))
const jobsConfig = loadJobsConfig(root('config/jobs.yaml'))
const cvRoutingConfig = loadCvRoutingConfig(root('config/cv_routing.yaml'))
const profile = loadProfile(root('tests/fixtures/candidate_profile.fixture.yaml'))
const answerBank = loadAnswerBank(root('tests/fixtures/answer_bank.fixture.yaml'))

const build = (jobId: string, selectedTrack?: string) =>
  buildApplicationPacket({
    jobId,
    jobsConfig,
    cvRoutingConfig,
    profile,
    answerBank,
    ...(selectedTrack ? { selectedTrack } : {}),
  })

describe('buildApplicationPacket', () => {
  it('builds a public-markets packet for the Barclays research job', () => {
    const packet = build('barclays_research_2027_sg')
    expect(packet.bucket).toBe('public_equities_markets_research')
    expect(packet.selectedCvKey).toBe('omers_public_equities')
    expect(packet.selectedExperiences[0]?.id).toBe('omers_global_equities')
    expect(packet.manualReviewRequired).toBe(false)
    const whyFirm = packet.suggestedAnswers.find((a) => a.kind === 'why_firm')
    expect(whyFirm?.answerId).toBe('why_barclays_research')
  })

  it('builds a private-markets packet for the Barclays IB job', () => {
    const packet = build('barclays_ib_2027_sg')
    expect(packet.bucket).toBe('private_markets_ibd_deals')
    expect(packet.selectedCvKey).toBe('temasek_private_markets')
    expect(packet.selectedExperiences.map((e) => e.id)).toEqual([
      'temasek_innovation',
      'tembusu_partners',
      'avanda_public_equities',
    ])
  })

  it('final submit readiness is always false', () => {
    for (const jobId of ['barclays_research_2027_sg', 'gs_170782', 'gic_internship_programme']) {
      expect(build(jobId).readiness.ready_for_final_submit).toBe(false)
    }
  })

  it('flags not_summer_internship GS jobs for manual review', () => {
    const packet = build('gs_170782')
    expect(packet.warnings.some((w) => w.code === 'not_summer_internship')).toBe(true)
    expect(packet.warnings.some((w) => w.code === 'goldman_sachs_application_limit')).toBe(true)
    expect(packet.manualReviewRequired).toBe(true)
  })

  it('blocks CV upload readiness while document warnings are unresolved', () => {
    const packet = build('barclays_research_2027_sg')
    expect(packet.readiness.ready_for_cv_upload).toBe(false)
    expect(packet.readiness.ready_for_dry_form_fill).toBe(true)
    expect(packet.warnings.some((w) => w.code === 'unresolved_cv_email_mismatch')).toBe(true)
  })

  it('requires manual review for GIC without a selected track', () => {
    const packet = build('gic_internship_programme')
    expect(packet.bucket).toBe('track_dependent')
    expect(packet.manualReviewRequired).toBe(true)
    expect(packet.selectedCvKey).toBeNull()
  })

  it('resolves GIC with selected track public_equities to the public CV', () => {
    const packet = build('gic_internship_programme', 'public_equities')
    expect(packet.bucket).toBe('public_equities_markets_research')
    expect(packet.selectedCvKey).toBe('omers_public_equities')
    expect(packet.resolvedTrack).toBe('public_equities')
    expect(packet.manualReviewRequired).toBe(false)
  })

  it('resolves GIC with selected track private_equity to the private CV', () => {
    const packet = build('gic_internship_programme', 'private_equity')
    expect(packet.bucket).toBe('private_markets_ibd_deals')
    expect(packet.selectedCvKey).toBe('temasek_private_markets')
  })

  it('redacts PII from the redacted packet variant, including emails quoted in warnings', () => {
    const serialized = JSON.stringify(redactPacket(build('barclays_research_2027_sg')))
    expect(serialized).not.toContain('alex.tan@example.edu')
    expect(serialized).not.toContain('old.email@example.edu')
    expect(serialized).not.toContain('1 Example Street')
    expect(serialized).not.toContain('2000-01-01')
    const full = JSON.stringify(build('barclays_research_2027_sg'))
    expect(full).toContain('alex.tan@example.edu') // full packet keeps values (local only)
  })

  it('keeps all suggested answers review-gated', () => {
    const packet = build('bofa_gib_2027_sg')
    expect(packet.suggestedAnswers.length).toBeGreaterThan(5)
    for (const answer of packet.suggestedAnswers) {
      if (answer.answerId) expect(answer.requiresReview).toBe(true)
    }
  })
})
