import { Devvit, useState, useAsync, useForm, useInterval } from '@devvit/public-api';
import type { FormKey, JSONObject } from '@devvit/public-api';
import { KEYS } from '../storage/keys';
import { getAllRecommendations, markActioned, getHistoryRecommendations } from '../storage/recommendation-store';
import { listInsights, acknowledgeInsight } from '../storage/insight-store';
import { getModItem } from '../storage/mod-item-store';
import { sortItemsByRisk } from './helpers';
import { InsightsView } from './insights-view';
import { SettingsView } from './settings-view';
import { TriageView } from './triage-view';
import { HistoryView } from './history-view';
import { getAIConfig, saveAIConfig, AIConfig } from '../storage/ai-config-store';
import { saveDecision } from '../storage/mod-decision-store';
import type { ModItem } from '../types/mod-item';
import type { Recommendation } from '../types/recommendation';
import type { ConsistencyInsight } from '../types/consistency-insight';

type DashboardData = {
  recs: Recommendation[];
  aiApprovedCount: number;
  modItems: Record<string, ModItem>;
  allModItems: Record<string, ModItem>; // includes history items
  insights: ConsistencyInsight[];
  history: Recommendation[];
  aiProvider: string;
  aiConfig: JSONObject | null;
};

async function loadDashboardData(
  kvStore: Devvit.Context['kvStore'],
  settings: Devvit.Context['settings']
): Promise<DashboardData> {
  const [rawRecs, rawInsights, rawHistory, rawAiConfig, rawAiProvider] = await Promise.all([
    getAllRecommendations(kvStore),
    listInsights(kvStore),
    getHistoryRecommendations(kvStore),
    getAIConfig(kvStore),
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
  const modItems: Record<string, ModItem> = {};
  await Promise.all(
    sortedRecs.map(async (rec) => {
      const item = await getModItem(kvStore, rec.itemId);
      if (item) modItems[rec.itemId] = item;
    })
  );

  // Load mod items for history (may overlap with above)
  const allModItems: Record<string, ModItem> = { ...modItems };
  await Promise.all(
    rawHistory.map(async (rec) => {
      if (!allModItems[rec.itemId]) {
        const item = await getModItem(kvStore, rec.itemId);
        if (item) allModItems[rec.itemId] = item;
      }
    })
  );

  return {
    recs: sortedRecs,
    aiApprovedCount,
    modItems,
    allModItems,
    insights: rawInsights,
    history: rawHistory,
    aiProvider: rawAiConfig?.provider ?? (rawAiProvider as string | undefined) ?? 'openai',
    aiConfig: rawAiConfig as JSONObject | null,
  };
}

export function DashboardPost(context: Devvit.Context): JSX.Element {
  const { kvStore, reddit, ui, settings, subredditName, scheduler } = context;

  const [view, setView] = useState('triage');
  const [itemIndex, setItemIndex] = useState(0);
  const [localAcknowledged, setLocalAcknowledged] = useState<string[]>([]);
  const [localActioned, setLocalActioned] = useState<string[]>([]);
  const [aiConfig, setAIConfig] = useState<JSONObject | null>(null);
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false);

  // isRefreshing: true while a scheduled job is running (auto-clears after 40s)
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSecondsLeft, setRefreshSecondsLeft] = useState(0);

  // Dashboard data (live-polled) — stored as 'any' since Devvit useState
  // requires JSONValue-compatible types and DashboardData contains typed arrays.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dashData, setDashData] = useState<any>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  // Countdown timer: ticks every second while refreshing, clears when done.
  // NOTE: Devvit useState does not support functional updater pattern (prev => next).
  // We read refreshSecondsLeft directly from state instead.
  const countdownTimer = useInterval(() => {
    const next = refreshSecondsLeft - 1;
    if (next <= 0) {
      setIsRefreshing(false);
      setRefreshSecondsLeft(0);
      countdownTimer.stop();
    } else {
      setRefreshSecondsLeft(next);
    }
  }, 1000);

  // Polling interval: reload recommendations every 15 seconds automatically
  const pollTimer = useInterval(async () => {
    try {
      const fresh = await loadDashboardData(kvStore, settings);
      setDashData(fresh as any);
    } catch {
      // silently ignore poll errors — don't overwrite existing data
    }
  }, 15000);

  // Initial data load on mount
  const rawAsync = useAsync(async () => {
    return await loadDashboardData(kvStore, settings) as any;
  }, {
    finally: (loaded, err) => {
      if (err) {
        setDataError(err.message ?? 'Failed to load queue');
        return;
      }
      const typed = loaded as DashboardData | null;
      if (typed) {
        setDashData(typed);
        setAIConfig(typed.aiConfig as JSONObject | null);
        const fsEnabled = (typed.aiConfig as any)?.fullscreenEnabled;
        setFullscreenEnabled(typeof fsEnabled === 'boolean' ? fsEnabled : false);
        // Start auto-polling once data is loaded
        pollTimer.start();
      }
    },
  });

  const aiConfigForm = useForm(
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
            defaultValue: formData?.provider ?? 'openai',
          },
          {
            type: 'string',
            name: 'apiKey',
            label: 'AI Provider API Key',
            helpText: 'Required for every provider.',
            isSecret: true,
            scope: 'app',
            required: true,
            defaultValue: formData?.apiKey ?? '',
          },
          {
            type: 'string',
            name: 'voyageApiKey',
            label: 'Voyage API Key',
            helpText: 'Required for Claude and custom providers.',
            isSecret: true,
            scope: 'app',
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
            label: 'Enable full screen dashboard layout',
            helpText: 'Use the wider side-panel layout inside the post.',
            defaultValue: formData?.fullscreenEnabled ?? false,
          },
        ],
      };
    },
    async (values: {
      provider?: string;
      apiKey?: string;
      voyageApiKey?: string;
      customApiBaseUrl?: string;
      customModel?: string;
      fullscreenEnabled?: boolean;
    }) => {
      const nextConfig: AIConfig = {
        provider: values.provider?.trim() ?? 'openai',
        apiKey: values.apiKey?.trim() ?? '',
        voyageApiKey: values.voyageApiKey?.trim() ?? undefined,
        customApiBaseUrl: values.customApiBaseUrl?.trim() ?? undefined,
        customModel: values.customModel?.trim() ?? undefined,
        fullscreenEnabled: values.fullscreenEnabled ?? false,
      };
      await saveAIConfig(kvStore, nextConfig);
      setAIConfig(nextConfig as JSONObject);
      setFullscreenEnabled(!!nextConfig.fullscreenEnabled);
      ui.showToast('Saved AMIS AI config');
    }
  );

  // Loading / error states
  if (rawAsync.loading || !dashData) {
    return (
      <vstack alignment="center middle" grow backgroundColor="#09090bFF" gap="medium">
        <text size="large" color="#e4e4e7FF">⚡ AMIS</text>
        <text color="#71717aFF" size="small">Loading queue...</text>
      </vstack>
    );
  }

  if (dataError) {
    return (
      <vstack alignment="center middle" grow padding="medium" gap="medium" backgroundColor="#09090bFF">
        <text color="#ef4444FF" weight="bold">Unable to load queue</text>
        <text color="#888888" size="small" wrap>{dataError}</text>
      </vstack>
    );
  }

  const data = dashData as DashboardData;
  const { recs: rawRecs, modItems, insights, aiApprovedCount } = data;

  // Filter out items actioned THIS session before KV has synced back
  const recs = rawRecs.filter((r) => !localActioned.includes(r.itemId));
  const pendingInsights = insights.filter(
    (i) => !i.acknowledged && !localAcknowledged.includes(i.id)
  );

  const onBack = () => setView('triage');

  const onAcknowledge = async (id: string) => {
    await acknowledgeInsight(kvStore, id);
    setLocalAcknowledged([...localAcknowledged, id]);
  };

  const onOpenAIConfig = async () => {
    const provider = typeof aiConfig?.provider === 'string' ? aiConfig.provider : data.aiProvider;
    const apiKey = typeof aiConfig?.apiKey === 'string' ? aiConfig.apiKey : '';
    const voyageApiKey = typeof aiConfig?.voyageApiKey === 'string' ? aiConfig.voyageApiKey : '';
    const customApiBaseUrl = typeof aiConfig?.customApiBaseUrl === 'string' ? aiConfig.customApiBaseUrl : '';
    const customModel = typeof aiConfig?.customModel === 'string' ? aiConfig.customModel : '';
    ui.showForm(aiConfigForm, { provider, apiKey, voyageApiKey, customApiBaseUrl, customModel, fullscreenEnabled });
  };

  const onToggleFullscreen = async () => {
    const next = !fullscreenEnabled;
    const current = await getAIConfig(kvStore) ?? {};
    const nextConfig: AIConfig = { ...current, fullscreenEnabled: next };
    await saveAIConfig(kvStore, nextConfig);
    setAIConfig(nextConfig as JSONObject);
    setFullscreenEnabled(next);
    ui.showToast(`Full screen layout ${next ? 'enabled' : 'disabled'}`);
  };

  const onRefreshQueue = async () => {
    try {
      await scheduler.runJob({ name: 'queue-processor', runAt: new Date() });
      setIsRefreshing(true);
      setRefreshSecondsLeft(40);
      countdownTimer.start();
      ui.showToast('⏳ Analysing queue — dashboard updates automatically');
    } catch (err) {
      console.error('onRefreshQueue: failed to schedule job:', err);
      ui.showToast('Refresh failed — try again');
    }
  };

  // Remove actioned item immediately from the displayed list.
  const removeActioned = (id: string) => {
    setLocalActioned([...localActioned, id]);
  };

  const advanceItem = () => setItemIndex(itemIndex + 1);

  /** Execute a remove action — always calls Reddit API AND records a ModDecision. */
  const handleRemove = async (id: string) => {
    removeActioned(id);
    const actor = context.userId ?? 'moderator';
    try {
      await Promise.all([
        markActioned(kvStore, id, 'remove', actor),
        (reddit as any).remove(id, false),
        saveDecision(kvStore, {
          targetId: id,
          action: 'removelink',
          moderator: actor,
          timestamp: Date.now(),
          subredditId: subredditName ?? '',
        }),
      ]);
      ui.showToast('✅ Removed');
    } catch (e) {
      console.error('handleRemove failed', e);
      ui.showToast('Remove failed — check permissions');
    }
  };

  /** Execute an approve action — always calls Reddit API AND records a ModDecision. */
  const handleApprove = async (id: string) => {
    removeActioned(id);
    const actor = context.userId ?? 'moderator';
    try {
      await Promise.all([
        markActioned(kvStore, id, 'approve', actor),
        (reddit as any).approve(id),
        saveDecision(kvStore, {
          targetId: id,
          action: 'approvelink',
          moderator: actor,
          timestamp: Date.now(),
          subredditId: subredditName ?? '',
        }),
      ]);
      ui.showToast('✅ Approved');
    } catch (e) {
      console.error('handleApprove failed', e);
      ui.showToast('Approve failed — check permissions');
    }
  };

  /** Escalate: mark for human review, no Reddit API action needed. */
  const handleEscalate = async (id: string) => {
    removeActioned(id);
    const actor = context.userId ?? 'moderator';
    try {
      await Promise.all([
        kvStore.put(KEYS.escalation(id), 'true'),
        markActioned(kvStore, id, 'escalate', actor),
      ]);
      ui.showToast('🔺 Escalated for human review');
    } catch (e) {
      console.error('handleEscalate failed', e);
    }
  };

  if (view === 'insights') {
    return (
      <InsightsView
        insights={pendingInsights}
        onBack={onBack}
        onAcknowledge={onAcknowledge}
      />
    );
  }

  if (view === 'history') {
    return (
      <HistoryView
        history={data.history ?? []}
        modItems={data.allModItems ?? modItems}
        onBack={onBack}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsView
        aiProvider={typeof aiConfig?.provider === 'string' ? aiConfig.provider : data.aiProvider}
        aiConfigPresent={Boolean(aiConfig)}
        fullscreenEnabled={fullscreenEnabled}
        itemCount={recs.length}
        onBack={onBack}
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
      aiApprovedCount={aiApprovedCount ?? 0}
      itemIndex={itemIndex}
      pendingInsightCount={pendingInsights.length}
      isRefreshing={isRefreshing}
      refreshSecondsLeft={refreshSecondsLeft}
      fullscreenEnabled={fullscreenEnabled}
      subredditName={subredditName ?? ''}
      onRemoveDirect={handleRemove}
      onApproveDirect={handleApprove}
      onNavigateToQueue={() => {
        ui.navigateTo(`https://www.reddit.com/r/${subredditName ?? ''}/about/modqueue`);
      }}
      onSkip={advanceItem}
      onEscalate={handleEscalate}
      onViewInsights={() => setView('insights')}
      onViewHistory={() => setView('history')}
      onViewSettings={() => setView('settings')}
      onRefresh={onRefreshQueue}
    />
  );
}
