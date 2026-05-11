import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';
import { runPolicyRefresh } from './triggers/policy-refresh';
import { runRecommendationEngine } from './recommendations/engine';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
  http: true,
});

Devvit.addSettings([
  {
    name: 'VOYAGE_API_KEY',
    label: 'Voyage AI API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
  {
    name: 'WIKI_PAGES',
    label: 'Wiki pages to ingest (comma-separated)',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
]);

Devvit.addTrigger({
  event: 'AppInstall',
  async onEvent(_event, context) {
    await context.scheduler.runJob({
      name: 'queue-processor',
      cron: '0 */6 * * *',
    });
    await context.scheduler.runJob({
      name: 'policy-refresh',
      runAt: new Date(),
    });
    await context.scheduler.runJob({
      name: 'recommendation-run',
      runAt: new Date(Date.now() + 5000),
    });
  },
});

Devvit.addSchedulerJob({
  name: 'queue-processor',
  onRun: async (_event, context) => {
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      console.error('runQueueProcessor: VOYAGE_API_KEY is not set — skipping run');
      return;
    }
    if (!context.subredditName) {
      console.error('runQueueProcessor: subredditName unavailable in job context — skipping run');
      return;
    }
    const embeddingClient = createEmbeddingClient(apiKey);
    await runQueueProcessor(
      context.subredditName,
      context.kvStore,
      embeddingClient,
      context.reddit
    );
  },
});

Devvit.addSchedulerJob({
  name: 'policy-refresh',
  onRun: async (_event, context) => {
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      console.error('policy-refresh: VOYAGE_API_KEY is not set — skipping run');
      return;
    }
    if (!context.subredditName) {
      console.error('policy-refresh: subredditName unavailable in job context — skipping run');
      return;
    }
    const wikiPagesRaw = await context.settings.get<string>('WIKI_PAGES') ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const embeddingClient = createEmbeddingClient(apiKey);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      embeddingClient,
      context.reddit,
      context.debug.metadata,
      wikiPages
    );
    console.log(
      `policy-refresh complete: ${result.rulesCount} rules, ` +
      `${result.automodCount} automod, ${result.wikiCount} wiki, ` +
      `${result.removalCount} removal reasons`
    );
  },
});

Devvit.addSchedulerJob({
  name: 'recommendation-run',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('recommendation-run: subredditName unavailable in job context — skipping run');
      return;
    }
    const summary = await runRecommendationEngine(context.kvStore);
    console.log(
      `recommendation-run complete: ${summary.processed} processed, ` +
      `${summary.removed} remove, ${summary.monitored} monitor, ` +
      `${summary.approved} approve, ${summary.escalated} escalate`
    );
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Health Check',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    await runHealthCheck(context.kvStore, context.ui);
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Refresh Policy',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      context.ui.showToast('AMIS: VOYAGE_API_KEY not configured');
      return;
    }
    if (!context.subredditName) {
      context.ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const wikiPagesRaw = await context.settings.get<string>('WIKI_PAGES') ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const embeddingClient = createEmbeddingClient(apiKey);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      embeddingClient,
      context.reddit,
      context.debug.metadata,
      wikiPages
    );
    context.ui.showToast(
      `Policy refreshed: ${result.rulesCount} rules, ` +
      `${result.automodCount} automod patterns, ` +
      `${result.wikiCount} wiki chunks, ` +
      `${result.removalCount} removal reasons`
    );
  },
});

Devvit.addMenuItem({
  label: 'AMIS: Analyze Queue',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const summary = await runRecommendationEngine(context.kvStore);
    context.ui.showToast(
      `Analysis: ${summary.removed} remove, ${summary.monitored} monitor, ` +
      `${summary.approved} approve, ${summary.escalated} escalate`
    );
  },
});

export default Devvit;
