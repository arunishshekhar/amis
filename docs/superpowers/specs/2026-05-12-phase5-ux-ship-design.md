# Phase 5 — UX + Ship Design

**Date:** 2026-05-12
**Depends on:** Phases 1–4 complete
**Unlocks:** Hackathon submission

---

## Overview

Phase 5 delivers the moderator-facing UI layer. Everything built in Phases 1–4 surfaces through a single Devvit custom post type — a triage-focused dashboard that shows AI recommendations in context, explains every decision, and surfaces consistency insights to the mod team.

---

## Section 1: Architecture

### Entry Point

The dashboard is a **Devvit custom post** (`legacy Blocks custom post API`) — a single persistent post pinned in the subreddit that renders the full interactive UI. The post is created once and reused across all subsequent opens.

**"AMIS: Open Dashboard" menu item behavior:**
1. Reads `KEYS.dashboardPostId` from KV
2. If present: calls `context.ui.navigateTo(postPermalink)`
3. If absent: calls `reddit.submitPost(...)` with the AMIS custom post type, stores the returned post ID at `KEYS.dashboardPostId`, then navigates to it

**Post type registration:**
```typescript
legacy Blocks custom post API({
  name: 'AMIS Dashboard',
  height: 'tall',
  render: DashboardPost,
});
```

### Navigation Model

The post renders a **state machine** — no URL routing. State lives in `useState`:

```typescript
type View = 'triage' | 'insights' | 'settings';
const [view, setView] = useState<View>('triage');
```

The triage view is the default. The header's insights badge and settings gear navigate to their respective views; a back button on each returns to triage.

### JSX Configuration

The tsconfig must be updated to support Devvit's JSX factory:
```json
"jsx": "react",
"jsxFactory": "Devvit.createElement",
"jsxFragmentFactory": "Devvit.Fragment"
```

All UI files use `.tsx` extension. `Devvit` must be imported in every `.tsx` file.

---

## Section 2: New Storage Keys

Three keys added to `src/storage/keys.ts`:

```typescript
dashboardPostId: 'dashboard_post_id',
directActionsEnabled: 'direct_actions_enabled',
escalation: (id: string) => `escalation:${id}`,
```

`directActionsEnabled` stores `'true'` or `'false'` (string). It is read and written directly from the dashboard's settings view using `kv.get` / `kv.put` — no Devvit setting involved, since Devvit settings cannot be written from within the app UI.

---

## Section 3: Triage View

The primary view — shows queue items one at a time in priority order.

### Data Loading

`useAsync` fetches:
- All `Recommendation` records via `getAllRecommendations(kv)`
- All `ModItem` records via `getAllModItemIds(kv)` → `getModItem(kv, id)` for each

Items are sorted: `riskLevel` (high → medium → low), then `confidenceScore` (descending). The current item index is tracked in `useState<number>(0)`.

### Item Card

Each card displays (in order):
1. **Risk badge** — `HIGH RISK` / `MEDIUM` / `LOW` colored red / orange / green
2. **Confidence %** — displayed prominently as a hero number
3. **Item title** — truncated to 80 characters
4. **Author · content type · report count**
5. **Matched rule** — rule name + similarity score (e.g. `No Spam — 0.91`)
6. **Rationale** — the AI-generated reasoning string from the Recommendation record
7. **Action buttons** — Remove · Approve · Skip · Escalate

### Action Button Behavior

Reads `directActionsEnabled` from KV at load time:

- **`directActionsEnabled = 'false'` (default):** Remove and Approve call `context.ui.navigateTo(item.permalink)` — opens the Reddit mod queue item in a new tab. The moderator takes action there.
- **`directActionsEnabled = 'true'`:** Remove calls `context.reddit.remove(item.id)`, Approve calls `context.reddit.approve(item.id)`, then shows a toast and advances to the next item.
- **Skip:** advances `itemIndex` without any API call.
- **Escalate:** writes an escalation flag to KV (`KEYS.escalation(item.id)`), shows a toast, advances to next item.

### Queue Counter

Footer bar: `Item N of M · X high · Y medium · Z low`

### Header

```
⚡ AMIS Dashboard        💡 {pendingInsightCount}   ⚙
```

The insight badge (`💡`) shows the count of unacknowledged insights. Tapping it sets `view = 'insights'`. Tapping `⚙` sets `view = 'settings'`.

### Empty State

When `itemIndex >= items.length`: displays "Queue clear ✓ — nothing left to review" with a Refresh button.

### Error State

If `useAsync` rejects: displays "Unable to load queue — tap to retry" with a retry trigger.

### Low-Confidence Visual Distinction

Items with `confidenceScore < 70` show the confidence number in **orange** (not green/red) to signal uncertainty. The risk badge is still shown but with reduced saturation.

---

## Section 4: Insights View

Reached by tapping the insights badge in the header.

### Content

- Fetches all `ConsistencyInsight` records via `listInsights(kv)`, sorted: unacknowledged first, then by `detectedAt` descending.
- Each insight card:
  - **Type badge** — `DIVERGENCE` (blue) · `DRIFT` (orange) · `VARIANCE` (purple)
  - **Policy title**
  - **AI description** (the generated plain-language text)
  - **Supporting stats** — rendered as key:value pairs from `insight.stats`
  - **Acknowledge button** — calls `acknowledgeInsight(kv, insight.id)`, removes card from the pending list in local state

### Header

`← Insights    {N} pending`

Back arrow sets `view = 'triage'`.

### Empty State

"No pending insights — consistency looks good"

---

## Section 5: Settings View

Reached by tapping the ⚙ gear in the triage header.

### Content

Three sections:

**AI Provider (read-only)**
- Reads `AI_PROVIDER` setting from `context.settings.get('AI_PROVIDER')`
- Displays: `Provider: claude · model: claude-haiku-4-5`

**Direct Actions Toggle**
- Reads `directActionsEnabled` from KV at load time
- Toggle button shows `ON` or `OFF`
- Tap: writes the inverse value to KV, updates local state immediately
- Label: "Execute remove/approve from dashboard without leaving"

**Queue Management**
- Shows last-known item count and a "Refresh Queue ↻" button
- Refresh button calls `createAIProvider(context.settings)` then `runQueueProcessor(subredditName, kv, provider.embedding, reddit)` inline (not via scheduler) so the dashboard updates immediately
- After refresh, displays a toast: "Queue refreshed: N items"

### Header

`← Settings`

Back arrow sets `view = 'triage'`.

---

## Section 6: File Inventory

### New Files

```
src/ui/dashboard-post.tsx     — CustomPostType root component; state machine; header
src/ui/triage-view.tsx        — triage view; item card; action buttons; queue counter
src/ui/insights-view.tsx      — insights list; insight cards; acknowledge button
src/ui/settings-view.tsx      — settings panel; direct actions toggle; queue refresh
```

### Modified Files

```
src/storage/keys.ts           — add dashboardPostId, directActionsEnabled, escalation(id)  (3 new keys)
src/main.ts                   — legacy custom post API; update "Open Dashboard" menu item
tsconfig.json                 — add jsx, jsxFactory, jsxFragmentFactory
```

---

## Section 7: Testing Strategy

Devvit UI components require the Devvit runtime and cannot be unit-tested in Jest.

**What CAN be Jest-tested (pure logic):**
- Item sort order function: `sortItemsByRisk(recs)` → `Recommendation[]`
- Risk color mapper: `riskColor(level)` → string
- Stats formatter: `formatStats(stats)` → string

These are exported as plain functions from the view files and covered by small unit tests.

**Integration testing:** `devvit playtest` on a test subreddit. Manual checklist:
- Dashboard post is created on first "Open Dashboard" click
- Second click navigates to the existing post
- Triage view loads items in correct order
- Action buttons navigate (or execute, if direct actions enabled)
- Insights view shows unacknowledged insights
- Acknowledge button removes card from list
- Direct actions toggle persists across sessions (KV-backed)
- Refresh Queue updates item count

**Demo flow verification:**
- Install app on a subreddit with ≥5 queued items
- Run Policy Refresh and Analyze Queue from menu
- Open Dashboard
- Triage 3 items (remove, approve, skip)
- Tap insights badge, acknowledge one insight
- Toggle direct actions ON in settings
- A non-technical observer watching can explain the system without assistance

---

## Hard Constraints

- Direct actions default to `OFF` — moderators must explicitly enable them
- Low-confidence items (`< 70%`) are visually distinct — never suppressed
- No per-moderator data shown anywhere in the UI
- All error states display plain English — no raw exception messages
- Dashboard post is mod-initiated, not auto-created on install
