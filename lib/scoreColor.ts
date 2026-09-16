export function getScoreColor(score: number): string {
  if (score <= 24) return '#4ADE80'
  if (score <= 44) return '#C9A84C'
  if (score <= 64) return '#E8934A'
  if (score <= 84) return '#E8623C'
  return '#E23C4E'
}
