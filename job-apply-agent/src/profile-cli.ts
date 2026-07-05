import { ConfigError } from './config/loadConfig'
import { logger } from './logging/logger'
import { loadProfile } from './profile/loadProfile'
import { maskEmailsInText, redactProfile } from './profile/redactProfile'
import { validateProfile } from './profile/validateProfile'

const DEFAULT_PROFILE = 'profiles/candidate_profile.local.yaml'

function getFlag(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index < 0) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new ConfigError(`Flag ${flag} requires a value.`)
  return value
}

function main(): void {
  const argv = process.argv.slice(2)
  const command = argv[0]
  if (command !== 'validate' && command !== 'summary') {
    throw new ConfigError(
      'Usage: npm run profile:validate -- --profile <path> | npm run profile:summary -- --profile <path>',
    )
  }
  const profilePath = getFlag(argv, '--profile') ?? DEFAULT_PROFILE
  const profile = loadProfile(profilePath)
  const report = validateProfile(profile)

  if (command === 'validate') {
    logger.info(`Profile OK: ${profilePath} (schema + policy validation passed)`)
    logger.info(
      `Sections: ${profile.experiences.length} experiences, ${profile.education.length} education ` +
        `record(s), ${Object.keys(profile.application_history).length} company histories, ` +
        `${profile.unresolved_items.length} unresolved item(s).`,
    )
    if (report.warnings.length > 0) {
      logger.info('')
      for (const warning of report.warnings) logger.warn(maskEmailsInText(warning))
    }
    return
  }

  // summary — REDACTED ONLY. Full values never reach the console here.
  const redacted = redactProfile(profile)
  const c = redacted.candidate
  const education = redacted.education[0]
  logger.info('Candidate profile summary (redacted):')
  logger.info(`  Name:        ${c.legal_name} (preferred: ${c.preferred_name})`)
  logger.info(`  Email:       ${c.preferred_application_email}`)
  logger.info(`  Phone:       ${c.phone}`)
  logger.info(`  Address:     ${c.residential_address.line_1}, ${c.residential_address.country}`)
  logger.info(`  DOB:         ${c.date_of_birth.iso}`)
  logger.info(`  Nationality: ${c.nationality}`)
  if (education) {
    logger.info(
      `  Education:   ${education.degree}${education.major ? `, ${education.major}` : ''} — ` +
        `${education.institution} (grad: ${education.expected_graduation_month_year ?? 'n/a'})`,
    )
  }
  const topRoles = Object.entries(redacted.target_role_ranking)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([role, rank]) => `${rank}. ${role}`)
  logger.info(`  Top roles:   ${topRoles.join('  ')}`)
  logger.info(`  Experiences: ${redacted.experiences.map((e) => e.id).join(', ')}`)
  if (report.warnings.length > 0) {
    logger.info('')
    for (const warning of report.warnings) logger.warn(warning)
  }
}

try {
  main()
} catch (err) {
  if (err instanceof ConfigError) logger.error(err.message)
  else logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exitCode = 1
}
