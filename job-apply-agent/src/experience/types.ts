import type { Bucket } from '../intelligence/types'
import type { Experience } from '../profile/types'

export interface ExperienceSelection {
  /** Bucket the selection was made for (after any track resolution). */
  bucket: Bucket | null
  primary: Experience[]
  secondary: Experience[]
  manualReviewRequired: boolean
  reason: string
}

export interface FormattedExperience {
  id: string
  heading: string
  employerOrOrganization: string
  title: string
  dates: string
  location: string
  type: Experience['type']
  shortDescription: string
  bullets: string[]
  warnings: string[]
}
