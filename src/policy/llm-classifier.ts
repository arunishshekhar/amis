import type { TextGenerationClient } from '../ai/types';
import type { PolicyObject } from '../types/policy-object';
import type { ModItem } from '../types/mod-item';

export interface LLMVerdict {
  violates: boolean;
  matchedPolicyId: string | null;
  matchedPolicyTitle: string | null;
  confidence: number; // 0–100
  rationale: string;
}

const SYSTEM_PROMPT = `You are a strict subreddit moderation assistant.
You will be given a list of subreddit rules and a post to evaluate.
Your job is to determine whether the post violates any of the rules.

Respond ONLY with a single valid JSON object — no markdown, no explanation outside the JSON.

Format:
{
  "violates": true | false,
  "matchedRuleId": "<rule id or null>",
  "matchedRuleTitle": "<rule title or null>",
  "confidence": <0-100 integer>,
  "rationale": "<one sentence>"
}

Rules:
- Be strict. If a rule says "no posts starting with A" and the post title starts with "A", it violates.
- "confidence" should reflect how certain you are (95+ = very certain).
- If no rule is violated, set violates=false, matchedRuleId=null, matchedRuleTitle=null, confidence=95.`;

/**
 * Uses the LLM to explicitly classify whether a post violates any subreddit rule.
 * This is the reliable fallback for structural/syntactic rules where cosine
 * similarity between the post and the rule text would be near zero.
 *
 * Returns null if the LLM call fails (caller should fall back to embedding-only logic).
 */
export async function classifyWithLLM(
  item: ModItem,
  policies: PolicyObject[],
  textGen: TextGenerationClient
): Promise<LLMVerdict | null> {
  // Only use rules and automod sources — skip wiki/removal_reason chunks to keep
  // the prompt short and focused on actionable rules.
  const relevantPolicies = policies.filter(
    (p) => p.source === 'rule' || p.source === 'automod'
  );

  if (relevantPolicies.length === 0) return null;

  const rulesBlock = relevantPolicies
    .map((p) => `ID: ${p.id}\nTitle: ${p.title}\nDescription: ${p.text}`)
    .join('\n\n');

  const userPrompt =
    `SUBREDDIT RULES:\n${rulesBlock}\n\n` +
    `POST TO EVALUATE:\n` +
    `Title: ${item.title}\n` +
    `Body: ${item.body || '(no body)'}\n` +
    `Author: u/${item.author}`;

  try {
    const raw = await textGen.complete(SYSTEM_PROMPT, userPrompt);

    // Strip any markdown code fences the model may have added
    const cleaned = raw.replace(/```(?:json)?/g, '').trim();

    // Extract the first {...} block in case the model prepended text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('llm-classifier: no JSON object found in response:', raw.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(match[0]) as {
      violates: boolean;
      matchedRuleId: string | null;
      matchedRuleTitle: string | null;
      confidence: number;
      rationale: string;
    };

    return {
      violates: Boolean(parsed.violates),
      matchedPolicyId: parsed.matchedRuleId ?? null,
      matchedPolicyTitle: parsed.matchedRuleTitle ?? null,
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      rationale: String(parsed.rationale ?? ''),
    };
  } catch (err) {
    console.warn('llm-classifier: failed to parse LLM response:', err);
    return null;
  }
}
