import type { Classification, CvRoutingConfig, CvSelection } from './types'

/**
 * Map a classification to a CV using cv_routing.yaml. Buckets routed to
 * cv: null (track_dependent, manual_review) and low-confidence
 * classifications always require manual review; no CV is auto-selected.
 */
export function selectCv(
  classification: Classification,
  cvRoutingConfig: CvRoutingConfig,
): CvSelection {
  const route = cvRoutingConfig.buckets[classification.bucket]
  if (!route) {
    throw new Error(`cv_routing config has no route for bucket "${classification.bucket}"`)
  }

  if (route.cv === null) {
    const reason =
      classification.bucket === 'track_dependent'
        ? 'One application covers multiple tracks; select the CV manually after the track is chosen.'
        : 'Role could not be classified with sufficient confidence; a human must pick the CV.'
    return {
      selectedCvKey: null,
      selectedCvPath: null,
      humanLabel: route.humanLabel ?? 'manual review required',
      requiresManualReview: true,
      reason,
    }
  }

  const cv = cvRoutingConfig.cvs[route.cv]
  if (!cv) {
    throw new Error(
      `cv_routing config: bucket "${classification.bucket}" references unknown cv "${route.cv}"`,
    )
  }

  const lowConfidence = classification.confidence === 'low'
  const requiresManualReview = (route.requiresManualReview ?? false) || lowConfidence
  const reason =
    `Bucket "${classification.bucket}" routes to "${cv.humanLabel}" ` +
    `(${classification.confidence} confidence).` +
    (lowConfidence ? ' Low confidence: manual review required before use.' : '')

  return {
    selectedCvKey: route.cv,
    selectedCvPath: cv.path,
    humanLabel: cv.humanLabel,
    requiresManualReview,
    reason,
  }
}
