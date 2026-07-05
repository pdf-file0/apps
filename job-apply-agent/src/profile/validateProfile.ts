import type { CandidateProfile, UnresolvedItem } from './types'

export interface ProfileValidationReport {
  ok: boolean
  warnings: string[]
  blockingItems: UnresolvedItem[]
  manualReviewItems: UnresolvedItem[]
}

/**
 * Semantic validation on top of the Zod schema: the profile can be
 * structurally valid while still carrying unresolved items or stale data
 * that must be surfaced on every use.
 */
export function validateProfile(profile: CandidateProfile): ProfileValidationReport {
  const warnings: string[] = []

  const blockingItems = profile.unresolved_items.filter(
    (item) => item.severity === 'blocking_before_final_upload',
  )
  const manualReviewItems = profile.unresolved_items.filter(
    (item) => item.severity === 'manual_review_if_asked',
  )
  for (const item of blockingItems) {
    warnings.push(`BLOCKING before any final upload: [${item.id}] ${item.message}`)
  }
  for (const item of manualReviewItems) {
    warnings.push(`Manual review if asked: [${item.id}] ${item.message}`)
  }

  for (const exp of profile.experiences) {
    if (exp.end_date === 'TBD') {
      warnings.push(
        `Experience "${exp.id}" has end_date TBD — confirm the real end date before any upload.`,
      )
    }
    if (exp.warnings) {
      for (const w of exp.warnings) warnings.push(`Experience "${exp.id}": ${w}`)
    }
    if (exp.status_note) {
      warnings.push(`Experience "${exp.id}": ${exp.status_note}`)
    }
  }

  const portalEmails = new Set(Object.values(profile.portal_accounts).map((p) => p.email))
  if (portalEmails.size > 0 && !portalEmails.has(profile.candidate.preferred_application_email)) {
    warnings.push('Portal account emails do not include the preferred application email.')
  }

  return { ok: true, warnings, blockingItems, manualReviewItems }
}
