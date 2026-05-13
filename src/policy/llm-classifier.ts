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

## Reddit post anatomy
- "Title" is the headline / subject of the post.
- "Body" (also called Description or selftext) is the main written content below the title.
When a rule says "description", it refers to the Body field.

## How to evaluate rules

### Structural / formatting rules (check the post text directly)
- "No titles starting with A" → check if Title begins with the letter A (case-insensitive).
- "No descriptions starting with C" → check if Body begins with the letter C.
- Apply these character/word rules literally and strictly.

### Factual accuracy rules (actively reason about truth)
If a rule says anything like:
  "no misinformation", "no lies", "no false facts", "known facts must be correct",
  "make sure facts are not lied about", or similar —
then you MUST actively verify whether the post's claims are factually correct.
Do NOT just check if the rule text matches the post text.
Instead, use your knowledge to determine if the claim is true or false.

Examples of factual violations you must catch:
  - "2 + 2 = 5"   → FALSE (2+2=4). Violates a factual accuracy rule.
  - "The Earth is flat" → FALSE. Violates a factual accuracy rule.
  - "Water boils at 50°C at sea level" → FALSE (it boils at 100°C). Violates.
  - "The sun rises in the east" → TRUE. Does NOT violate.
  - "Paris is the capital of France" → TRUE. Does NOT violate.

If you are unsure whether a claim is true, set confidence lower (50–70) and still flag it.

## Output format
Respond ONLY with a single valid JSON object — no markdown, no explanation outside the JSON.

{
  "violates": true | false,
  "matchedRuleId": "<rule id or null>",
  "matchedRuleTitle": "<rule title or null>",
  "confidence": <0-100 integer>,
  "rationale": "<one sentence explaining your decision>"
}

## General rules
- Be strict. Flag clear violations confidently (90-100).
- "confidence" reflects certainty: 95+ = very certain, 70-89 = likely, 50-69 = unsure.
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
    .map((p) => {
      const description = p.metadata?.description ?? '';
      const lines = [
        `ID: ${p.id}`,
        `Title: ${p.title}`,
      ];
      // Include the mod's description if it adds detail beyond the title
      if (description && description !== p.title) {
        lines.push(`Description: ${description}`);
      }
      lines.push(`Full Rule Text: ${p.text}`);
      return lines.join('\n');
    })
    .join('\n\n');


  const userPrompt =
    `SUBREDDIT RULES:\n${rulesBlock}\n\n` +
    `POST TO EVALUATE:\n` +
    `Title: ${item.title}\n` +
    `Body / Description: ${item.body || '(no body)'}\n` +
    `Author: u/${item.author}`;

  // Log what we're about to send so wrong verdicts can be diagnosed
  console.log(
    `llm-classifier: evaluating ${item.id} ` +
    `title="${item.title.slice(0, 60)}" ` +
    `body="${(item.body || '').slice(0, 60)}" ` +
    `against ${relevantPolicies.length} rule(s): ` +
    relevantPolicies.map((p) => `"${p.title}"`).join(', ')
  );

  try {
    const raw = await textGen.complete(SYSTEM_PROMPT, userPrompt);

    // Log raw response so wrong verdicts can be diagnosed in Devvit logs
    console.log(`llm-classifier: raw response for ${item.id}: ${raw.slice(0, 300)}`);

    // Strip any markdown code fences the model may have added
    const cleaned = raw.replace(/```(?:json)?/g, '').trim();

    // Extract the first {...} block in case the model prepended text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('llm-classifier: no JSON object found in response:', raw.slice(0, 300));
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
