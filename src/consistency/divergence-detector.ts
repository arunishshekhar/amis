import type { ModDecision } from '../types/mod-decision';
import type { Recommendation } from '../types/recommendation';
import type { PolicyObject } from '../types/policy-object';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_GROUP_SIZE = 5;
const DIVERGENCE_THRESHOLD = 0.2;
const DRIFT_THRESHOLD = 0.3;

export interface DivergenceSignal {
  policyId: string;
  policyTitle: string;
  removeCount: number;
  approveCount: number;
  divergenceRatio: number;
}

export interface DriftSignal {
  policyId: string;
  policyTitle: string;
  historicalApproveRate: number;
  recentApproveRate: number;
  delta: number;
}

export interface VarianceSignal {
  policyId: string;
  policyTitle: string;
  removeRate: number;
  approveRate: number;
  escalateRate: number;
  sampleSize: number;
}

function buildItemToPolicy(recs: Recommendation[]): Map<string, string | null> {
  return new Map(recs.map((r) => [r.itemId, r.matchedPolicyId]));
}

function buildPolicyTitles(policies: PolicyObject[]): Map<string, string> {
  return new Map(policies.map((p) => [p.id, p.title]));
}

function isRemove(action: ModDecision['action']): boolean {
  return (
    action === 'removelink' ||
    action === 'removecomment' ||
    action === 'spamlink' ||
    action === 'spamcomment'
  );
}

function isApprove(action: ModDecision['action']): boolean {
  return action === 'approvelink' || action === 'approvecomment';
}

export function detectDivergence(
  decisions: ModDecision[],
  recs: Recommendation[],
  policies: PolicyObject[]
): DivergenceSignal[] {
  const itemToPolicy = buildItemToPolicy(recs);
  const policyTitles = buildPolicyTitles(policies);
  const groups = new Map<string, { removes: number; approves: number }>();

  for (const d of decisions) {
    const policyId = itemToPolicy.get(d.targetId);
    if (!policyId) continue;
    const g = groups.get(policyId) ?? { removes: 0, approves: 0 };
    if (isRemove(d.action)) g.removes++;
    else if (isApprove(d.action)) g.approves++;
    else continue;
    groups.set(policyId, g);
  }

  const signals: DivergenceSignal[] = [];
  for (const [policyId, { removes, approves }] of groups) {
    const total = removes + approves;
    if (total < MIN_GROUP_SIZE) continue;
    const minority = Math.min(removes, approves);
    const ratio = minority / total;
    if (ratio >= DIVERGENCE_THRESHOLD) {
      signals.push({
        policyId,
        policyTitle: policyTitles.get(policyId) ?? policyId,
        removeCount: removes,
        approveCount: approves,
        divergenceRatio: ratio,
      });
    }
  }
  return signals;
}

export function detectDrift(
  decisions: ModDecision[],
  recs: Recommendation[],
  policies: PolicyObject[]
): DriftSignal[] {
  const itemToPolicy = buildItemToPolicy(recs);
  const policyTitles = buildPolicyTitles(policies);
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  type Stats = {
    allApproves: number;
    allTotal: number;
    recentApproves: number;
    recentTotal: number;
  };
  const groups = new Map<string, Stats>();

  for (const d of decisions) {
    const policyId = itemToPolicy.get(d.targetId);
    if (!policyId) continue;
    if (!isRemove(d.action) && !isApprove(d.action)) continue;
    const s = groups.get(policyId) ?? {
      allApproves: 0,
      allTotal: 0,
      recentApproves: 0,
      recentTotal: 0,
    };
    s.allTotal++;
    if (isApprove(d.action)) s.allApproves++;
    if (d.timestamp >= cutoff) {
      s.recentTotal++;
      if (isApprove(d.action)) s.recentApproves++;
    }
    groups.set(policyId, s);
  }

  const signals: DriftSignal[] = [];
  for (const [policyId, s] of groups) {
    if (s.allTotal < MIN_GROUP_SIZE || s.recentTotal < 3) continue;
    const historicalApproveRate = s.allApproves / s.allTotal;
    const recentApproveRate = s.recentApproves / s.recentTotal;
    const delta = Math.abs(recentApproveRate - historicalApproveRate);
    if (delta >= DRIFT_THRESHOLD) {
      signals.push({
        policyId,
        policyTitle: policyTitles.get(policyId) ?? policyId,
        historicalApproveRate,
        recentApproveRate,
        delta,
      });
    }
  }
  return signals;
}

export function calculateVariance(
  decisions: ModDecision[],
  recs: Recommendation[],
  policies: PolicyObject[]
): VarianceSignal[] {
  const itemToPolicy = buildItemToPolicy(recs);
  const policyTitles = buildPolicyTitles(policies);
  type Stats = { removes: number; approves: number; escalates: number };
  const groups = new Map<string, Stats>();

  for (const d of decisions) {
    const policyId = itemToPolicy.get(d.targetId);
    if (!policyId) continue;
    const s = groups.get(policyId) ?? { removes: 0, approves: 0, escalates: 0 };
    if (isRemove(d.action)) s.removes++;
    else if (isApprove(d.action)) s.approves++;
    groups.set(policyId, s);
  }

  return Array.from(groups.entries())
    .map(([policyId, s]) => {
      const total = s.removes + s.approves + s.escalates;
      return {
        policyId,
        policyTitle: policyTitles.get(policyId) ?? policyId,
        removeRate: total ? s.removes / total : 0,
        approveRate: total ? s.approves / total : 0,
        escalateRate: total ? s.escalates / total : 0,
        sampleSize: total,
      };
    })
    .filter((v) => v.sampleSize >= MIN_GROUP_SIZE);
}
