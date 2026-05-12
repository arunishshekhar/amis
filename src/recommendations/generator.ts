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

  if (!best || similarity < 0.60) {
    // No meaningful policy match — content appears within guidelines
    action = 'approve';
    risk = 'low';
    rawConfidence = 80;
  } else if (similarity >= 0.75) {
    // Strong match — high confidence the post violates a rule
    action = 'remove';
    risk = 'high';
    rawConfidence = 60 + similarity * 40; // 90 at 0.75, 100 at 1.0
  } else if (similarity >= 0.65) {
    // Moderate match — likely violation, recommend removal
    action = 'remove';
    risk = 'medium';
    rawConfidence = 40 + similarity * 50; // 72.5 at 0.65, 77.5 at 0.75
  } else {
    // 0.60 <= similarity < 0.65 — borderline, needs human review
    action = 'monitor';
    risk = 'medium';
    rawConfidence = 20 + similarity * 40; // 44 at 0.60, 46 at 0.65
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
