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
 * (embed → classify → generate recommendation) for each item, and saves
 * everything to KV so the dashboard can display it.
 *
 * Two-tier classification for cost efficiency:
 *   Tier 1 (embedding-only, no LLM): similarity < 0.45 (auto-approve) or >= 0.85 (auto-flag)
 *   Tier 2 (LLM required): 0.45 <= similarity < 0.85, or post is reported by users
 *
 * This runs both as a scheduled job (every 2 min) and when the dashboard "Refresh" is pressed.
 */
export async function runQueueProcessor(
  subredditName: string,
  kv: KVStore,
  provider: AIProvider,
  reddit: any
): Promise<void> {
  try {
    // 1. Fetch the current mod queue (already filtered to 7-day window for unmoderated)
    const items = await fetchModQueue(reddit, subredditName);
    const activeIds = new Set(items.map((i) => i.id));

    // 2. Purge recommendations for posts no longer in the mod queue.
    //    Actioned and auto-acted items are preserved as history.
    await purgeStaleRecommendations(kv, activeIds);

    if (items.length === 0) {
      console.log('runQueueProcessor: mod queue is empty — dashboard cleared');
      return;
    }

    // 3. Persist mod items first so the dashboard can show them even if analysis fails
    await saveModItems(kv, items);

    // 4. Load policies (needed for embedding search and LLM classification)
    const policies = await getAllPolicies(kv);
    if (policies.length === 0) {
      console.warn('runQueueProcessor: no policies found — run "AMIS: Refresh Policy" first');
      for (const item of items) {
        await embedAndSave(kv, provider, item);
      }
      return;
    }

    // 5. Determine which items need (re-)analysis.
    //    Rule 1: actioned by mod = permanently done. Silent skip.
    //    Rule 2: non-approve verdict fresh since last edit → skip.
    //    Rule 3: approve verdict < 24h old → skip (re-check after 24h).
    //            Prevents re-running the LLM every 2 min on stale approved posts.
    const APPROVE_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

    const toProcess: ModItem[] = [];
    const existingRecs = await Promise.all(items.map((i) => getRecommendation(kv, i.id)));

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const existingRec = existingRecs[i];

      // Rule 1: mod-actioned → never re-analyse
      if (existingRec?.actionedAt) continue;

      const lastChanged = Math.max(item.editedAt ?? 0, item.timestamp);

      // Rule 2: non-approve verdict fresh since last edit → skip
      const hasNonApproveVerdict =
        existingRec &&
        existingRec.suggestedAction !== 'approve' &&
        existingRec.generatedAt >= lastChanged;
      if (hasNonApproveVerdict) {
        console.log(`runQueueProcessor: skipping unchanged item ${item.id}`);
        continue;
      }

      // Rule 3: approve verdict < 24h → skip
      const verdictAgeMs = existingRec ? Date.now() - existingRec.generatedAt : Infinity;
      if (existingRec?.suggestedAction === 'approve' && verdictAgeMs < APPROVE_CACHE_MS) continue;

      toProcess.push(item);
    }

    if (toProcess.length === 0) {
      console.log('runQueueProcessor: nothing new to analyse');
    } else {
      // Process up to 5 items per run. Retry-with-backoff in AI clients handles rate-limits.
      const BATCH_CAP = 5;
      const batch = toProcess.slice(0, BATCH_CAP);
      console.log(
        `runQueueProcessor: analysing ${batch.length} of ${toProcess.length} item(s) ` +
        `(${toProcess.length > BATCH_CAP ? String(toProcess.length - BATCH_CAP) + ' deferred' : 'all'})`
      );

      // 6. Batch-embed all items — 1 API call for all texts (much cheaper than N calls)
      const texts = batch.map(
        (item) => [item.title, item.body, ...item.reportReasons].filter(Boolean).join(' | ')
      );
      let vectors: number[][];
      try {
        vectors = await provider.embedding.embed(texts);
        // Brief pause after embed so Devvit's HTTP rate-limit window can reset
        await new Promise((r) => setTimeout(r, 2000));
      } catch (embedErr) {
        console.error('runQueueProcessor: batch embed failed:', embedErr);
        vectors = batch.map(() => []);
      }

      // 7. Analyse each item: cosine search → optional LLM classify.
      //    3-second gap between items keeps us under Devvit's outbound HTTP limit.
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const vector = vectors[i];
        try {
          await saveEmbedding(kv, item.id, vector);
          await analyseItemWithVector(kv, provider, item, policies, vector);
          if (i < batch.length - 1) await new Promise((r) => setTimeout(r, 3000));
        } catch (err) {
          console.error(`runQueueProcessor: failed to analyse item ${item.id}:`, err);
        }
      }
      if (toProcess.length > BATCH_CAP) {
        console.log(`runQueueProcessor: ${String(toProcess.length - BATCH_CAP)} item(s) deferred to next run`);
      }
    }

    console.log(`runQueueProcessor: processed ${String(items.length)} items from mod queue`);
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
 * Full analysis pipeline for a single mod-queue item.
 *
 * TWO-TIER CLASSIFICATION (cost optimisation for high-volume subreddits):
 *   Tier 1 — embedding-only (no LLM, very cheap):
 *     similarity < 0.45  → post is far from any rule → auto-approve
 *     similarity >= 0.85 → very strong rule match → trust embedding verdict
 *   Tier 2 — LLM required (0.45 <= similarity < 0.85, or post is reported):
 *     Ambiguous zone or actively-reported post → call LLM for definitive verdict
 *
 * Saves ~60-70% of LLM calls on high-volume subreddits while keeping LLM as
 * the authoritative judge for edge cases and structural rules.
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

  // Decide whether the LLM is needed based on embedding confidence
  const isReported = item.reportReasons.length > 0;
  const sim = rec.similarity;

  // LLM needed only for: reported posts, OR ambiguous similarity zone
  const needsLLM = isReported || (sim >= 0.45 && sim < 0.85);

  if (!needsLLM) {
    // Tier 1: trust the embedding result directly — no LLM call
    console.log(
      `runQueueProcessor: embedding-only for ${item.id} ` +
      `(sim=${sim.toFixed(2)}, reported=${String(isReported)}) → ${rec.suggestedAction}`
    );
  } else {
    // Tier 2: call LLM for definitive verdict
    try {
      const llmVerdict = await classifyWithLLM(item, policies, provider.textGen);
      if (llmVerdict) {
        console.log(
          `runQueueProcessor: LLM verdict for ${item.id} — ` +
          `violates=${String(llmVerdict.violates)}, confidence=${String(llmVerdict.confidence)}%, ` +
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
      // LLM unavailable — fall back to embedding result with stricter threshold
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
  }

  await saveRecommendation(kv, rec);
}
