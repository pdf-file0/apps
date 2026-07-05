import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultAdapterRegistry } from '../adapters/AdapterRegistry'
import type { PageView } from '../browser/types'
import { classifyRole } from '../intelligence/classifyRole'
import type {
  Classification,
  CvRoutingConfig,
  JobRecord,
  JobsConfig,
  Warning,
} from '../intelligence/types'
import { buildApplicationPacket } from '../packets/buildApplicationPacket'
import type { AnswerBank, CandidateProfile } from '../profile/types'
import type { ReconJobTarget } from '../providers/JobContentProvider'
import { detectExtendedPageState } from '../reconnaissance/detectPageState'
import { detectPlatform } from '../reconnaissance/detectPlatform'
import { findApplyCta, findCookieDeclineCta } from '../reconnaissance/findApplyCta'
import { ActionLogger } from '../reconnaissance/runReconnaissance'
import type { PlatformDetection, StopReason } from '../reconnaissance/types'
import { detectEntryOptions } from './detectEntryOptions'
import { detectManualCheckpoints } from './detectManualCheckpoints'
import type {
  FlowMapResult,
  FlowPacketInfo,
  FlowPageObservation,
  PageSnapshot,
} from './types'

const SNIPPET_LENGTH = 400
const MANUAL_REVIEW_STOP_REASONS: readonly StopReason[] = [
  'unsafe_apply_cta',
  'login_or_account_creation_detected',
  'captcha_detected',
  'application_form_detected',
  'navigation_timeout',
  'error',
]

const toSnapshot = (view: PageView, phase: PageSnapshot['phase']): PageSnapshot => ({
  ...view,
  phase,
})

function observe(snapshot: PageSnapshot): FlowPageObservation {
  const state = detectExtendedPageState(snapshot)
  return {
    url: snapshot.url,
    title: snapshot.title,
    pageState: state.state,
    pageStateEvidence: state.evidence,
    entryOptions: detectEntryOptions(snapshot),
    textSnippet: snapshot.text.slice(0, SNIPPET_LENGTH),
  }
}

export interface BuildFlowMapInput {
  job: JobRecord
  target: ReconJobTarget
  jobsConfig: JobsConfig
  cvRoutingConfig: CvRoutingConfig
  profile?: CandidateProfile
  answerBank?: AnswerBank
  selectedTrack?: string
  clickApply: boolean
  runDir: string
  runLogPath: string
}

/**
 * Map the application flow for ONE job. Read-only except for (a) an optional
 * decline-only cookie-banner click and (b) at most one allow-listed
 * job-page-level Apply CTA click when clickApply is explicitly true. After
 * the click the page is OBSERVED and the run stops — nothing is ever typed,
 * filled, selected, uploaded, accepted, or submitted.
 */
export async function buildFlowMap(input: BuildFlowMapInput): Promise<FlowMapResult> {
  const { job, target } = input
  const jobDir = path.join(input.runDir, job.id)
  mkdirSync(jobDir, { recursive: true })
  const log = new ActionLogger([input.runLogPath, path.join(jobDir, 'action-log.jsonl')])
  const rel = (p: string): string => path.relative(input.runDir, p).split(path.sep).join('/')
  const screenshots: string[] = []
  const artifacts: string[] = []
  const warnings: Warning[] = []
  const writeArtifact = (name: string, data: unknown): void => {
    const filePath = path.join(jobDir, name)
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    artifacts.push(rel(filePath))
  }

  let stopReason: StopReason = 'job_page_captured'
  let preObservation: FlowPageObservation | null = null
  let postObservation: FlowPageObservation | null = null
  let classification: Classification | null = null
  let platformDetection: PlatformDetection = {
    platform: 'unknown',
    confidence: 'low',
    evidence: [],
    warnings: [],
  }
  let applyCtaFound = false
  let applyCtaClicked = false
  let ctaTextClicked: string | null = null
  let openedNewTab = false
  let finalSnapshot: PageSnapshot | null = null

  try {
    log.log({ jobId: job.id, event: 'flow_navigate_start', url: job.url })
    const nav = await target.open(job.url)
    if (!nav.ok) {
      stopReason = nav.timedOut ? 'navigation_timeout' : 'error'
      warnings.push({
        code: nav.timedOut ? 'navigation_timeout' : 'navigation_error',
        message: `Could not fully load the job page: ${nav.error ?? 'unknown error'}`,
      })
    }
    const shot1 = path.join(jobDir, '01-job-page.png')
    if (await target.screenshot(shot1)) screenshots.push(rel(shot1))

    let view = await target.view()
    // Decline-only cookie handling (same rule as Phase 2 recon).
    const declineCta = findCookieDeclineCta(view.ctas, view.text)
    if (declineCta) {
      log.log({ jobId: job.id, event: 'cookie_banner_decline_attempt', details: declineCta.text })
      const outcome = await target.clickCta(declineCta)
      if (outcome.clicked && outcome.post) {
        view = outcome.post
        warnings.push({
          code: 'cookie_banner_declined',
          message: `Declined non-essential cookies via "${declineCta.text}".`,
        })
      }
    }

    const preSnapshot = toSnapshot(view, 'pre_click')
    finalSnapshot = preSnapshot
    preObservation = observe(preSnapshot)
    if (view.text.trim().length > 0) {
      classification = classifyRole(view.text, {
        id: job.id,
        company: job.company,
        url: job.url,
        platformHint: job.platformHint,
        expectedBucket: job.expectedBucket,
        programTypeHint: job.programTypeHint,
        trackRouting: job.trackRouting,
      })
    }
    platformDetection = detectPlatform({ url: view.url, title: view.title, text: view.text })

    const ctaScan = findApplyCta(view.ctas)
    applyCtaFound = ctaScan.decision === 'safe_cta_found'
    for (const w of ctaScan.warnings) warnings.push({ code: 'cta_scan', message: w })

    const preState = preObservation.pageState
    const unsafePreState = ['login', 'account_creation', 'captcha', 'terms', 'final_submit'].includes(
      preState,
    )
    if (stopReason === 'job_page_captured') {
      if (preState === 'captcha') {
        stopReason = 'captcha_detected'
      } else if (preState === 'login' || preState === 'account_creation') {
        stopReason = 'login_or_account_creation_detected'
      } else if (!input.clickApply) {
        stopReason = applyCtaFound
          ? 'apply_click_disabled_by_default'
          : ctaScan.decision === 'unsafe_only'
            ? 'unsafe_apply_cta'
            : 'job_page_captured'
      } else if (ctaScan.decision === 'no_cta_found') {
        stopReason = 'apply_cta_not_found'
      } else if (ctaScan.decision === 'unsafe_only' || !ctaScan.safeCta || unsafePreState) {
        stopReason = 'unsafe_apply_cta'
      } else {
        log.log({ jobId: job.id, event: 'apply_click_attempt', details: ctaScan.safeCta.text })
        const outcome = await target.clickCta(ctaScan.safeCta)
        if (!outcome.clicked) {
          stopReason = 'error'
          warnings.push({ code: 'apply_click_failed', message: outcome.error ?? 'click failed' })
        } else {
          applyCtaClicked = true
          ctaTextClicked = ctaScan.safeCta.text
          openedNewTab = outcome.openedNewTab
          log.log({ jobId: job.id, event: 'apply_clicked', details: { openedNewTab } })
          const shot2 = path.join(jobDir, '02-after-apply-click.png')
          if (await target.screenshot(shot2)) screenshots.push(rel(shot2))
          if (outcome.post) {
            const postSnapshot = toSnapshot(outcome.post, 'post_click')
            finalSnapshot = postSnapshot
            postObservation = observe(postSnapshot)
            const postPlatform = detectPlatform({
              url: outcome.post.url,
              title: outcome.post.title,
              text: outcome.post.text,
            })
            if (postPlatform.platform !== 'unknown') platformDetection = postPlatform
            stopReason =
              postObservation.pageState === 'captcha'
                ? 'captcha_detected'
                : postObservation.pageState === 'login' ||
                    postObservation.pageState === 'account_creation'
                  ? 'login_or_account_creation_detected'
                  : postObservation.pageState === 'profile_form' ||
                      postObservation.pageState === 'resume_upload'
                    ? 'application_form_detected'
                    : 'platform_detected_after_apply'
          } else {
            stopReason = 'platform_detected_after_apply'
          }
        }
      }
    }
  } catch (err) {
    stopReason = 'error'
    warnings.push({
      code: 'flow_error',
      message: err instanceof Error ? (err.message.split('\n')[0] ?? 'error') : String(err),
    })
  } finally {
    await target.close().catch(() => {})
  }

  // Adapter + checkpoints run on the LAST observed page (post-click if any).
  const snapshot: PageSnapshot =
    finalSnapshot ??
    ({
      url: job.url,
      title: '',
      text: '',
      signals: { passwordFieldCount: 0, fileInputCount: 0, captchaDetected: false, formFieldCount: 0 },
      ctas: [],
      phase: 'pre_click',
    } as PageSnapshot)
  const adapter = defaultAdapterRegistry.select(platformDetection)
  const adapterSummary = adapter.buildAdapterSummary(snapshot)

  // Phase 3 packet integration (offline).
  let packet: FlowPacketInfo | null = null
  let packetManualReview = false
  if (input.profile && input.answerBank) {
    const applicationPacket = buildApplicationPacket({
      jobId: job.id,
      jobsConfig: input.jobsConfig,
      cvRoutingConfig: input.cvRoutingConfig,
      profile: input.profile,
      answerBank: input.answerBank,
      ...(input.selectedTrack ? { selectedTrack: input.selectedTrack } : {}),
    })
    packet = {
      selectedCvKey: applicationPacket.selectedCvKey,
      selectedCvHumanLabel: applicationPacket.selectedCvHumanLabel,
      readiness: applicationPacket.readiness,
      unresolvedBlockingItems: applicationPacket.unresolvedItems
        .filter((item) => item.severity === 'blocking_before_final_upload')
        .map((item) => item.id),
      manualReviewRequired: applicationPacket.manualReviewRequired,
    }
    packetManualReview = applicationPacket.manualReviewRequired
  } else {
    warnings.push({
      code: 'packet_unavailable',
      message: 'No candidate profile/answer bank supplied; packet readiness not included.',
    })
  }

  const expectedBucket = job.expectedBucket ?? null
  const classificationMatchesExpected =
    classification && expectedBucket ? classification.bucket === expectedBucket : null

  const observation = postObservation ?? preObservation
  const manualCheckpoints = detectManualCheckpoints({
    snapshot,
    pageState: observation?.pageState ?? 'unknown',
    entryOptions: observation?.entryOptions ?? [],
    adapterSummary,
    platform: platformDetection.platform,
    classification,
    classificationMatchesExpected,
    packet,
  })

  const safeActions = [
    'observe_page',
    'capture_screenshot',
    'extract_visible_text',
    'detect_platform_and_state',
    ...(applyCtaFound && !applyCtaClicked
      ? ['click_job_page_apply_cta (requires explicit --click-apply)']
      : []),
  ]

  const manualReviewRequired =
    adapterSummary.manualReviewRequired ||
    packetManualReview ||
    !classification ||
    classification.bucket === 'manual_review' ||
    classificationMatchesExpected === false ||
    MANUAL_REVIEW_STOP_REASONS.includes(stopReason)

  writeArtifact('page-snapshot.json', { pre: preObservation, post: postObservation, snapshot })
  writeArtifact('entry-options.json', observation?.entryOptions ?? [])
  writeArtifact('manual-checkpoints.json', manualCheckpoints)
  writeArtifact('adapter-summary.json', adapterSummary)
  log.log({ jobId: job.id, event: 'flow_map_complete', details: { stopReason, manualReviewRequired } })

  return {
    jobId: job.id,
    company: job.company,
    url: job.url,
    platform: platformDetection.platform,
    platformConfidence: platformDetection.confidence,
    platformEvidence: platformDetection.evidence,
    adapter: adapter.name,
    programType: classification?.programType ?? 'unknown',
    liveClassification: classification,
    classificationMatchesExpected,
    preClick: preObservation,
    applyCtaFound,
    applyCtaClicked,
    ctaTextClicked,
    openedNewTab,
    postClick: postObservation,
    safeActions,
    blockedActions: adapterSummary.blockedActions,
    manualCheckpoints,
    packet,
    stopReason,
    manualReviewRequired,
    screenshots,
    artifacts,
    warnings,
  }
}

/** Convenience: read a job's Phase-1 fixture text (used by fixture tests). */
export function readJobFixtureText(job: JobRecord): string {
  const fixturePath = path.resolve(process.cwd(), job.fixture)
  return existsSync(fixturePath) ? readFileSync(fixturePath, 'utf8') : ''
}
