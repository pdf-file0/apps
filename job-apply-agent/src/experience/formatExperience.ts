import type { Experience } from '../profile/types'
import type { FormattedExperience } from './types'

/**
 * ATS-friendly formatting. Achilles/SMIF-style records keep their
 * leadership_activity type so portals with separate sections can route them;
 * a portal with only one generic experience section can still use them
 * because heading/bullets are formatted identically.
 */
export function formatExperience(exp: Experience): FormattedExperience {
  const employerOrOrganization = exp.employer ?? exp.organization ?? ''
  const end = exp.end_date === 'TBD' ? 'TBD (confirm before upload)' : exp.end_date
  return {
    id: exp.id,
    heading: `${exp.title} — ${employerOrOrganization}`,
    employerOrOrganization,
    title: exp.title,
    dates: `${exp.start_date} – ${end}`,
    location: exp.location,
    type: exp.type,
    shortDescription: exp.short_description,
    bullets: [...exp.bullets],
    warnings: [...(exp.warnings ?? []), ...(exp.status_note ? [exp.status_note] : [])],
  }
}
