import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';

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
]);

// Schedule the queue processor job on first install
Devvit.addTrigger({
  event: 'AppInstall',
  async onEvent(_event, context) {
    await context.scheduler.runJob({
      name: 'queue-processor',
      cron: '0 */6 * * *', // every 6 hours
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

Devvit.addMenuItem({
  label: 'AMIS: Health Check',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    await runHealthCheck(context.kvStore, context.ui);
  },
});

export default Devvit;
