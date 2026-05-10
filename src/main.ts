import { Devvit } from '@devvit/public-api';
import { createEmbeddingClient } from './embeddings/client';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
});

Devvit.addSchedulerJob({
  name: 'queue-processor',
  onRun: async (_event, context) => {
    const apiKey = await context.settings.get<string>('VOYAGE_API_KEY');
    const embeddingClient = createEmbeddingClient(apiKey as string);
    await runQueueProcessor(context.reddit, context.kvStore, embeddingClient);
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
