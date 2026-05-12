import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import type { AIProvider } from '../ai/types';
import { normalizePost } from '../queue/normalizer';
import { saveModItem, getAllModItemIds } from '../storage/mod-item-store';
import { saveEmbedding, getEmbedding } from '../storage/embedding-store';
import { getAllPolicies } from '../storage/policy-store';
import { searchPolicies } from '../policy/searcher';
import { generateRecommendation } from '../recommendations/generator';
import { saveRecommendation } from '../storage/recommendation-store';
import { classifyWithLLM } from '../policy/llm-classifier';
import { cosineSimilarity } from '../utils/cosine';
import type { SuggestedAction } from '../types/recommendation';

/**
 * Called by the PostSubmit trigger for every new post in the subreddit.
 *
 * Pipeline:
 *   1. Normalise the raw Devvit Post into a ModItem
 *   2. Check that subreddit rules are already ingested (policy-refresh must have run)
 *   3. Embed the post text and find the best matching rule via cosine similarity
 *   4. Near-duplicate detection against all stored post embeddings
 *   5. LLM classification — explicitly ask the LLM if the post violates any rule
 *      (catches structural rules like "no posts starting with A" that embeddings miss)
 *   6. Merge embedding + LLM verdicts: LLM takes precedence when it fires
 *   7. If autoActEnabled and confidence ≥ threshold → auto-remove
 *   8. Save the item + embedding + recommendation for the dashboard
 *
 * Errors are caught and logged — the post is never blocked by this function.
 */

/** Cosine similarity threshold for near-duplicate detection (0–1). */
const DUPLICATE_THRESHOLD = 0.92;

/**
 * Scans all stored post embeddings and returns the best match above
 * DUPLICATE_THRESHOLD (excluding the current post itself).
 */
async function findNearDuplicate(
  kv: KVStore,
  currentId: string,
  currentVector: number[]
): Promise<{ id: string; similarity: number } | null> {
  const allIds = await getAllModItemIds(kv);
  let best: { id: string; similarity: number } | null = null;

  for (const id of allIds) {
    if (id === currentId) continue;
    const vec = await getEmbedding(kv, id);
    if (!vec) continue;
    const sim = cosineSimilarity(currentVector, vec);
    if (sim >= DUPLICATE_THRESHOLD && (!best || sim > best.similarity)) {
      best = { id, similarity: sim };
    }
  }
  return best;
}

export async function analyseAndActOnPost(
  post: any,           // Devvit Post object from the trigger event
  kv: KVStore,
  provider: AIProvider, // full provider — we need both embedding and textGen
  reddit: RedditAPIClient,
  autoActEnabled: boolean,
  autoRemoveThreshold: number
): Promise<void> {
  try {
    // 1. Normalise
    const item = normalizePost(post);

    // 2. Guard: skip if no policies are ingested yet
    const policies = await getAllPolicies(kv);
    if (policies.length === 0) {
      console.warn(
        `analyseAndActOnPost: no subreddit rules found in KV for post ${item.id} — ` +
        'run "AMIS: Refresh Policy" first. Saving post for later analysis.'
      );
      await saveModItem(kv, item);
      return;
    }

    // 3. Embed the post
    const text = [item.title, item.body].filter(Boolean).join(' | ');
    const [vector] = await provider.embedding.embed([text]);
    await saveEmbedding(kv, item.id, vector);

    // 4. Near-duplicate detection
    const duplicate = await findNearDuplicate(kv, item.id, vector);

    // 5. Embedding-based policy search
    const matches = await searchPolicies(kv, vector, 3);
    let rec = generateRecommendation(item, matches);

    // 6a. LLM classification — runs in parallel with the above, overrides if it fires
    //     This is the reliable path for structural rules that embeddings can't score.
    try {
      const llmVerdict = await classifyWithLLM(item, policies, provider.textGen);

      if (llmVerdict) {
        console.log(
          `analyseAndActOnPost: LLM verdict for post ${item.id} — ` +
          `violates=${llmVerdict.violates}, confidence=${llmVerdict.confidence}%, ` +
          `rule="${llmVerdict.matchedPolicyTitle ?? 'none'}"`
        );

        if (llmVerdict.violates && llmVerdict.confidence >= 70) {
          // LLM says this post violates a rule — promote to remove regardless of
          // what the embedding search found. Confidence 70+ from the LLM is reliable.
          const llmConfidence = Math.min(100, llmVerdict.confidence);
          rec = {
            ...rec,
            suggestedAction: llmVerdict.confidence >= 90 ? 'remove' : 'monitor',
            riskLevel: llmVerdict.confidence >= 90 ? 'high' : 'medium',
            confidenceScore: llmConfidence,
            matchedPolicyId: llmVerdict.matchedPolicyId ?? rec.matchedPolicyId,
            matchedPolicyTitle: llmVerdict.matchedPolicyTitle ?? rec.matchedPolicyTitle,
            rationale: `[LLM] ${llmVerdict.rationale}`,
          };
        } else if (!llmVerdict.violates && rec.suggestedAction === 'remove') {
          // LLM says it's fine but embeddings said remove — downgrade to monitor
          // so a human can make the final call.
          rec = {
            ...rec,
            suggestedAction: 'monitor',
            riskLevel: 'medium',
            confidenceScore: Math.min(rec.confidenceScore, 60),
            rationale: `[LLM disagrees] Embedding match flagged but LLM found no rule violation. Human review recommended.`,
          };
        }
      }
    } catch (llmErr) {
      // LLM failure is non-fatal — fall through to embedding-only result
      console.warn('analyseAndActOnPost: LLM classification failed, using embedding result:', llmErr);
    }

    // 6b. Override recommendation if this is a near-duplicate
    if (duplicate) {
      console.warn(
        `analyseAndActOnPost: near-duplicate detected — post ${item.id} is ` +
        `${(duplicate.similarity * 100).toFixed(1)}% similar to ${duplicate.id}`
      );
      rec = {
        ...rec,
        suggestedAction: 'escalate',
        riskLevel: 'high',
        confidenceScore: 98,
        rationale:
          `Near-duplicate post detected (${(duplicate.similarity * 100).toFixed(1)}% similar ` +
          `to post ${duplicate.id}). Likely a repost or spam campaign.`,
        isDuplicate: true,
        duplicateOf: duplicate.id,
        duplicateSimilarity: duplicate.similarity,
      };
    }

    // 7. Auto-act if enabled and confidence threshold is met
    let autoActed = false;
    let autoActedAction: SuggestedAction | undefined;

    if (autoActEnabled) {
      if (
        (rec.suggestedAction === 'remove' || rec.suggestedAction === 'escalate') &&
        rec.confidenceScore >= autoRemoveThreshold
      ) {
        await (reddit as any).remove(item.id, false);
        autoActed = true;
        autoActedAction = 'remove';
        console.log(
          `analyseAndActOnPost: AUTO-REMOVED post ${item.id} by u/${item.author} ` +
          `(confidence=${rec.confidenceScore}%, rule="${rec.matchedPolicyTitle ?? (rec.isDuplicate ? 'duplicate' : 'unknown')}")`
        );
      } else if (rec.suggestedAction === 'approve' && rec.confidenceScore >= 80) {
        await (reddit as any).approve(item.id);
        autoActed = true;
        autoActedAction = 'approve';
        console.log(
          `analyseAndActOnPost: AUTO-APPROVED post ${item.id} by u/${item.author} ` +
          `(confidence=${rec.confidenceScore}%, no rule violation detected)`
        );
      }
    }

    // 8. Persist for dashboard display (always, regardless of action taken)
    await saveModItem(kv, item);
    await saveRecommendation(kv, {
      ...rec,
      autoActed,
      autoActedAction,
    });

    console.log(
      `analyseAndActOnPost: analysed post ${item.id} — ` +
      `action=${rec.suggestedAction}, confidence=${rec.confidenceScore}%, ` +
      `rule="${rec.matchedPolicyTitle ?? 'none'}", autoActed=${autoActed}, ` +
      `isDuplicate=${rec.isDuplicate ?? false}`
    );
  } catch (err) {
    // Never block a post submission — log and move on
    console.error('analyseAndActOnPost: unexpected error:', err);
  }
}
