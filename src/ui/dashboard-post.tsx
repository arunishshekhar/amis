import { Devvit, useState, useAsync } from '@devvit/public-api';
import type { FormKey, JSONObject } from '@devvit/public-api';
import { KEYS } from '../storage/keys';
import { getAllRecommendations } from '../storage/recommendation-store';
import { listInsights, acknowledgeInsight } from '../storage/insight-store';
import { getModItem } from '../storage/mod-item-store';
import { createAIProvider } from '../ai/provider';
import { runQueueProcessor } from '../jobs/queue-processor';
import { sortItemsByRisk } from './helpers';
import { InsightsView } from './insights-view';
import { SettingsView } from './settings-view';
import { TriageView } from './triage-view';
import { getAIConfig, saveAIConfig, AIConfig } from '../storage/ai-config-store';
import type { ModItem } from '../types/mod-item';
import type { Recommendation } from '../types/recommendation';
import type { ConsistencyInsight } from '../types/consistency-insight';

type DashboardData = {
  recs: Recommendation[];
  modItems: Record<string, ModItem>;
  insights: ConsistencyInsight[];
  directActionsEnabled: boolean;
  aiProvider: string;
  aiConfig: JSONObject | null;
};

export function DashboardPost(context: Devvit.Context): JSX.Element {
  const { kvStore, reddit, ui, settings, subredditName } = context;

  const [view, setView] = useState('triage');
  const [itemIndex, setItemIndex] = useState(0);
  const [localAcknowledged, setLocalAcknowledged] = useState<string[]>([]);
  const [directActionsEnabled, setDirectActionsEnabled] = useState(false);
  const [aiConfig, setAIConfig] = useState<JSONObject | null>(null);
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false);

  const [aiConfigForm] = useState<FormKey>(() => Devvit.createForm(
    (data: Record<string, unknown>) => {
      const formData = data as Partial<AIConfig>;
      return {
        title: 'AMIS AI Configuration',
        description: 'Store AI provider credentials in subreddit KV storage so the dashboard can use them directly.',
        acceptLabel: 'Save AI config',
        fields: [
          {
            type: 'string',
            name: 'provider',
            label: 'AI Provider',
            helpText: 'Enter one of openai, claude, gemini, or custom.',
            required: true,
            defaultValue: formData?.provider ?? 'claude',
          },
          {
            type: 'string',
            name: 'apiKey',
            label: 'AI Provider API Key',
            helpText: 'Required for every provider.',
            isSecret: true,
            required: true,
            defaultValue: formData?.apiKey ?? '',
          },
          {
            type: 'string',
            name: 'voyageApiKey',
            label: 'Voyage API Key',
            helpText: 'Required for Claude and custom providers.',
            isSecret: true,
            defaultValue: formData?.voyageApiKey ?? '',
          },
          {
            type: 'string',
            name: 'customApiBaseUrl',
            label: 'Custom API Base URL',
            helpText: 'Only required for custom provider.',
            defaultValue: formData?.customApiBaseUrl ?? '',
          },
          {
            type: 'string',
            name: 'customModel',
            label: 'Custom Model',
            helpText: 'Only required for custom provider.',
            defaultValue: formData?.customModel ?? '',
          },
          {
            type: 'boolean',
            name: 'fullscreenEnabled',
            label: 'Enable full screen dashboard',
            helpText: 'Use a larger dashboard layout when supported by the subreddit UI.',
            defaultValue: formData?.fullscreenEnabled ?? false,
          },
        ],
      };
  },
  async (event, context) => {
      const values = event.values as {
        provider?: string;
        apiKey?: string;
        voyageApiKey?: string;
        customApiBaseUrl?: string;
        customModel?: string;
        fullscreenEnabled?: boolean;
      };

      const nextConfig: AIConfig = {
        provider: values.provider?.trim() ?? 'claude',
        apiKey: values.apiKey?.trim() ?? '',
        voyageApiKey: values.voyageApiKey?.trim() ?? undefined,
        customApiBaseUrl: values.customApiBaseUrl?.trim() ?? undefined,
        customModel: values.customModel?.trim() ?? undefined,
        fullscreenEnabled: values.fullscreenEnabled ?? false,
      };

      await saveAIConfig(context.kvStore, nextConfig);
      setAIConfig(nextConfig as JSONObject);
      setFullscreenEnabled(!!nextConfig.fullscreenEnabled);
      context.ui.showToast('Saved AMIS AI config');
    }
  ));

  const rawAsync = useAsync(async () => {
    const [rawRecs, rawInsights, rawDirectActions, rawAiConfig, rawAiProvider] = await Promise.all([
      getAllRecommendations(kvStore),
      listInsights(kvStore),
      kvStore.get(KEYS.directActionsEnabled),
      getAIConfig(kvStore),
      settings.get<string>('AI_PROVIDER'),
    ]);

    const sortedRecs = sortItemsByRisk(rawRecs);

    const modItems: Record<string, ModItem> = {};
    await Promise.all(
      sortedRecs.map(async (rec) => {
        const item = await getModItem(kvStore, rec.itemId);
        if (item) modItems[rec.itemId] = item;
      })
    );

    const result: DashboardData = {
      recs: sortedRecs,
      modItems,
      insights: rawInsights,
      directActionsEnabled: rawDirectActions === 'true',
      aiProvider: rawAiConfig?.provider ?? (rawAiProvider as string | undefined) ?? 'claude',
      aiConfig: rawAiConfig as JSONObject | null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  }, {
    finally: (loaded, _err) => {
      const typed = loaded as DashboardData | null;
      if (typed) {
        setDirectActionsEnabled(typed.directActionsEnabled);
        setAIConfig(typed.aiConfig);
        setFullscreenEnabled(
          typeof typed.aiConfig?.fullscreenEnabled === 'boolean'
            ? typed.aiConfig.fullscreenEnabled
            : false
        );
      }
    },
  });
  const { loading, error } = rawAsync;
  const data = rawAsync.data as DashboardData | null;

  if (loading || !data) {
    return (
      <vstack alignment="center middle" grow>
        <text size="large">⚡ AMIS</text>
        <text color="#888888">Loading queue...</text>
      </vstack>
    );
  }

  if (error) {
    return (
      <vstack alignment="center middle" grow padding="medium" gap="medium">
        <text color="#ff4444" weight="bold">Unable to load queue</text>
        <text color="#888888" size="small" wrap>
          {error.message ?? 'Unknown error — please retry'}
        </text>
      </vstack>
    );
  }

  const { recs, modItems, insights } = data;
  const pendingInsights = insights.filter(
    (i) => !i.acknowledged && !localAcknowledged.includes(i.id)
  );

  const onBack = () => setView('triage');

  const onAcknowledge = async (id: string) => {
    await acknowledgeInsight(kvStore, id);
    setLocalAcknowledged([...localAcknowledged, id]);
  };

  const onToggleDirectActions = async () => {
    const next = !directActionsEnabled;
    await kvStore.put(KEYS.directActionsEnabled, String(next));
    setDirectActionsEnabled(next);
  };

  const onOpenAIConfig = async () => {
    const provider = typeof aiConfig?.provider === 'string' ? aiConfig.provider : data.aiProvider;
    const apiKey = typeof aiConfig?.apiKey === 'string' ? aiConfig.apiKey : '';
    const voyageApiKey = typeof aiConfig?.voyageApiKey === 'string' ? aiConfig.voyageApiKey : '';
    const customApiBaseUrl = typeof aiConfig?.customApiBaseUrl === 'string' ? aiConfig.customApiBaseUrl : '';
    const customModel = typeof aiConfig?.customModel === 'string' ? aiConfig.customModel : '';

    ui.showForm(aiConfigForm, {
      provider,
      apiKey,
      voyageApiKey,
      customApiBaseUrl,
      customModel,
      fullscreenEnabled,
    });
  };

  const onToggleFullscreen = async () => {
    const next = !fullscreenEnabled;
    const nextConfig = {
      ...(aiConfig ?? {}),
      fullscreenEnabled: next,
    } as AIConfig;
    await saveAIConfig(kvStore, nextConfig);
    setAIConfig(nextConfig as JSONObject);
    setFullscreenEnabled(next);
    ui.showToast(`Full screen ${next ? 'enabled' : 'disabled'}`);
  };

  const onRefreshQueue = async () => {
    try {
      ui.showToast('Refreshing queue...');
      const provider = await createAIProvider(settings, kvStore);
      await runQueueProcessor(subredditName!, kvStore, provider.embedding, reddit);
      ui.showToast('Queue refreshed');
    } catch {
      ui.showToast('Refresh failed — try again');
    }
  };

  const advanceItem = () => setItemIndex(itemIndex + 1);

  if (view === 'insights') {
    return (
      <InsightsView
        insights={pendingInsights}
        onBack={onBack}
        onAcknowledge={onAcknowledge}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsView
        aiProvider={typeof aiConfig?.provider === 'string' ? aiConfig.provider : data.aiProvider}
        aiConfigPresent={Boolean(aiConfig)}
        fullscreenEnabled={fullscreenEnabled}
        directActionsEnabled={directActionsEnabled}
        itemCount={recs.length}
        onBack={onBack}
        onToggleDirectActions={onToggleDirectActions}
        onRefreshQueue={onRefreshQueue}
        onOpenAIConfig={onOpenAIConfig}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  return (
    <TriageView
      recs={recs}
      modItems={modItems}
      itemIndex={itemIndex}
      pendingInsightCount={pendingInsights.length}
      directActionsEnabled={directActionsEnabled}
      fullscreenEnabled={fullscreenEnabled}
      subredditName={subredditName ?? ''}
      onRemoveDirect={async (id) => {
        await reddit.remove(id, false);
        ui.showToast('Removed ✓');
        advanceItem();
      }}
      onApproveDirect={async (id) => {
        await reddit.approve(id);
        ui.showToast('Approved ✓');
        advanceItem();
      }}
      onNavigateToQueue={() => {
        ui.navigateTo(`https://www.reddit.com/r/${subredditName ?? ''}/about/modqueue`);
      }}
      onSkip={advanceItem}
      onEscalate={async (id) => {
        await kvStore.put(KEYS.escalation(id), 'true');
        ui.showToast('Escalated ✓');
        advanceItem();
      }}
      onViewInsights={() => setView('insights')}
      onViewSettings={() => setView('settings')}
      onRefresh={onRefreshQueue}
    />
  );
}
