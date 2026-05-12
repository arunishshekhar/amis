import type { KVStore } from '@devvit/public-api';
import type { AIProvider } from '../ai/types';
import { fetchModQueue } from '../queue/fetcher';
import { saveModItems } from '../storage/mod-item-store';
import { saveEmbedding } from '../storage/embedding-store';
import { getAllPolicies } from '../storage/policy-store';
import { searchPolicies } from '../policy/searcher';
import { generateRecommendation } from '../recommendations/generator';
import { saveRecommendation, purgeStaleRecommendations, getRecommendation } from '../storage/recommendation-store';
import { classifyWithLLM } from '../policy/llm-classifier';
import type { ModItem } from '../types/mod-item';

/**
 * Fetches the current mod queue from Reddit, runs the full analysis pipeline
 * (embed → LLM classify → generate recommendation) for each item, and saves
 * everything to KV so the dashboard can display it.
 *
 * This runs both as a scheduled job (every 6 h) and when the dashboard
 * "Refresh" button is pressed.
 */
export async function runQueueProcessor(
  subredditName: string,
  kv: KVStore,
  provider: AIProvider,
  reddit: any
): Promise<void> {
  try {
    // 1. Fetch the current mod queue
    const items = await fetchModQueue(reddit, subredditName);
    const activeIds = new Set(items.map((i) => i.id));

    // 2. Purge recommendations for posts that are no longer in the mod queue
    //    (deleted by author, or already actioned by a moderator).
    //    This runs even if the queue is empty so the dashboard clears correctly.
    await purgeStaleRecommendations(kv, activeIds);

    if (items.length === 0) {
      console.log('runQueueProcessor: mod queue is empty — dashboard cleared');
      return;
    }

    // 2. Persist mod items first (so they are available to the dashboard even
    //    if the analysis below fails partway through)
    await saveModItems(kv, items);

    // 3. Load policies (needed for both embedding search and LLM classification)
    const policies = await getAllPolicies(kv);
    if (policies.length === 0) {
      console.warn('runQueueProcessor: no policies found — run "AMIS: Refresh Policy" first');
      // Still save embeddings so duplicate detection works later
      await Promise.all(items.map((item) => embedAndSave(kv, provider, item)));
      return;
    }

    // 4. Analyse each item: embed → cosine search → LLM classify → recommendation
    //    We process sequentially to avoid hammering the AI APIs simultaneously.
    for (const item of items) {
      try {
        const existingRec = await getRecommendation(kv, item.id);

        // 1. Always skip items a moderator has already actioned.
        //    Never overwrite actionedAt — that would make the post reappear.
        if (existingRec?.actionedAt) {
          console.log(`runQueueProcessor: skipping actioned item ${item.id}`);
          continue;
        }

        // 2. Skip unchanged items (post hasn't been edited since last analysis)
        const lastChanged = Math.max(item.editedAt ?? 0, item.timestamp);
        if (existingRec && existingRec.generatedAt >= lastChanged) {
          console.log(`runQueueProcessor: skipping unchanged item ${item.id}`);
          continue;
        }

        await analyseItem(kv, provider, item, policies);
      } catch (err) {
        console.error(`runQueueProcessor: failed to analyse item ${item.id}:`, err);
      }
    }

    console.log(`runQueueProcessor: processed ${items.length} items from mod queue`);
  } catch (err) {
    console.error('runQueueProcessor failed:', err);
    throw err;
  }
}

/** Embed one item and save its vector (used when policies aren't loaded yet). */
async function embedAndSave(kv: KVStore, provider: AIProvider, item: ModItem): Promise<void> {
  const text = [item.title, item.body, ...item.reportReasons].filter(Boolean).join(' | ');
  const [vector] = await provider.embedding.embed([text]);
  await saveEmbedding(kv, item.id, vector);
}

/** Full analysis pipeline for a single mod-queue item. */
async function analyseItem(
  kv: KVStore,
  provider: AIProvider,
  item: ModItem,
  policies: Awaited<ReturnType<typeof getAllPolicies>>
): Promise<void> {
  // Embed
  const text = [item.title, item.body, ...item.reportReasons].filter(Boolean).join(' | ');
  const [vector] = await provider.embedding.embed([text]);
  await saveEmbedding(kv, item.id, vector);

  // Embedding-based policy search → base recommendation
  const matches = await searchPolicies(kv, vector, 3);
  let rec = generateRecommendation(item, matches);

  // LLM classification — reliable judge for structural/syntactic rules
  try {
    const llmVerdict = await classifyWithLLM(item, policies, provider.textGen);
    if (llmVerdict) {
      console.log(
        `runQueueProcessor: LLM verdict for ${item.id} — ` +
        `violates=${llmVerdict.violates}, confidence=${llmVerdict.confidence}%, ` +
        `rule="${llmVerdict.matchedPolicyTitle ?? 'none'}"`
      );

      if (llmVerdict.violates && llmVerdict.confidence >= 70) {
        // LLM confirmed a violation — use its verdict
        rec = {
          ...rec,
          suggestedAction: llmVerdict.confidence >= 90 ? 'remove' : 'monitor',
          riskLevel: llmVerdict.confidence >= 90 ? 'high' : 'medium',
          confidenceScore: Math.min(100, llmVerdict.confidence),
          matchedPolicyId: llmVerdict.matchedPolicyId ?? rec.matchedPolicyId,
          matchedPolicyTitle: llmVerdict.matchedPolicyTitle ?? rec.matchedPolicyTitle,
          rationale: `[LLM] ${llmVerdict.rationale}`,
        };
      } else if (!llmVerdict.violates) {
        // LLM says no violation — trust it and approve regardless of embedding score
        rec = {
          ...rec,
          suggestedAction: 'approve',
          riskLevel: 'low',
          confidenceScore: llmVerdict.confidence,
          rationale: `[LLM] ${llmVerdict.rationale}`,
        };
      }
    }
  } catch (llmErr) {
    // LLM failed — apply a stricter threshold on the embedding-only result
    // to avoid false positives. Require similarity >= 0.75 to suggest remove;
    // anything lower is demoted to monitor so humans make the final call.
    if (rec.suggestedAction === 'remove' && rec.similarity < 0.75) {
      rec = {
        ...rec,
        suggestedAction: 'monitor',
        riskLevel: 'medium',
        confidenceScore: Math.min(rec.confidenceScore, 55),
        rationale: rec.rationale + ' (LLM unavailable — human review required)',
      };
    }
    console.warn(`runQueueProcessor: LLM failed for ${item.id}, using embedding result:`, llmErr);
  }

  await saveRecommendation(kv, rec);
}
