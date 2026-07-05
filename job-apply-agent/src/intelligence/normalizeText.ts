/**
 * Normalize raw job-description text for deterministic keyword matching:
 * unify unicode dashes/quotes, lowercase, collapse whitespace.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
