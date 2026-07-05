import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { classifyRole } from '../intelligence/classifyRole'
import { selectCv } from '../intelligence/selectCv'
import type {
  Classification,
  CvRoutingConfig,
  CvSelection,
  JobRecord,
  Warning,
} from '../intelligence/types'
import { detectPageState } from './detectPageState'
import { detectPlatform } from './detectPlatform'
import { findApplyCta, findCookieDeclineCta } from './findApplyCta'
import type { ReconJobTarget } from '../providers/JobContentProvider'
import type { PlatformDetection, ReconJobResult, StopReason } from './types'

/** Append-only JSONL action log. Never receives credentials or PII values. */
export class ActionLogger {
  constructor(private readonly filePaths: string[]) {
    for (const filePath of filePaths) {
      mkdirSync(path.dirname(filePath), { recursive: true })
    }
  }

  log(entry: { jobId?: string; event: string; url?: string; details?: unknown }): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry })
    for (const filePath of this.filePaths) {
      appendFileSync(filePath, `${line}\n`, 'utf8')
    }
  }
}

export interface ReconJobOptions {
  clickApply: boolean
  runDir: string
  runLogPath: string
}

const UNKNOWN_PLATFORM: PlatformDetection = {
  platform: 'unknown',
  confidence: 'low',
  evidence: [],
  warnings: [],
}

const MANUAL_REVIEW_STOP_REASONS: readonly StopReason[] = [
  'unsafe_apply_cta',
  'login_or_account_creation_detected',
  'captcha_detected',
  'application_form_detected',
  'navigation_timeout',
  'error',
]

/**
 * Reconnaissance for ONE job: open, capture, extract, classify, detect
 * platform, optionally click one pre-validated Apply CTA, then STOP.
 *
 * Hard boundaries: no field is ever filled, no file is ever uploaded, no
 * terms are ever accepted, no account is ever created, nothing is ever
 * submitted. The only interaction is a single allow-listed CTA click, and
 * only when --click-apply was explicitly passed.
 */
export async function reconJob(
  job: JobRecord,
  target: ReconJobTarget,
  cvRouting: CvRoutingConfig,
  options: ReconJobOptions,
): Promise<ReconJobResult> {
  const jobDir = path.join(options.runDir, job.id)
  mkdirSync(jobDir, { recursive: true })
  const log = new ActionLogger([options.runLogPath, path.join(jobDir, 'action-log.jsonl')])
  const rel = (p: string): string => path.relative(options.runDir, p).split(path.sep).join('/')

  const screenshots: string[] = []
  const artifacts: string[] = []
  const warnings: Warning[] = []
  const writeArtifact = (name: string, data: unknown): void => {
    const filePath = path.join(jobDir, name)
    writeFileSync(
      filePath,
      typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`,
      'utf8',
    )
    artifacts.push(rel(filePath))
  }

  let stopReason: StopReason = 'job_page_captured'
  let finalUrl = job.url
  let pageTitle = ''
  let liveTextExtracted = false
  let classification: Classification | null = null
  let cvSelection: CvSelection | null = null
  let prePlatform: PlatformDetection = UNKNOWN_PLATFORM
  let postPlatform: PlatformDetection | null = null
  let applyCtaFound = false
  let applyCtaClicked = false
  let ctaTextClicked: string | null = null

  try {
    log.log({ jobId: job.id, event: 'navigate_start', url: job.url })
    const nav = await target.open(job.url)
    if (!nav.ok) {
      stopReason = nav.timedOut ? 'navigation_timeout' : 'error'
      warnings.push({
        code: nav.timedOut ? 'navigation_timeout' : 'navigation_error',
        message: `Could not fully load the job page: ${nav.error ?? 'unknown error'}`,
      })
      log.log({ jobId: job.id, event: 'navigate_failed', url: job.url, details: nav.error })
    } else {
      log.log({ jobId: job.id, event: 'navigate_ok', url: job.url })
    }

    // Screenshot the landing state even if navigation was imperfect.
    const shot1 = path.join(jobDir, '01-job-page.png')
    if (await target.screenshot(shot1)) {
      screenshots.push(rel(shot1))
      log.log({ jobId: job.id, event: 'screenshot_captured', details: rel(shot1) })
    }

    let view = await target.view()
    finalUrl = view.url
    pageTitle = view.title
    liveTextExtracted = view.text.trim().length > 0

    // Cookie-consent dialogs block clicks and hide content. Decline-only:
    // click an exact-match "Reject All"-style label if present, never accept.
    const declineCta = findCookieDeclineCta(view.ctas, view.text)
    if (declineCta) {
      log.log({
        jobId: job.id,
        event: 'cookie_banner_decline_attempt',
        url: view.url,
        details: { ctaText: declineCta.text },
      })
      const consentOutcome = await target.clickCta(declineCta)
      if (consentOutcome.clicked && consentOutcome.post) {
        view = consentOutcome.post
        finalUrl = view.url
        pageTitle = view.title || pageTitle
        warnings.push({
          code: 'cookie_banner_declined',
          message: `Declined non-essential cookies via "${declineCta.text}" (privacy-preserving; no terms accepted).`,
        })
        log.log({ jobId: job.id, event: 'cookie_banner_declined', url: view.url })
      }
    }

    writeArtifact('extracted-job-page.txt', view.text)
    writeArtifact('job-page-metadata.json', {
      jobId: job.id,
      originalUrl: job.url,
      landedUrl: view.url,
      title: view.title,
      textLength: view.text.length,
      signals: view.signals,
    })

    if (liveTextExtracted) {
      classification = classifyRole(view.text, {
        id: job.id,
        company: job.company,
        url: job.url,
        platformHint: job.platformHint,
        expectedBucket: job.expectedBucket,
        programTypeHint: job.programTypeHint,
        trackRouting: job.trackRouting,
      })
      cvSelection = selectCv(classification, cvRouting)
      writeArtifact('live-classification.json', { classification, cvSelection })
      log.log({
        jobId: job.id,
        event: 'classified',
        details: { bucket: classification.bucket, confidence: classification.confidence },
      })
    } else {
      warnings.push({
        code: 'no_live_text',
        message: 'No visible text could be extracted from the page; classification skipped.',
      })
    }

    prePlatform = detectPlatform({ url: view.url, title: view.title, text: view.text })
    const pageState = detectPageState(view)
    const ctaScan = findApplyCta(view.ctas)
    applyCtaFound = ctaScan.decision === 'safe_cta_found'
    writeArtifact('cta-candidates.json', { candidates: view.ctas, scan: ctaScan })
    log.log({
      jobId: job.id,
      event: 'cta_scan',
      details: {
        decision: ctaScan.decision,
        safe: ctaScan.safeCta?.text ?? null,
        unsafeApplyLike: ctaScan.unsafeApplyLike.map((c) => c.text),
      },
    })
    for (const w of ctaScan.warnings) {
      warnings.push({ code: 'cta_scan', message: w })
    }

    const stillHealthy = stopReason === 'job_page_captured'
    if (stillHealthy) {
      if (pageState.captcha) {
        stopReason = 'captcha_detected'
      } else if (pageState.loginOrAccount) {
        stopReason = 'login_or_account_creation_detected'
      } else if (pageState.applicationForm) {
        stopReason = 'application_form_detected'
      } else if (!options.clickApply) {
        stopReason = applyCtaFound
          ? 'apply_click_disabled_by_default'
          : ctaScan.decision === 'unsafe_only'
            ? 'unsafe_apply_cta'
            : 'job_page_captured'
      } else if (ctaScan.decision === 'no_cta_found') {
        stopReason = 'apply_cta_not_found'
      } else if (ctaScan.decision === 'unsafe_only' || !ctaScan.safeCta) {
        stopReason = 'unsafe_apply_cta'
      } else {
        // Safe click path. Pre-conditions verified above: still on the
        // original job landing page, no login/captcha/form detected.
        log.log({
          jobId: job.id,
          event: 'apply_click_attempt',
          url: view.url,
          details: { ctaText: ctaScan.safeCta.text },
        })
        const outcome = await target.clickCta(ctaScan.safeCta)
        if (!outcome.clicked) {
          stopReason = 'error'
          warnings.push({
            code: 'apply_click_failed',
            message: outcome.error ?? 'apply CTA click failed',
          })
        } else {
          applyCtaClicked = true
          ctaTextClicked = ctaScan.safeCta.text
          log.log({
            jobId: job.id,
            event: 'apply_clicked',
            details: { openedNewTab: outcome.openedNewTab },
          })
          const shot2 = path.join(jobDir, '02-after-apply-click.png')
          if (await target.screenshot(shot2)) {
            screenshots.push(rel(shot2))
          }
          if (outcome.post) {
            finalUrl = outcome.post.url
            pageTitle = outcome.post.title || pageTitle
            postPlatform = detectPlatform({
              url: outcome.post.url,
              title: outcome.post.title,
              text: outcome.post.text,
            })
            const postState = detectPageState(outcome.post)
            stopReason = postState.captcha
              ? 'captcha_detected'
              : postState.loginOrAccount
                ? 'login_or_account_creation_detected'
                : postState.applicationForm
                  ? 'application_form_detected'
                  : 'platform_detected_after_apply'
            log.log({
              jobId: job.id,
              event: 'post_click_state',
              url: outcome.post.url,
              details: { stopReason, pageStateEvidence: postState.evidence },
            })
          } else {
            stopReason = 'platform_detected_after_apply'
            if (outcome.error) {
              warnings.push({ code: 'post_click_scan_failed', message: outcome.error })
            }
          }
        }
      }
    }
  } catch (err) {
    stopReason = 'error'
    warnings.push({
      code: 'recon_error',
      message: err instanceof Error ? (err.message.split('\n')[0] ?? 'error') : String(err),
    })
    const errorShot = path.join(jobDir, '99-error-state.png')
    if (await target.screenshot(errorShot)) screenshots.push(rel(errorShot))
  } finally {
    await target.close().catch(() => {})
  }

  const platform = postPlatform && postPlatform.platform !== 'unknown' ? postPlatform : prePlatform
  writeArtifact('platform-detection.json', { preClick: prePlatform, postClick: postPlatform })

  const expectedBucket = job.expectedBucket ?? null
  const classificationMatchesExpected =
    classification && expectedBucket ? classification.bucket === expectedBucket : null
  if (classificationMatchesExpected === false) {
    warnings.push({
      code: 'classification_mismatch',
      message: `Live classification "${classification?.bucket}" disagrees with expected bucket "${expectedBucket}"; manual review required.`,
    })
  }

  const manualReviewRequired =
    !classification ||
    classification.bucket === 'manual_review' ||
    (cvSelection?.requiresManualReview ?? true) ||
    classificationMatchesExpected === false ||
    MANUAL_REVIEW_STOP_REASONS.includes(stopReason)

  log.log({
    jobId: job.id,
    event: 'job_recon_complete',
    url: finalUrl,
    details: { stopReason, manualReviewRequired },
  })

  return {
    jobId: job.id,
    company: job.company,
    originalUrl: job.url,
    finalUrlBeforeStop: finalUrl,
    pageTitle,
    liveTextExtracted,
    liveClassification: classification,
    expectedBucket,
    classificationMatchesExpected,
    selectedCvKey: cvSelection?.selectedCvKey ?? null,
    selectedCvHumanLabel: cvSelection?.humanLabel ?? null,
    applyCtaFound,
    applyCtaClicked,
    ctaTextClicked,
    platform: platform.platform,
    platformConfidence: platform.confidence,
    platformEvidence: platform.evidence,
    stopReason,
    manualReviewRequired,
    screenshots,
    artifacts,
    warnings,
  }
}
