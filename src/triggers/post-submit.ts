import type { KVStore, RedditAPIClient } from '@devvit/public-api';
import type { EmbeddingClient } from '../ai/types';
import { normalizePost } from '../queue/normalizer';
import { saveModItem } from '../storage/mod-item-store';
import { saveEmbedding } from '../storage/embedding-store';
import { getAllPolicies } from '../storage/policy-store';
import { searchPolicies } from '../policy/searcher';
import { generateRecommendation } from '../recommendations/generator';
import { saveRecommendation } from '../storage/recommendation-store';
import type { SuggestedAction } from '../types/recommendation';

/**
 * Called by the PostSubmit trigger for every new post in the subreddit.
 *
 * Pipeline:
 *   1. Normalise the raw Devvit Post into a ModItem
 *   2. Check that subreddit rules are already ingested (policy-refresh must have run)
 *   3. Embed the post text and find the best matching rule
 *   4. Generate a moderation recommendation (reuses existing heuristics)
 *   5. If autoActEnabled and confidence ≥ threshold → auto-remove
 *   6. Save the item + embedding + recommendation for the dashboard
 *
 * Errors are caught and logged — the post is never blocked by this function.
 */
export async function analyseAndActOnPost(
  post: any,  // Devvit Post object from the trigger event
  kv: KVStore,
  embeddingClient: EmbeddingClient,
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
    const [vector] = await embeddingClient.embed([text]);
    await saveEmbedding(kv, item.id, vector);

    // 4. Find matching subreddit rules and generate recommendation
    const matches = await searchPolicies(kv, vector, 3);
    const rec = generateRecommendation(item, matches);

    // 5. Auto-act if enabled and confidence threshold is met
    let autoActed = false;
    let autoActedAction: SuggestedAction | undefined;

    if (autoActEnabled) {
      if (
        (rec.suggestedAction === 'remove' || rec.suggestedAction === 'escalate') &&
        rec.confidenceScore >= autoRemoveThreshold
      ) {
        // Auto-remove: the post violates a subreddit rule with high confidence
        await (reddit as any).remove(item.id, false);
        autoActed = true;
        autoActedAction = 'remove';
        console.log(
          `analyseAndActOnPost: AUTO-REMOVED post ${item.id} by u/${item.author} ` +
          `(confidence=${rec.confidenceScore}%, rule="${rec.matchedPolicyTitle ?? 'unknown'}", ` +
          `similarity=${rec.similarity.toFixed(3)})`
        );
      } else if (rec.suggestedAction === 'approve' && rec.confidenceScore >= 80) {
        // Post clearly matches no rule — approve it to clear it from unreviewed queue
        await (reddit as any).approve(item.id);
        autoActed = true;
        autoActedAction = 'approve';
        console.log(
          `analyseAndActOnPost: AUTO-APPROVED post ${item.id} by u/${item.author} ` +
          `(confidence=${rec.confidenceScore}%, no rule violation detected)`
        );
      }
    }

    // 6. Persist for dashboard display (always, regardless of action taken)
    await saveModItem(kv, item);
    await saveRecommendation(kv, {
      ...rec,
      autoActed,
      autoActedAction,
    });

    console.log(
      `analyseAndActOnPost: analysed post ${item.id} — ` +
      `action=${rec.suggestedAction}, confidence=${rec.confidenceScore}%, ` +
      `rule="${rec.matchedPolicyTitle ?? 'none'}", autoActed=${autoActed}`
    );
  } catch (err) {
    // Never block a post submission — log and move on
    console.error('analyseAndActOnPost: unexpected error:', err);
  }
}
