import type { Platform, PlatformDetection } from './types'

interface Signal {
  needle: string
  weight: number
}

interface PlatformProfile {
  platform: Exclude<Platform, 'unknown'>
  urlSignals: Signal[]
  textSignals: Signal[]
}

// URL signals: weight 3 = unambiguous ATS domain fragment, weight 2 = weaker
// URL hint. Text signals are always weight 1 (page copy is easily polluted).
const PROFILES: PlatformProfile[] = [
  {
    platform: 'workday',
    urlSignals: [
      { needle: 'myworkdayjobs', weight: 3 },
      { needle: 'myworkdaysite', weight: 3 },
      { needle: 'workday', weight: 2 },
      { needle: '.wd1.', weight: 2 },
      { needle: '.wd3.', weight: 2 },
    ],
    textSignals: [
      { needle: 'workday', weight: 1 },
      { needle: 'candidate home', weight: 1 },
      { needle: 'my information', weight: 1 },
    ],
  },
  {
    platform: 'tal_net',
    urlSignals: [
      { needle: 'tal.net', weight: 3 },
      { needle: 'bankcampuscareers', weight: 2 },
      { needle: 'campuscareers', weight: 2 },
      { needle: 'campus-careers', weight: 2 },
    ],
    textSignals: [
      { needle: 'tal.net', weight: 1 },
      { needle: 'candidate portal', weight: 1 },
      { needle: 'bank of america campus', weight: 1 },
    ],
  },
  {
    platform: 'oracle_recruiting',
    urlSignals: [
      { needle: 'oraclecloud', weight: 3 },
      { needle: 'fa-ew', weight: 2 },
      { needle: 'hcmui', weight: 2 },
      { needle: 'candidateexperience', weight: 2 },
    ],
    textSignals: [
      { needle: 'oracle', weight: 1 },
      { needle: 'candidate experience', weight: 1 },
      { needle: 'job application', weight: 1 },
    ],
  },
  {
    platform: 'impress_ai',
    urlSignals: [
      { needle: 'impress.ai', weight: 3 },
      { needle: 'gic.careers', weight: 2 },
      { needle: 'chatbot', weight: 2 },
    ],
    textSignals: [
      { needle: 'impress.ai', weight: 1 },
      { needle: 'impress', weight: 1 },
      { needle: 'chatbot', weight: 1 },
      { needle: 'virtual assistant', weight: 1 },
    ],
  },
  {
    platform: 'greenhouse',
    urlSignals: [
      { needle: 'greenhouse.io', weight: 3 },
      { needle: 'boards.greenhouse', weight: 3 },
    ],
    textSignals: [{ needle: 'greenhouse', weight: 1 }],
  },
  {
    platform: 'lever',
    urlSignals: [
      { needle: 'lever.co', weight: 3 },
      { needle: 'jobs.lever', weight: 3 },
    ],
    textSignals: [{ needle: 'jobs powered by lever', weight: 1 }],
  },
  {
    platform: 'linkedin',
    urlSignals: [{ needle: 'linkedin.com', weight: 3 }],
    textSignals: [{ needle: 'easy apply', weight: 1 }],
  },
]

export interface DetectPlatformInput {
  url: string
  title?: string
  text?: string
}

/**
 * Deterministic, evidence-listing platform detection from URL + page text.
 * Confidence: any strong URL signal or score >= 3 -> high; score 2 -> medium;
 * score 1 -> low; no signal -> unknown/low.
 */
export function detectPlatform(input: DetectPlatformInput): PlatformDetection {
  const url = input.url.toLowerCase()
  const haystack = `${input.title ?? ''} ${input.text ?? ''}`.toLowerCase()

  const scored = PROFILES.map((profile) => {
    let score = 0
    let strongUrlHit = false
    const evidence: string[] = []
    for (const signal of profile.urlSignals) {
      if (url.includes(signal.needle)) {
        score += signal.weight
        if (signal.weight >= 3) strongUrlHit = true
        evidence.push(`url contains "${signal.needle}"`)
      }
    }
    for (const signal of profile.textSignals) {
      if (haystack.includes(signal.needle)) {
        score += signal.weight
        evidence.push(`text contains "${signal.needle}"`)
      }
    }
    return { platform: profile.platform, score, strongUrlHit, evidence }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  const warnings: string[] = []
  const best = scored[0]
  if (!best) {
    return {
      platform: 'unknown',
      confidence: 'low',
      evidence: [],
      warnings: ['no platform signals matched'],
    }
  }

  const runnerUp = scored[1]
  if (runnerUp && runnerUp.score === best.score) {
    warnings.push(
      `ambiguous platform signals: ${best.platform} and ${runnerUp.platform} scored equally (${best.score})`,
    )
    return {
      platform: best.platform,
      confidence: 'low',
      evidence: best.evidence,
      warnings,
    }
  }
  if (runnerUp) {
    warnings.push(`secondary platform signals present: ${runnerUp.platform} (score ${runnerUp.score})`)
  }

  const confidence = best.strongUrlHit || best.score >= 3 ? 'high' : best.score === 2 ? 'medium' : 'low'
  return { platform: best.platform, confidence, evidence: best.evidence, warnings }
}
