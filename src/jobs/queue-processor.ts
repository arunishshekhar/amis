import type { KVStore } from '@devvit/public-api';
import type { AIProvider } from '../ai/types';
import { fetchModQueue } from '../queue/fetcher';
import { saveModItems } from '../storage/mod-item-store';
import { saveEmbedding } from '../storage/embedding-store';
import { getAllPolicies } from '../storage/policy-store';
import { searchPolicies } from '../policy/searcher';
import { generateRecommendation } from '../recommendations/generator';
import { saveRecommendation } from '../storage/recommendation-store';
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
    if (items.length === 0) {
      console.log('runQueueProcessor: mod queue is empty');
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
        await analyseItem(kv, provider, item, policies);
      } catch (err) {
        console.error(`runQueueProcessor: failed to analyse item ${item.id}:`, err);
        // Continue with remaining items
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
        rec = {
          ...rec,
          suggestedAction: llmVerdict.confidence >= 90 ? 'remove' : 'monitor',
          riskLevel: llmVerdict.confidence >= 90 ? 'high' : 'medium',
          confidenceScore: Math.min(100, llmVerdict.confidence),
          matchedPolicyId: llmVerdict.matchedPolicyId ?? rec.matchedPolicyId,
          matchedPolicyTitle: llmVerdict.matchedPolicyTitle ?? rec.matchedPolicyTitle,
          rationale: `[LLM] ${llmVerdict.rationale}`,
        };
      } else if (!llmVerdict.violates && rec.suggestedAction === 'remove') {
        rec = {
          ...rec,
          suggestedAction: 'monitor',
          riskLevel: 'medium',
          confidenceScore: Math.min(rec.confidenceScore, 60),
          rationale: '[LLM disagrees] Embedding match flagged but LLM found no violation. Human review recommended.',
        };
      }
    }
  } catch (llmErr) {
    console.warn(`runQueueProcessor: LLM failed for ${item.id}, using embedding result:`, llmErr);
  }

  await saveRecommendation(kv, rec);
}
