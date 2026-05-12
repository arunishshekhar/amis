import { Devvit } from '@devvit/public-api';
import { createAIProvider } from './ai/provider';
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
    label: 'Voyage AI API Key (required when AI Provider is Claude or Custom)',
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
  {
    name: 'AI_PROVIDER',
    label: 'AI Provider (openai | claude | gemini | custom) — defaults to claude',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
  {
    name: 'AI_API_KEY',
    label: 'AI Provider API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
  {
    name: 'CUSTOM_API_BASE_URL',
    label: 'Custom AI Base URL (e.g. http://localhost:11434/v1) — only for custom provider',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
  {
    name: 'CUSTOM_MODEL',
    label: 'Custom AI Model name — only for custom provider',
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
    await context.scheduler.runJob({
      name: 'consistency-analysis',
      runAt: new Date(Date.now() + 15000),
    });
    await context.scheduler.runJob({
      name: 'consistency-analysis',
      cron: '0 2 * * *',
    });
  },
});

Devvit.addSchedulerJob({
  name: 'queue-processor',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('queue-processor: subredditName unavailable — skipping');
      return;
    }
    const provider = await createAIProvider(context.settings);
    await runQueueProcessor(context.subredditName, context.kvStore, provider.embedding, context.reddit);
  },
});

Devvit.addSchedulerJob({
  name: 'policy-refresh',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('policy-refresh: subredditName unavailable — skipping');
      return;
    }
    const wikiPagesRaw = (await context.settings.get<string>('WIKI_PAGES')) ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const provider = await createAIProvider(context.settings);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      provider.embedding,
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
      console.error('recommendation-run: subredditName unavailable — skipping');
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

Devvit.addSchedulerJob({
  name: 'consistency-analysis',
  onRun: async (_event, context) => {
    if (!context.subredditName) {
      console.error('consistency-analysis: subredditName unavailable — skipping');
      return;
    }
    const { runConsistencyEngine } = await import('./consistency/engine');
    const provider = await createAIProvider(context.settings);
    const summary = await runConsistencyEngine(
      context.kvStore,
      provider,
      context.reddit,
      context.subredditName
    );
    console.log(`consistency-analysis: ${summary.insightsGenerated} insights generated`);
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
    if (!context.subredditName) {
      context.ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const wikiPagesRaw = (await context.settings.get<string>('WIKI_PAGES')) ?? '';
    const wikiPages = wikiPagesRaw.split(',').map((p) => p.trim()).filter(Boolean);
    const provider = await createAIProvider(context.settings);
    const result = await runPolicyRefresh(
      context.subredditName,
      context.kvStore,
      provider.embedding,
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

Devvit.addMenuItem({
  label: 'AMIS: Consistency Check',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    if (!context.subredditName) {
      context.ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const { runConsistencyEngine } = await import('./consistency/engine');
    const provider = await createAIProvider(context.settings);
    const summary = await runConsistencyEngine(
      context.kvStore,
      provider,
      context.reddit,
      context.subredditName
    );
    if (summary.skipped) {
      context.ui.showToast(
        `Consistency: not enough data (${summary.decisionCount}/50 decisions)`
      );
    } else {
      context.ui.showToast(
        `Consistency: ${summary.insightsGenerated} new insights generated`
      );
    }
  },
});

export default Devvit;
