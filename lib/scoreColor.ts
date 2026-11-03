export function getScoreColor(score: number): string {
  if (score <= 24) return '#4ADE80'
  if (score <= 44) return '#C9A84C'
  if (score <= 64) return '#E8934A'
  if (score <= 84) return '#E8623C'
  return '#E23C4E'
}

// Same bands as scripts/fetch-ai-bubble-data.mjs, so a scrubbed historical
// score is labelled exactly the way the daily pipeline would have labelled it.
export function getScoreCategory(score: number): 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Extreme' {
  if (score <= 24) return 'Low'
  if (score <= 44) return 'Moderate'
  if (score <= 64) return 'Elevated'
  if (score <= 84) return 'High'
  return 'Extreme'
}
