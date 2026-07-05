import type { Bucket } from '../intelligence/types'
import type { CandidateProfile, Experience } from '../profile/types'
import type { ExperienceSelection } from './types'

/**
 * Preferred emphasis order per bucket (by experience id). Experiences not
 * listed fall back to bucket-emphasis matching, ordered by recency, so the
 * logic still works for fixture/dummy data with other ids.
 */
const PREFERRED_ORDER: Record<string, { primary: string[]; secondary: string[] }> = {
  public_equities_markets_research: {
    primary: ['omers_global_equities', 'avanda_public_equities', 'achilles_fund', 'smu_smif'],
    secondary: ['temasek_innovation', 'tembusu_partners'],
  },
  private_markets_ibd_deals: {
    primary: ['temasek_innovation', 'tembusu_partners', 'avanda_public_equities'],
    secondary: ['achilles_fund', 'smu_smif', 'omers_global_equities'],
  },
}

const byRecency = (a: Experience, b: Experience): number =>
  b.start_date.localeCompare(a.start_date)

function orderForBucket(experiences: Experience[], bucket: Bucket): {
  primary: Experience[]
  secondary: Experience[]
} {
  const order = PREFERRED_ORDER[bucket]
  const byId = new Map(experiences.map((exp) => [exp.id, exp]))
  const placed = new Set<string>()
  const primary: Experience[] = []
  const secondary: Experience[] = []

  if (order) {
    for (const id of order.primary) {
      const exp = byId.get(id)
      if (exp) {
        primary.push(exp)
        placed.add(id)
      }
    }
    for (const id of order.secondary) {
      const exp = byId.get(id)
      if (exp) {
        secondary.push(exp)
        placed.add(id)
      }
    }
  }
  // Unlisted experiences: emphasis match -> primary tail, else secondary tail.
  const rest = experiences.filter((exp) => !placed.has(exp.id)).sort(byRecency)
  for (const exp of rest) {
    if (exp.cv_bucket_emphasis.includes(bucket)) primary.push(exp)
    else secondary.push(exp)
  }
  return { primary, secondary }
}

export interface SelectExperienceInput {
  bucket: Bucket
  jobId: string
  profile: CandidateProfile
  /** Resolved track bucket for track_dependent applications, if known. */
  resolvedTrackBucket?: Bucket
}

export function selectExperience(input: SelectExperienceInput): ExperienceSelection {
  const { bucket, jobId, profile } = input

  if (bucket === 'manual_review') {
    return {
      bucket: null,
      primary: [],
      secondary: [],
      manualReviewRequired: true,
      reason: `Job "${jobId}" is classified manual_review; a human must pick the experience emphasis.`,
    }
  }

  if (bucket === 'track_dependent') {
    if (!input.resolvedTrackBucket || input.resolvedTrackBucket === 'track_dependent') {
      return {
        bucket: null,
        primary: [],
        secondary: [],
        manualReviewRequired: true,
        reason: `Job "${jobId}" is track-dependent and no track is selected; pass a selected track first.`,
      }
    }
    const resolved = selectExperience({ ...input, bucket: input.resolvedTrackBucket })
    return {
      ...resolved,
      reason: `Track resolved to "${input.resolvedTrackBucket}" for "${jobId}". ${resolved.reason}`,
    }
  }

  const { primary, secondary } = orderForBucket(profile.experiences, bucket)
  return {
    bucket,
    primary,
    secondary,
    manualReviewRequired: false,
    reason: `Emphasis ordered for bucket "${bucket}" (${primary.length} primary, ${secondary.length} secondary).`,
  }
}
