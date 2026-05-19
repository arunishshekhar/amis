import { Devvit } from '@devvit/public-api';
// NOTE: All app logic (triggers, menu items, scheduler jobs, dashboard UI) has been
// migrated to the Devvit Web server (src/server/index.ts) and devvit.json.
// This file is kept only to declare app-level settings via Devvit.addSettings.

Devvit.configure({
  kvStore: true,
  redditAPI: true,
  http: true,
});

Devvit.addSettings([
  {
    name: 'VOYAGE_API_KEY',
    label: 'Voyage AI API Key (required when AI Provider is Claude)',
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
    label: 'AI Provider (openai | gemini | claude — default: openai)',
    type: 'string',
    isSecret: false,
    scope: 'app',
  },
  {
    name: 'AI_API_KEY',
    label: 'AI Provider API Key — OpenAI / Gemini / Claude key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
  {
    name: 'AUTO_ACT_ENABLED',
    label: 'Enable automatic moderation actions (remove/approve) on new posts',
    type: 'boolean',
    defaultValue: false,
    scope: 'app',
  },
  {
    name: 'AUTO_REMOVE_THRESHOLD',
    label: 'Auto-remove confidence threshold (0–100, default 90)',
    type: 'number',
    defaultValue: 90,
    scope: 'app',
  },
]);

export default Devvit;
