/**
 * Minimal deterministic logger. No timestamps (keeps run output stable) and
 * no candidate PII: callers must only pass job ids, bucket names, file paths
 * and warning codes — never emails, phone numbers, or document contents.
 */
export const logger = {
  info(message: string): void {
    console.log(message)
  },
  warn(message: string): void {
    console.warn(`[warn] ${message}`)
  },
  error(message: string): void {
    console.error(`[error] ${message}`)
  },
}
