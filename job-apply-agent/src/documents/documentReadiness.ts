import type { DocumentBlocker, DocumentReadiness } from './types'
import { validateDocuments, type ValidateDocumentsInput } from './validateDocuments'

/** Thrown by the gate when a CV upload is attempted while blockers remain. */
export class DocumentGateError extends Error {
  readonly blockers: DocumentBlocker[]

  constructor(blockers: DocumentBlocker[]) {
    super(
      'CV upload is BLOCKED — unresolved document blockers:\n' +
        blockers.map((b) => `  - [${b.code}] ${b.message}`).join('\n'),
    )
    this.name = 'DocumentGateError'
    this.blockers = blockers
  }
}

/**
 * The Phase 5 document readiness gate. ready_for_cv_upload is true only when
 * every blocker is resolved; ready_for_final_submit is the literal false —
 * no configuration can flip it.
 */
export function evaluateDocumentReadiness(input: ValidateDocumentsInput): DocumentReadiness {
  const report = validateDocuments(input)
  return {
    ready_for_cv_upload: report.blockers.length === 0,
    ready_for_final_submit: false,
    blockers: report.blockers,
    manualReviewItems: report.manualReviewItems,
    warnings: report.warnings,
    perDocument: report.perDocument,
  }
}

/**
 * Hard gate for later phases: any code path that would upload a CV MUST call
 * this first and let it throw. Phase 5 itself has no upload capability — this
 * exists so the check is already mandatory before such code can be written.
 */
export function assertCvUploadAllowed(readiness: DocumentReadiness): void {
  if (!readiness.ready_for_cv_upload) {
    throw new DocumentGateError(readiness.blockers)
  }
}
