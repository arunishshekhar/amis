import type { RiskLevel, Recommendation } from '../types/recommendation';
import type { ConsistencyInsight } from '../types/consistency-insight';

const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function sortItemsByRisk(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const riskDiff = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return b.confidenceScore - a.confidenceScore;
  });
}

export function riskColor(level: RiskLevel): string {
  if (level === 'high') return '#ff4444';
  if (level === 'medium') return '#ff8c00';
  return '#44bb44';
}

export function confidenceColor(score: number): string {
  return score < 70 ? '#ff8c00' : '#cccccc';
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function formatStats(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([k, v]) => `${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`)
    .join(' · ');
}

export function sortedInsights(insights: ConsistencyInsight[]): ConsistencyInsight[] {
  return [...insights].sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    return b.detectedAt - a.detectedAt;
  });
}
