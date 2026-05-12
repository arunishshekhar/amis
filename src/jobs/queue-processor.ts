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
  reddit: any,
  /** When true (manual Refresh), re-analyse posts previously cached as 'approve'
   *  so threshold/rule changes take effect. Scheduled runs leave this false. */
  forceReprocess = false
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
      for (const item of items) {
        await embedAndSave(kv, provider, item);
      }
      return;
    }

    // 4. Determine which items actually need (re-)analysis.
    //    Actioned items are ALWAYS skipped — no exception, no overrides.
    //    Unchanged items are skipped unless forceReprocess is on AND the cached
    //    result was 'approve' (to re-evaluate with a new LLM key).
    const toProcess: ModItem[] = [];
    const existingRecs = await Promise.all(items.map((i) => getRecommendation(kv, i.id)));

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const existingRec = existingRecs[i];

      // Rule 1: actioned = permanently done. Never touch again.
      if (existingRec?.actionedAt) {
        console.log(`runQueueProcessor: skipping actioned item ${item.id}`);
        continue;
      }

      // Rule 2: unchanged items are skipped unless manually refreshed with a new LLM key
      const lastChanged = Math.max(item.editedAt ?? 0, item.timestamp);
      const isFreshEnough = existingRec && existingRec.generatedAt >= lastChanged;
      const wasCachedApprove = existingRec?.suggestedAction === 'approve';
      if (isFreshEnough && !(forceReprocess && wasCachedApprove)) {
        console.log(`runQueueProcessor: skipping unchanged item ${item.id}`);
        continue;
      }

      toProcess.push(item);
    }

    if (toProcess.length === 0) {
      console.log('runQueueProcessor: nothing new to analyse');
    } else {
      console.log(`runQueueProcessor: analysing ${toProcess.length} item(s) in batch`);

      // 5. Batch-embed all items that need processing — one API call for all.
      const texts = toProcess.map(
        (item) => [item.title, item.body, ...item.reportReasons].filter(Boolean).join(' | ')
      );
      let vectors: number[][];
      try {
        vectors = await provider.embedding.embed(texts);
      } catch (embedErr) {
        console.error('runQueueProcessor: batch embed failed:', embedErr);
        vectors = toProcess.map(() => []); // empty vectors fall through to approve
      }

      // 6. For each item: cosine policy search → skip LLM if below threshold → LLM classify.
      for (let i = 0; i < toProcess.length; i++) {
        const item = toProcess[i];
        const vector = vectors[i];
        try {
          await saveEmbedding(kv, item.id, vector);
          await analyseItemWithVector(kv, provider, item, policies, vector);
          // Small inter-item pause to stay within Devvit's outbound HTTP rate limit
          if (i < toProcess.length - 1) await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(`runQueueProcessor: failed to analyse item ${item.id}:`, err);
        }
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

/**
 * Full analysis pipeline for a single mod-queue item using a pre-computed embedding vector.
 * The vector is computed upstream in a batch call to avoid N individual embed requests.
 * LLM is only called when embedding similarity is >= 0.60 — below that the post is
 * auto-approved without hitting the LLM at all.
 */
async function analyseItemWithVector(
  kv: KVStore,
  provider: AIProvider,
  item: ModItem,
  policies: Awaited<ReturnType<typeof getAllPolicies>>,
  vector: number[]
): Promise<void> {
  // Embedding-based policy search → base recommendation
  const matches = vector.length > 0 ? await searchPolicies(kv, vector, 3) : [];
  let rec = generateRecommendation(item, matches);

  // Always run LLM — it is the authoritative classifier.
  // Embedding finds the closest matching rule but cannot detect factual falsehoods
  // or structural rules (e.g. "no posts starting with A", "no misinformation")
  // where vocabulary overlap with the post text is near zero.
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
      } else if (!llmVerdict.violates) {
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
    // LLM unavailable — fall back to embedding-only result with stricter threshold
    if (rec.suggestedAction === 'remove' && rec.similarity < 0.75) {
      rec = {
        ...rec,
        suggestedAction: 'monitor',
        riskLevel: 'medium',
        confidenceScore: Math.min(rec.confidenceScore, 55),
        rationale: rec.rationale + ' (LLM unavailable — human review required)',
      };
    }
    console.warn(`runQueueProcessor: LLM failed for ${item.id}:`, llmErr);
  }

  await saveRecommendation(kv, rec);
}
