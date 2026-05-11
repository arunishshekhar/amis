import type { ModItem } from '../types/mod-item';
import type { PolicyObject } from '../types/policy-object';
import type { Recommendation, SuggestedAction, RiskLevel } from '../types/recommendation';

export function generateRecommendation(
  item: ModItem,
  policyMatches: Array<{ policy: PolicyObject; similarity: number }>
): Recommendation {
  const best = policyMatches.length > 0 ? policyMatches[0] : null;
  const similarity = best?.similarity ?? 0;
  const policy = best?.policy ?? null;

  let action: SuggestedAction;
  let risk: RiskLevel;
  let rawConfidence: number;

  if (!best || similarity < 0.50) {
    action = 'approve';
    risk = 'low';
    rawConfidence = 80;
  } else if (similarity >= 0.85) {
    action = 'remove';
    risk = 'high';
    rawConfidence = 75 + similarity * 25;
  } else if (similarity >= 0.70) {
    action = 'remove';
    risk = 'medium';
    rawConfidence = 50 + similarity * 30;
  } else {
    // 0.50 <= similarity < 0.70
    action = 'monitor';
    risk = 'medium';
    rawConfidence = 30 + similarity * 20;
  }

  // Escalation override: high report volume + meaningful policy match
  if (item.reportReasons.length >= 3 && best && similarity >= 0.50) {
    action = 'escalate';
    rawConfidence += 10;
  }

  const confidenceScore = Math.min(100, Math.round(rawConfidence));
  const pct = Math.round(similarity * 100);

  let rationale: string;
  if (action === 'approve') {
    rationale = 'No strong policy match found. Content appears within guidelines.';
  } else if (action === 'escalate') {
    rationale = `High report volume with policy match — warrants moderator escalation: "${policy!.title}" (${pct}% match).`;
  } else if (action === 'remove') {
    rationale = `Likely violates "${policy!.title}". Matched at ${pct}% similarity. Risk level: ${risk}.`;
  } else {
    // monitor
    rationale = `Possible concern: "${policy!.title}" (${pct}% match). Review before taking action.`;
  }

  return {
    itemId: item.id,
    suggestedAction: action,
    confidenceScore,
    riskLevel: risk,
    matchedPolicyId: policy?.id ?? null,
    matchedPolicyTitle: policy?.title ?? null,
    similarity,
    rationale,
    generatedAt: Date.now(),
  };
}
