import { Devvit, useState, useAsync } from '@devvit/public-api';
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
import type { ModItem } from '../types/mod-item';
import type { Recommendation } from '../types/recommendation';
import type { ConsistencyInsight } from '../types/consistency-insight';

type DashboardData = {
  recs: Recommendation[];
  modItems: Record<string, ModItem>;
  insights: ConsistencyInsight[];
  directActionsEnabled: boolean;
  aiProvider: string;
};

export function DashboardPost(context: Devvit.Context): JSX.Element {
  const { kvStore, reddit, ui, settings, subredditName } = context;

  const [view, setView] = useState('triage');
  const [itemIndex, setItemIndex] = useState(0);
  const [localAcknowledged, setLocalAcknowledged] = useState<string[]>([]);
  const [directActionsEnabled, setDirectActionsEnabled] = useState(false);

  const rawAsync = useAsync(async () => {
    const [rawRecs, rawInsights, rawDirectActions, rawAiProvider] = await Promise.all([
      getAllRecommendations(kvStore),
      listInsights(kvStore),
      kvStore.get(KEYS.directActionsEnabled),
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
      aiProvider: (rawAiProvider as string | undefined) ?? 'claude',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  }, {
    finally: (loaded, _err) => {
      const typed = loaded as DashboardData | null;
      if (typed) setDirectActionsEnabled(typed.directActionsEnabled);
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

  const onRefreshQueue = async () => {
    try {
      ui.showToast('Refreshing queue...');
      const provider = await createAIProvider(settings);
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
        aiProvider={data.aiProvider}
        directActionsEnabled={directActionsEnabled}
        itemCount={recs.length}
        onBack={onBack}
        onToggleDirectActions={onToggleDirectActions}
        onRefreshQueue={onRefreshQueue}
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
