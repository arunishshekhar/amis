import express from 'express';
import {
  createServer,
  context,
  getServerPort,
  reddit,
  scheduler,
  settings,
} from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';

import { createAIProvider } from '../ai/provider.js';
import { runQueueProcessor } from '../jobs/queue-processor.js';
import { runPolicyRefresh } from '../triggers/policy-refresh.js';
import { runRecommendationEngine } from '../recommendations/engine.js';
import { analyseAndActOnPost } from '../triggers/post-submit.js';
import { KEYS } from '../storage/keys.js';
import { getAllRecommendations, getHistoryRecommendations, markActioned } from '../storage/recommendation-store.js';
import { listInsights, acknowledgeInsight } from '../storage/insight-store.js';
import { getModItem } from '../storage/mod-item-store.js';
import { getAIConfig, saveAIConfig } from '../storage/ai-config-store.js';
import { saveDecision } from '../storage/mod-decision-store.js';
import { sortItemsByRisk } from '../shared/dashboard-helpers.js';
import { makeKvStore } from './kv-adapter.js';
import type { AIConfig } from '../storage/ai-config-store.js';

function publicAIConfig(config: AIConfig | null): Record<string, string | boolean> | null {
  if (!config) return null;
  return {
    provider: config.provider ?? 'openai',
    apiKeyConfigured: Boolean(config.apiKey),
    voyageApiKeyConfigured: Boolean(config.voyageApiKey),
    customApiBaseUrl: config.customApiBaseUrl ?? '',
    customModel: config.customModel ?? '',
    fullscreenEnabled: Boolean(config.fullscreenEnabled),
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

const router = express.Router();

// ---------------------------------------------------------------------------
// Dashboard data API
// ---------------------------------------------------------------------------

router.get('/api/dashboard', async (_req, res) => {
  try {
    const kv = makeKvStore();
    const [rawRecs, rawInsights, rawHistory, rawAiConfig, rawAiProvider] = await Promise.all([
      getAllRecommendations(kv as any),
      listInsights(kv as any),
      getHistoryRecommendations(kv as any),
      getAIConfig(kv as any),
      settings.get<string>('AI_PROVIDER'),
    ]);

    const aiApprovedCount = rawRecs.filter(
      (r) => r.suggestedAction === 'approve' && !r.actionedAt
    ).length;
    const actionable = rawRecs.filter(
      (r) => r.suggestedAction !== 'approve' && !r.actionedAt
    );
    const sortedRecs = sortItemsByRisk(actionable);

    // Load mod items for the triage queue
    const modItems: Record<string, unknown> = {};
    await Promise.all(
      sortedRecs.map(async (rec) => {
        const item = await getModItem(kv as any, rec.itemId);
        if (item) modItems[rec.itemId] = item;
      })
    );

    // Load mod items for history
    const allModItems: Record<string, unknown> = { ...modItems };
    await Promise.all(
      rawHistory.map(async (rec) => {
        if (!allModItems[rec.itemId]) {
          const item = await getModItem(kv as any, rec.itemId);
          if (item) allModItems[rec.itemId] = item;
        }
      })
    );

    res.json({
      recs: sortedRecs,
      aiApprovedCount,
      modItems,
      allModItems,
      insights: rawInsights,
      history: rawHistory,
      aiProvider: rawAiConfig?.provider ?? (rawAiProvider as string | undefined) ?? 'openai',
      aiConfig: publicAIConfig(rawAiConfig),
      subredditName: context.subredditName ?? '',
    });
  } catch (err) {
    console.error('/api/dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// ---------------------------------------------------------------------------
// Action API: remove / approve / escalate / acknowledge
// ---------------------------------------------------------------------------

router.post('/api/action', async (req, res) => {
  try {
    const { type, id } = req.body as { type: string; id: string };
    const kv = makeKvStore();
    const actor = context.userId ?? 'moderator';
    const subredditName = context.subredditName ?? '';

    if (type === 'remove') {
      await Promise.all([
        markActioned(kv as any, id, 'remove', actor),
        (reddit as any).remove(id, false),
        saveDecision(kv as any, {
          targetId: id,
          action: 'removelink',
          moderator: actor,
          timestamp: Date.now(),
          subredditId: subredditName,
        }),
      ]);
    } else if (type === 'approve') {
      await Promise.all([
        markActioned(kv as any, id, 'approve', actor),
        (reddit as any).approve(id),
        saveDecision(kv as any, {
          targetId: id,
          action: 'approvelink',
          moderator: actor,
          timestamp: Date.now(),
          subredditId: subredditName,
        }),
      ]);
    } else if (type === 'escalate') {
      await Promise.all([
        kv.put(KEYS.escalation(id), 'true'),
        markActioned(kv as any, id, 'escalate', actor),
      ]);
    } else if (type === 'acknowledge') {
      await acknowledgeInsight(kv as any, id);
    } else {
      res.status(400).json({ error: 'Unknown action type' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/action error:', err);
    res.status(500).json({ error: 'Action failed' });
  }
});

// ---------------------------------------------------------------------------
// AI Config API
// ---------------------------------------------------------------------------

router.get('/api/ai-config', async (_req, res) => {
  try {
    const kv = makeKvStore();
    const cfg = await getAIConfig(kv as any);
    res.json(publicAIConfig(cfg) ?? {});
  } catch (err) {
    console.error('/api/ai-config GET error:', err);
    res.status(500).json({ error: 'Failed to get AI config' });
  }
});

router.post('/api/ai-config', async (req, res) => {
  try {
    const kv = makeKvStore();
    const body = req.body as Partial<AIConfig>;
    const existing = await getAIConfig(kv as any);
    const apiKey = body.apiKey?.trim();
    const voyageApiKey = body.voyageApiKey?.trim();
    const config: AIConfig = {
      provider: (body.provider ?? 'openai').trim(),
      apiKey: apiKey || existing?.apiKey || '',
      voyageApiKey: voyageApiKey || existing?.voyageApiKey || undefined,
      customApiBaseUrl: body.customApiBaseUrl?.trim() || existing?.customApiBaseUrl,
      customModel: body.customModel?.trim() || existing?.customModel,
      fullscreenEnabled: body.fullscreenEnabled ?? false,
    };
    await saveAIConfig(kv as any, config);
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/ai-config POST error:', err);
    res.status(500).json({ error: 'Failed to save AI config' });
  }
});

// ---------------------------------------------------------------------------
// Trigger endpoints
// ---------------------------------------------------------------------------

router.post('/internal/triggers/post-submit', async (req, res) => {
  try {
    const event = req.body as any;
    const post = event?.post;
    const subredditName = context.subredditName;
    if (!post || !subredditName) {
      res.json({ ok: true });
      return;
    }
    const kv = makeKvStore();
    const provider = await createAIProvider(settings as any, kv as any);
    const autoActEnabled = (await settings.get<boolean>('AUTO_ACT_ENABLED')) ?? false;
    const rawThreshold = await settings.get<number>('AUTO_REMOVE_THRESHOLD');
    const autoRemoveThreshold = typeof rawThreshold === 'number' ? rawThreshold : 90;
    await analyseAndActOnPost(post, kv as any, provider, reddit as any, !!autoActEnabled, autoRemoveThreshold);
    res.json({ ok: true });
  } catch (err) {
    console.error('/internal/triggers/post-submit error:', err);
    res.json({ ok: true }); // never block posts
  }
});

router.post('/internal/triggers/app-install', async (_req, res) => {
  try {
    await scheduler.runJob({ name: 'queue-processor', cron: '0 */6 * * *' });
    await scheduler.runJob({ name: 'policy-refresh', runAt: new Date() });
    await scheduler.runJob({ name: 'recommendation-run', runAt: new Date(Date.now() + 5000) });
    await scheduler.runJob({ name: 'consistency-analysis', runAt: new Date(Date.now() + 15000) });
    await scheduler.runJob({ name: 'consistency-analysis', cron: '0 2 * * *' });
    res.json({ ok: true });
  } catch (err) {
    console.error('/internal/triggers/app-install error:', err);
    res.json({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// Menu endpoints
// ---------------------------------------------------------------------------

router.post('/internal/menu/open-dashboard', async (_req, res) => {
  try {
    const subredditName = context.subredditName ?? '';
    if (!subredditName) {
      res.json({ showToast: 'AMIS: subreddit name unavailable' } satisfies UiResponse);
      return;
    }
    const post = await (reddit as any).submitCustomPost({
      title: 'AMIS - AI Moderation Intelligence Dashboard',
      subredditName,
      entry: 'default',
      runAs: 'USER',
      userGeneratedContent: {
        text: 'AMIS moderation dashboard',
      },
      textFallback: {
        text: 'Open this post in a Reddit client that supports Devvit Web to use the AMIS dashboard.',
      },
    });
    try {
      await makeKvStore().put(KEYS.dashboardPostId, post.id);
    } catch (storageErr) {
      console.warn('/internal/menu/open-dashboard: dashboard post id was not cached:', storageErr);
    }
    res.json({ navigateTo: `https://www.reddit.com${post.permalink}` } satisfies UiResponse);
  } catch (err) {
    console.error('/internal/menu/open-dashboard error:', err);
    res.json({ showToast: 'Failed to open AMIS dashboard' } satisfies UiResponse);
  }
});

router.post('/internal/menu/analyze-queue', async (_req, res) => {
  try {
    await scheduler.runJob({ name: 'queue-processor', runAt: new Date() });
    res.json({ showToast: 'Queue analysis started. Results should appear shortly.' } satisfies UiResponse);
  } catch (err) {
    console.error('/internal/menu/analyze-queue error:', err);
    res.json({ showToast: 'Failed to start analysis' } satisfies UiResponse);
  }
});

router.post('/internal/menu/refresh-policy', async (_req, res) => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName) {
      res.json({ showToast: 'AMIS: subreddit name unavailable' } satisfies UiResponse);
      return;
    }
    const kv = makeKvStore();
    const wikiPagesRaw = (await settings.get<string>('WIKI_PAGES')) ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const provider = await createAIProvider(settings as any, kv as any);
    const result = await runPolicyRefresh(subredditName, kv as any, provider.embedding, reddit as any, {}, wikiPages);
    res.json({ showToast: `Policy refreshed: ${result.rulesCount} rules, ${result.automodCount} automod, ${result.wikiCount} wiki, ${result.removalCount} removal reasons` } satisfies UiResponse);
  } catch (err) {
    console.error('/internal/menu/refresh-policy error:', err);
    res.json({ showToast: 'Policy refresh failed' } satisfies UiResponse);
  }
});

router.post('/internal/menu/health-check', async (_req, res) => {
  try {
    const kv = makeKvStore();
    const { getAllModItemIds } = await import('../storage/mod-item-store.js');
    const { getEmbedding } = await import('../storage/embedding-store.js');
    const ids = await getAllModItemIds(kv as any);
    let embeddingCount = 0;
    for (const id of ids) {
      const vec = await getEmbedding(kv as any, id);
      if (vec) embeddingCount++;
    }
    const insights = await listInsights(kv as any);
    const pending = insights.filter((i) => !i.acknowledged).length;
    res.json({ showToast: `AMIS: ${ids.length} items, ${embeddingCount} embeddings, ${pending} insights pending` } satisfies UiResponse);
  } catch (err) {
    console.error('/internal/menu/health-check error:', err);
    res.json({ showToast: 'Health check failed' } satisfies UiResponse);
  }
});

router.post('/internal/menu/consistency-check', async (_req, res) => {
  try {
    if (!context.subredditName) {
      res.json({ showToast: 'AMIS: subreddit name unavailable' } satisfies UiResponse);
      return;
    }
    await scheduler.runJob({ name: 'consistency-analysis', runAt: new Date() });
    res.json({ showToast: 'Consistency analysis started. Check Insights shortly.' } satisfies UiResponse);
  } catch (err) {
    console.error('/internal/menu/consistency-check error:', err);
    res.json({ showToast: 'Consistency check failed' } satisfies UiResponse);
  }
});

// ---------------------------------------------------------------------------
// Scheduler/Cron endpoints
// ---------------------------------------------------------------------------

router.post('/internal/cron/queue-processor', async (_req, res) => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName) { res.json({ ok: true }); return; }
    const kv = makeKvStore();
    const provider = await createAIProvider(settings as any, kv as any);
    await runQueueProcessor(subredditName, kv as any, provider, reddit as any);
    res.json({ ok: true });
  } catch (err) {
    console.error('/internal/cron/queue-processor error:', err);
    res.json({ ok: true });
  }
});

router.post('/internal/cron/policy-refresh', async (_req, res) => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName) { res.json({ ok: true }); return; }
    const kv = makeKvStore();
    const wikiPagesRaw = (await settings.get<string>('WIKI_PAGES')) ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const provider = await createAIProvider(settings as any, kv as any);
    const result = await runPolicyRefresh(subredditName, kv as any, provider.embedding, reddit as any, {}, wikiPages);
    console.log(`policy-refresh: ${result.rulesCount} rules, ${result.automodCount} automod, ${result.wikiCount} wiki, ${result.removalCount} removal`);
    res.json({ ok: true });
  } catch (err) {
    console.error('/internal/cron/policy-refresh error:', err);
    res.json({ ok: true });
  }
});

router.post('/internal/cron/recommendation-run', async (_req, res) => {
  try {
    const kv = makeKvStore();
    const summary = await runRecommendationEngine(kv as any);
    console.log(`recommendation-run: ${summary.processed} processed, ${summary.removed} remove, ${summary.monitored} monitor, ${summary.approved} approve, ${summary.escalated} escalate`);
    res.json({ ok: true });
  } catch (err) {
    console.error('/internal/cron/recommendation-run error:', err);
    res.json({ ok: true });
  }
});

router.post('/internal/cron/consistency-analysis', async (_req, res) => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName) { res.json({ ok: true }); return; }
    const { runConsistencyEngine } = await import('../consistency/engine.js');
    const kv = makeKvStore();
    const provider = await createAIProvider(settings as any, kv as any);
    const summary = await runConsistencyEngine(kv as any, provider, reddit as any, subredditName);
    console.log(`consistency-analysis: ${summary.insightsGenerated} insights generated`);
    res.json({ ok: true });
  } catch (err) {
    console.error('/internal/cron/consistency-analysis error:', err);
    res.json({ ok: true });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.use(router);

const port = getServerPort();
const server = createServer(app);
server.on('error', (err) => console.error(`server error: ${err.stack}`));
server.listen(port, () => console.log(`AMIS server running on port ${port}`));
