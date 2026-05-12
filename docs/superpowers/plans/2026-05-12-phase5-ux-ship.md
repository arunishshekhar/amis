# Phase 5 — UX + Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Devvit custom post type moderator dashboard — triage view, insights panel, and settings panel — surfacing all Phase 1–4 AI output through a polished, demo-ready UI.

**Architecture:** A single persistent custom post (stored by ID in KV) renders a state-machine (`triage | insights | settings`). All hooks (`useState`, `useAsync`) live in the root `DashboardPost` component; sub-views receive data and callbacks as props. Pure helper functions are extracted to `src/ui/helpers.ts` and unit-tested; the Devvit block components themselves require `devvit playtest` for integration testing.

**Tech Stack:** Devvit blocks (JSX via `Devvit.createElement`), `useState` + `useAsync` from `@devvit/public-api`, KV store for persistent state (direct actions toggle, dashboard post ID).

---

## File Inventory

### New Files
```
src/ui/helpers.ts              — pure helper functions (sortItemsByRisk, riskColor, truncate, etc.)
src/ui/dashboard-preview.tsx   — loading preview JSX element for submitPost
src/ui/insights-view.tsx       — insights list sub-view component
src/ui/settings-view.tsx       — settings sub-view component
src/ui/triage-view.tsx         — triage item card sub-view component
src/ui/dashboard-post.tsx      — root CustomPostType component; all hooks; state machine
tests/ui/helpers.test.ts       — unit tests for pure helper functions
```

### Modified Files
```
tsconfig.json                  — add jsx, jsxFactory, jsxFragmentFactory
src/storage/keys.ts            — add dashboardPostId, directActionsEnabled, escalation(id)
src/main.ts                    — addCustomPostType; replace "Health Check" open-dashboard menu item
```

---

## Task 1: tsconfig JSX + storage keys

**Files:**
- Modify: `tsconfig.json`
- Modify: `src/storage/keys.ts`

- [ ] **Step 1: Update `tsconfig.json`**

Add three fields to `compilerOptions`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "jsx": "react",
    "jsxFactory": "Devvit.createElement",
    "jsxFragmentFactory": "Devvit.Fragment"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 2: Add 3 keys to `src/storage/keys.ts`**

```typescript
export const KEYS = {
  modItem: (id: string) => `mod_item:${id}`,
  embedding: (id: string) => `embedding:${id}`,
  modItemIndex: 'mod_item_index',
  policy: (id: string) => `policy:${id}`,
  policyIndex: 'policy_index',
  policyEmbedding: (id: string) => `policy_embedding:${id}`,
  recommendation: (id: string) => `recommendation:${id}`,
  recommendationIndex: 'recommendation_index',
  modDecision: (id: string) => `moddecision:${id}`,
  modDecisionIndex: 'moddecision_index',
  insight: (id: string) => `insight:${id}`,
  insightIndex: 'insight_index',
  dashboardPostId: 'dashboard_post_id',
  directActionsEnabled: 'direct_actions_enabled',
  escalation: (id: string) => `escalation:${id}`,
};
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (the new keys are plain strings/functions, no JSX yet).

- [ ] **Step 4: Run tests to confirm nothing broke**

```bash
npm test -- --no-coverage
```

Expected: 114 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json src/storage/keys.ts
git commit -m "feat: enable Devvit JSX in tsconfig; add dashboard, directActions, escalation KV keys"
```

---

## Task 2: Pure helper functions + unit tests

**Files:**
- Create: `src/ui/helpers.ts`
- Create: `tests/ui/helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/helpers.test.ts`:

```typescript
import {
  sortItemsByRisk,
  riskColor,
  confidenceColor,
  truncate,
  formatStats,
  sortedInsights,
} from '../../src/ui/helpers';
import type { Recommendation } from '../../src/types/recommendation';
import type { ConsistencyInsight } from '../../src/types/consistency-insight';

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    itemId: 'i1',
    suggestedAction: 'remove',
    confidenceScore: 80,
    riskLevel: 'low',
    matchedPolicyId: null,
    matchedPolicyTitle: null,
    similarity: 0.8,
    rationale: 'test',
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeInsight(id: string, acknowledged: boolean, detectedAt: number): ConsistencyInsight {
  return {
    id,
    type: 'divergence',
    detectedAt,
    policyId: null,
    policyTitle: null,
    description: '',
    stats: {},
    acknowledged,
    acknowledgedAt: null,
  };
}

describe('sortItemsByRisk', () => {
  it('sorts high before medium before low', () => {
    const recs = [
      makeRec({ itemId: 'a', riskLevel: 'low', confidenceScore: 90 }),
      makeRec({ itemId: 'b', riskLevel: 'high', confidenceScore: 70 }),
      makeRec({ itemId: 'c', riskLevel: 'medium', confidenceScore: 80 }),
    ];
    expect(sortItemsByRisk(recs).map((r) => r.itemId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks risk ties by confidenceScore descending', () => {
    const recs = [
      makeRec({ itemId: 'a', riskLevel: 'high', confidenceScore: 70 }),
      makeRec({ itemId: 'b', riskLevel: 'high', confidenceScore: 90 }),
    ];
    expect(sortItemsByRisk(recs)[0].itemId).toBe('b');
  });

  it('does not mutate the original array', () => {
    const recs = [makeRec({ riskLevel: 'low' }), makeRec({ riskLevel: 'high' })];
    sortItemsByRisk(recs);
    expect(recs[0].riskLevel).toBe('low');
  });
});

describe('riskColor', () => {
  it('returns red for high', () => expect(riskColor('high')).toBe('#ff4444'));
  it('returns orange for medium', () => expect(riskColor('medium')).toBe('#ff8c00'));
  it('returns green for low', () => expect(riskColor('low')).toBe('#44bb44'));
});

describe('confidenceColor', () => {
  it('returns orange for score < 70', () => expect(confidenceColor(69)).toBe('#ff8c00'));
  it('returns grey for score >= 70', () => expect(confidenceColor(70)).toBe('#cccccc'));
  it('returns grey for score 100', () => expect(confidenceColor(100)).toBe('#cccccc'));
});

describe('truncate', () => {
  it('truncates strings longer than n with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });
  it('returns string unchanged when <= n chars', () => {
    expect(truncate('hi', 5)).toBe('hi');
  });
  it('returns string unchanged when exactly n chars', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('formatStats', () => {
  it('formats integer stats without decimal places', () => {
    expect(formatStats({ removeCount: 7, approveCount: 3 })).toBe(
      'removeCount: 7 · approveCount: 3'
    );
  });

  it('formats float stats to 2 decimal places', () => {
    expect(formatStats({ ratio: 0.3 })).toBe('ratio: 0.30');
  });

  it('returns empty string for empty stats', () => {
    expect(formatStats({})).toBe('');
  });
});

describe('sortedInsights', () => {
  it('puts unacknowledged insights before acknowledged ones', () => {
    const insights = [
      makeInsight('a', true, 100),
      makeInsight('b', false, 50),
    ];
    expect(sortedInsights(insights)[0].id).toBe('b');
  });

  it('sorts by detectedAt descending within same acknowledged state', () => {
    const insights = [
      makeInsight('a', false, 100),
      makeInsight('b', false, 200),
    ];
    expect(sortedInsights(insights)[0].id).toBe('b');
  });

  it('does not mutate the original array', () => {
    const insights = [makeInsight('a', true, 100), makeInsight('b', false, 50)];
    sortedInsights(insights);
    expect(insights[0].id).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/ui/helpers.test.ts --no-coverage
```

Expected: FAIL — module `../../src/ui/helpers` not found.

- [ ] **Step 3: Create `src/ui/helpers.ts`**

```typescript
import type { RiskLevel, Recommendation } from '../types/recommendation';
import type { ConsistencyInsight } from '../types/consistency-insight';

const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function sortItemsByRisk(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const riskDiff = RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return b.confidenceScore - a.confidenceScore;
  });
}

export function riskColor(level: RiskLevel): string {
  if (level === 'high') return '#ff4444';
  if (level === 'medium') return '#ff8c00';
  return '#44bb44';
}

export function confidenceColor(score: number): string {
  return score < 70 ? '#ff8c00' : '#cccccc';
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function formatStats(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([k, v]) => `${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`)
    .join(' · ');
}

export function sortedInsights(insights: ConsistencyInsight[]): ConsistencyInsight[] {
  return [...insights].sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    return b.detectedAt - a.detectedAt;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/ui/helpers.test.ts --no-coverage
```

Expected: PASS — 12 tests passing.

- [ ] **Step 5: Run full suite**

```bash
npm test -- --no-coverage
```

Expected: 126 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/ui/helpers.ts tests/ui/helpers.test.ts
git commit -m "feat: add dashboard helper functions with unit tests"
```

---

## Task 3: InsightsView component

**Files:**
- Create: `src/ui/insights-view.tsx`

No unit tests — Devvit block components require the runtime. Verified via `devvit playtest` in Task 7.

- [ ] **Step 1: Create `src/ui/insights-view.tsx`**

```tsx
import { Devvit } from '@devvit/public-api';
import type { ConsistencyInsight } from '../types/consistency-insight';
import { sortedInsights, formatStats } from './helpers';

const BADGE_COLORS: Record<string, string> = {
  divergence: '#3498db',
  drift: '#e67e22',
  variance: '#8e44ad',
};

interface InsightsViewProps {
  insights: ConsistencyInsight[];
  onBack: () => void;
  onAcknowledge: (id: string) => void | Promise<void>;
}

export function InsightsView({ insights, onBack, onAcknowledge }: InsightsViewProps): JSX.Element {
  const pending = insights.filter((i) => !i.acknowledged);
  const sorted = sortedInsights(pending);

  if (sorted.length === 0) {
    return (
      <vstack padding="medium" gap="medium" grow>
        <hstack gap="small" alignment="start middle">
          <button appearance="plain" size="small" onPress={onBack}>← Back</button>
          <text weight="bold" size="medium">Insights</text>
        </hstack>
        <vstack alignment="center middle" grow>
          <text color="#888888">No pending insights — consistency looks good</text>
        </vstack>
      </vstack>
    );
  }

  return (
    <vstack padding="medium" gap="small" grow>
      <hstack gap="small" alignment="start middle">
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium">Insights</text>
        <spacer grow />
        <text color="#888888" size="small">{sorted.length} pending</text>
      </hstack>

      <vstack gap="small">
        {sorted.map((insight) => (
          <vstack
            padding="small"
            gap="xsmall"
            border="thin"
            cornerRadius="small"
            backgroundColor="#1a1a2e"
          >
            <hstack gap="small" alignment="start middle">
              <text
                weight="bold"
                size="small"
                color={BADGE_COLORS[insight.type] ?? '#888888'}
              >
                {insight.type.toUpperCase()}
              </text>
              {insight.policyTitle ? (
                <text weight="bold" size="small">{insight.policyTitle}</text>
              ) : null}
            </hstack>
            <text wrap size="small">{insight.description}</text>
            <text size="xsmall" color="#888888">{formatStats(insight.stats)}</text>
            <button
              size="small"
              appearance="secondary"
              onPress={() => onAcknowledge(insight.id)}
            >
              Acknowledge ✓
            </button>
          </vstack>
        ))}
      </vstack>
    </vstack>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/insights-view.tsx
git commit -m "feat: add InsightsView block component"
```

---

## Task 4: SettingsView component

**Files:**
- Create: `src/ui/settings-view.tsx`

- [ ] **Step 1: Create `src/ui/settings-view.tsx`**

```tsx
import { Devvit } from '@devvit/public-api';

interface SettingsViewProps {
  aiProvider: string;
  directActionsEnabled: boolean;
  itemCount: number;
  onBack: () => void;
  onToggleDirectActions: () => void | Promise<void>;
  onRefreshQueue: () => void | Promise<void>;
}

export function SettingsView({
  aiProvider,
  directActionsEnabled,
  itemCount,
  onBack,
  onToggleDirectActions,
  onRefreshQueue,
}: SettingsViewProps): JSX.Element {
  return (
    <vstack padding="medium" gap="medium" grow>
      <hstack gap="small" alignment="start middle">
        <button appearance="plain" size="small" onPress={onBack}>← Back</button>
        <text weight="bold" size="medium">Settings</text>
      </hstack>

      <vstack gap="xsmall" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">AI PROVIDER</text>
        <text size="small">{aiProvider}</text>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">DIRECT ACTIONS</text>
        <text size="xsmall" color="#888888" wrap>
          Execute remove/approve from dashboard without leaving Reddit
        </text>
        <hstack alignment="start middle" gap="small">
          <text size="small" weight="bold">{directActionsEnabled ? 'ON' : 'OFF'}</text>
          <button
            size="small"
            appearance={directActionsEnabled ? 'destructive' : 'secondary'}
            onPress={onToggleDirectActions}
          >
            {directActionsEnabled ? 'Disable' : 'Enable'}
          </button>
        </hstack>
      </vstack>

      <vstack gap="small" padding="small" backgroundColor="#1a1a2e" cornerRadius="small">
        <text size="xsmall" color="#a0a0ff" weight="bold">QUEUE STATUS</text>
        <text size="small">{itemCount} items in queue</text>
        <button size="small" appearance="secondary" onPress={onRefreshQueue}>
          Refresh Queue ↻
        </button>
      </vstack>
    </vstack>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/settings-view.tsx
git commit -m "feat: add SettingsView block component"
```

---

## Task 5: TriageView component

**Files:**
- Create: `src/ui/triage-view.tsx`

- [ ] **Step 1: Create `src/ui/triage-view.tsx`**

```tsx
import { Devvit } from '@devvit/public-api';
import type { Recommendation, RiskLevel } from '../types/recommendation';
import type { ModItem } from '../types/mod-item';
import { riskColor, confidenceColor, truncate } from './helpers';

const RISK_LABELS: Record<RiskLevel, string> = {
  high: 'HIGH RISK',
  medium: 'MEDIUM',
  low: 'LOW',
};

interface TriageViewProps {
  recs: Recommendation[];
  modItems: Record<string, ModItem>;
  itemIndex: number;
  pendingInsightCount: number;
  directActionsEnabled: boolean;
  subredditName: string;
  onRemoveDirect: (id: string) => void | Promise<void>;
  onApproveDirect: (id: string) => void | Promise<void>;
  onNavigateToQueue: () => void;
  onSkip: () => void;
  onEscalate: (id: string) => void | Promise<void>;
  onViewInsights: () => void;
  onViewSettings: () => void;
  onRefresh: () => void | Promise<void>;
}

export function TriageView({
  recs,
  modItems,
  itemIndex,
  pendingInsightCount,
  directActionsEnabled,
  subredditName,
  onRemoveDirect,
  onApproveDirect,
  onNavigateToQueue,
  onSkip,
  onEscalate,
  onViewInsights,
  onViewSettings,
  onRefresh,
}: TriageViewProps): JSX.Element {
  const header = (
    <hstack gap="small" alignment="start middle" padding="small" border="thin">
      <text weight="bold" size="medium">⚡ AMIS</text>
      <spacer grow />
      <button appearance="plain" size="small" onPress={onViewInsights}>
        💡 {pendingInsightCount}
      </button>
      <button appearance="plain" size="small" onPress={onViewSettings}>⚙</button>
    </hstack>
  );

  if (recs.length === 0 || itemIndex >= recs.length) {
    return (
      <vstack grow>
        {header}
        <vstack alignment="center middle" grow gap="medium">
          <text size="large">Queue clear ✓</text>
          <text color="#888888">Nothing left to review</text>
          <button size="small" appearance="secondary" onPress={onRefresh}>
            Refresh ↻
          </button>
        </vstack>
      </vstack>
    );
  }

  const rec = recs[itemIndex];
  const item = modItems[rec.itemId];
  const displayTitle = item
    ? truncate(item.contentType === 'post' && item.title ? item.title : item.body, 80)
    : rec.itemId;
  const author = item?.author ?? '—';
  const contentType = item?.contentType ?? '—';
  const reportCount = item?.reportReasons?.length ?? 0;

  const high = recs.filter((r) => r.riskLevel === 'high').length;
  const medium = recs.filter((r) => r.riskLevel === 'medium').length;
  const low = recs.filter((r) => r.riskLevel === 'low').length;

  const handleRemove = directActionsEnabled
    ? () => onRemoveDirect(rec.itemId)
    : onNavigateToQueue;

  const handleApprove = directActionsEnabled
    ? () => onApproveDirect(rec.itemId)
    : onNavigateToQueue;

  return (
    <vstack grow>
      {header}
      <vstack padding="small" gap="small" grow>
        <hstack gap="small" alignment="start middle">
          <text weight="bold" color={riskColor(rec.riskLevel)} size="small">
            {RISK_LABELS[rec.riskLevel]}
          </text>
          <text weight="bold" size="xxlarge" color={confidenceColor(rec.confidenceScore)}>
            {rec.confidenceScore}%
          </text>
          <text color="#888888" size="xsmall">confidence</text>
        </hstack>

        <text weight="bold" wrap size="medium">{displayTitle}</text>
        <text size="xsmall" color="#888888">
          {contentType} · u/{author} · {reportCount} report{reportCount !== 1 ? 's' : ''}
        </text>

        <vstack backgroundColor="#1a1a2e" cornerRadius="small" padding="small" gap="xsmall">
          <text size="xsmall" color="#a0a0ff" weight="bold">MATCHED RULE</text>
          <text size="small">
            {rec.matchedPolicyTitle ?? 'No match'} — {rec.similarity.toFixed(2)}
          </text>
        </vstack>

        <vstack backgroundColor="#1a1a2e" cornerRadius="small" padding="small" gap="xsmall">
          <text size="xsmall" color="#a0a0ff" weight="bold">RATIONALE</text>
          <text size="small" wrap>{rec.rationale}</text>
        </vstack>

        <hstack gap="small">
          <button size="small" appearance="destructive" onPress={handleRemove}>
            {directActionsEnabled ? 'Remove' : 'Remove ↗'}
          </button>
          <button size="small" appearance="success" onPress={handleApprove}>
            {directActionsEnabled ? 'Approve' : 'Approve ↗'}
          </button>
          <button size="small" appearance="secondary" onPress={onSkip}>Skip →</button>
          <button size="small" appearance="caution" onPress={() => onEscalate(rec.itemId)}>
            Escalate
          </button>
        </hstack>

        <hstack alignment="center middle">
          <text size="xsmall" color="#888888">
            Item {itemIndex + 1} of {recs.length} · {high} high · {medium} med · {low} low
          </text>
        </hstack>
      </vstack>
    </vstack>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/triage-view.tsx
git commit -m "feat: add TriageView block component with item card and action buttons"
```

---

## Task 6: DashboardPreview + DashboardPost root + main.ts wiring

**Files:**
- Create: `src/ui/dashboard-preview.tsx`
- Create: `src/ui/dashboard-post.tsx`
- Modify: `src/main.ts`

- [ ] **Step 1: Create `src/ui/dashboard-preview.tsx`**

This is the fallback element shown while the custom post type loads. Must be a JSX element — kept in a `.tsx` file so `main.ts` stays JSX-free.

```tsx
import { Devvit } from '@devvit/public-api';

export function makeDashboardPreview(): JSX.Element {
  return (
    <vstack alignment="center middle" grow>
      <text size="large">⚡ AMIS Dashboard</text>
      <text color="#888888">Loading...</text>
    </vstack>
  );
}
```

- [ ] **Step 2: Create `src/ui/dashboard-post.tsx`**

```tsx
import { Devvit, useState, useAsync } from '@devvit/public-api';
import { KEYS } from '../storage/keys';
import { getAllRecommendations } from '../storage/recommendation-store';
import { listInsights, acknowledgeInsight } from '../storage/insight-store';
import { getModItem, getAllModItemIds } from '../storage/mod-item-store';
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

  const { data, loading, error } = useAsync<DashboardData>(async () => {
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

    return {
      recs: sortedRecs,
      modItems,
      insights: rawInsights,
      directActionsEnabled: rawDirectActions === 'true',
      aiProvider: (rawAiProvider as string | undefined) ?? 'claude',
    };
  }, {
    finally: (loaded) => {
      if (loaded) setDirectActionsEnabled(loaded.directActionsEnabled);
    },
  });

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
          {(error as Error).message ?? 'Unknown error — please retry'}
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
```

- [ ] **Step 3: Update `src/main.ts`**

Add these imports at the top (after the existing imports):

```typescript
import { DashboardPost } from './ui/dashboard-post';
import { makeDashboardPreview } from './ui/dashboard-preview';
```

Add `addCustomPostType` registration (after `Devvit.configure`):

```typescript
Devvit.addCustomPostType({
  name: 'AMIS Dashboard',
  height: 'tall',
  render: DashboardPost,
});
```

Add this menu item (after the existing `AMIS: Analyze Queue` menu item):

```typescript
Devvit.addMenuItem({
  label: 'AMIS: Open Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { kvStore, reddit, ui, subredditName } = context;
    if (!subredditName) {
      ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const existingId = await kvStore.get(KEYS.dashboardPostId) as string | undefined;
    if (existingId) {
      const post = await reddit.getPostById(existingId);
      ui.navigateTo(post);
      return;
    }
    const post = await reddit.submitPost({
      title: 'AMIS — AI Moderation Intelligence Dashboard',
      subredditName,
      preview: makeDashboardPreview(),
    });
    await kvStore.put(KEYS.dashboardPostId, post.id);
    ui.navigateTo(post);
  },
});
```

The full `src/main.ts` after all changes:

```typescript
import { Devvit } from '@devvit/public-api';
import { createAIProvider } from './ai/provider';
import { runQueueProcessor } from './jobs/queue-processor';
import { runHealthCheck } from './triggers/health-check';
import { runPolicyRefresh } from './triggers/policy-refresh';
import { runRecommendationEngine } from './recommendations/engine';
import { KEYS } from './storage/keys';
import { DashboardPost } from './ui/dashboard-post';
import { makeDashboardPreview } from './ui/dashboard-preview';

Devvit.configure({
  kvStore: true,
  redditAPI: true,
  http: true,
});

Devvit.addCustomPostType({
  name: 'AMIS Dashboard',
  height: 'tall',
  render: DashboardPost,
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

Devvit.addMenuItem({
  label: 'AMIS: Open Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { kvStore, reddit, ui, subredditName } = context;
    if (!subredditName) {
      ui.showToast('AMIS: subreddit name unavailable');
      return;
    }
    const existingId = await kvStore.get(KEYS.dashboardPostId) as string | undefined;
    if (existingId) {
      const post = await reddit.getPostById(existingId);
      ui.navigateTo(post);
      return;
    }
    const post = await reddit.submitPost({
      title: 'AMIS — AI Moderation Intelligence Dashboard',
      subredditName,
      preview: makeDashboardPreview(),
    });
    await kvStore.put(KEYS.dashboardPostId, post.id);
    ui.navigateTo(post);
  },
});

export default Devvit;
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If TypeScript complains about JSX types in `main.ts` (e.g., `JSX.Element` not found), add `"types": ["@devvit/public-api"]` to tsconfig `compilerOptions` and retry.

- [ ] **Step 5: Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: 126 tests passing (114 original + 12 new helpers tests). The new tsx files are not unit-testable but must not break the existing suite.

- [ ] **Step 6: Commit**

```bash
git add src/ui/dashboard-preview.tsx src/ui/dashboard-post.tsx src/main.ts
git commit -m "feat: add DashboardPost custom post type and Open Dashboard menu item"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
npm test -- --no-coverage
```

Expected: 126 tests passing, 0 failing.

- [ ] **Step 2: TypeScript clean compile**

```bash
npx tsc --noEmit
```

Expected: 0 errors in source files (pre-existing `@devvit/public-api` node_modules declaration warnings are acceptable).

- [ ] **Step 3: Verify exit criteria**

```bash
# Custom post type registered
grep -c 'addCustomPostType' src/main.ts

# Open Dashboard menu item exists
grep -c 'Open Dashboard' src/main.ts

# dashboardPostId key exists
grep -c 'dashboardPostId' src/storage/keys.ts

# directActionsEnabled key exists
grep -c 'directActionsEnabled' src/storage/keys.ts

# All 3 views implemented
ls src/ui/
```

Expected: each grep returns >= 1; `ls src/ui/` shows: `dashboard-post.tsx dashboard-preview.tsx helpers.ts insights-view.tsx settings-view.tsx triage-view.tsx`.

- [ ] **Step 4: Integration checklist (via `devvit playtest`)**

Manual verification — run `devvit playtest` on a test subreddit and confirm:

```
[ ] "AMIS: Open Dashboard" appears in subreddit menu for moderators
[ ] First click creates a new post titled "AMIS — AI Moderation Intelligence Dashboard"
[ ] Second click navigates to the same existing post (no new post created)
[ ] Dashboard post renders — shows triage view or "Loading queue..." spinner
[ ] After running "AMIS: Analyze Queue", triage view shows recommendations
[ ] Risk badge colors: red for high, orange for medium, green for low
[ ] Low-confidence items (< 70%) show confidence in orange
[ ] Tapping 💡 badge navigates to insights view
[ ] Insights view shows unacknowledged insights with Acknowledge button
[ ] Acknowledge removes insight from pending list without page reload
[ ] Tapping ⚙ navigates to settings view
[ ] Direct Actions toggle persists across dashboard re-opens
[ ] When Direct Actions OFF: Remove/Approve open mod queue URL
[ ] When Direct Actions ON: Remove calls reddit.remove, shows toast
[ ] Refresh Queue in settings updates the item list
[ ] Empty queue shows "Queue clear ✓" state
```

- [ ] **Step 5: Final commit if any fixes were made**

```bash
git add -p  # stage only intentional changes
git commit -m "fix: address playtest integration issues"
```

---

## Exit Criterion Summary

- `npm test` — 126 tests green
- `npx tsc --noEmit` — 0 source errors
- `src/main.ts` contains `addCustomPostType`, `AMIS: Open Dashboard` menu item
- `src/ui/` contains all 6 files (4 tsx + 2 ts)
- A non-technical observer watching `devvit playtest` can explain: what each item card shows, why the AI suggested that action, and that the moderator remains in control at all times
