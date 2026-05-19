# AMIS — AI Moderation Intelligence System

A Devvit-native Reddit app that brings AI intelligence to subreddit moderation. AMIS analyses your mod queue in real time, classifies posts against your subreddit's own rules using a two-tier ML pipeline (vector embeddings + LLM), and surfaces prioritised recommendations through an interactive dashboard — all without leaving Reddit.

> **v0.0.10** — production-ready with auto-polling dashboard, History view, two-tier cost-optimised AI classification, and multi-provider support.

---

## Features

- **Real-time post analysis** — every new post is classified within seconds via a `PostSubmit` trigger; configurable auto-remove/approve threshold
- **Two-tier AI classification** — cheap vector embedding search pre-screens posts; LLM inference runs only for ambiguous cases (0.45–0.85 similarity) and reported posts — reducing AI costs by ~60–70%
- **Policy intelligence** — ingests your subreddit's rules (title + description), automod YAML, wiki pages, and removal reasons into a semantic embedding store; every recommendation is grounded in *your* rules
- **Recommendation engine** — cosine similarity match → suggested action (remove / approve / escalate / monitor), confidence percentage, and plain-English AI rationale
- **Smart caching** — approve verdicts cached for 24 hours; non-approve verdicts cached until post changes; 7-day staleness filter on unmoderated posts to avoid stale content re-analysis
- **History view** — paginated, filterable log of all moderation actions with AND-logic filters (By AI / Approved / Removed / Escalated)
- **Consistency analytics** — analyses 50+ mod decisions for enforcement drift, divergence, and rule-category variance; surfaces insights in the dashboard
- **Auto-polling dashboard** — custom post auto-refreshes every 15 seconds; no manual page reload needed
- **Live job feedback** — countdown banner (`⏳ AI analysing — 38s`) while background analysis runs
- **Multi-provider AI** — OpenAI, Google Gemini, Anthropic Claude, or any OpenAI-compatible local endpoint (Ollama, LM Studio)
- **Duplicate detection** — near-duplicate posts (>85% embedding similarity) are flagged automatically

---

## Prerequisites

- Node.js ≥ 18 and npm
- Devvit CLI: `npm install -g devvit`
- A Reddit account that is a **moderator** of your target subreddit
- An API key for one AI provider: **OpenAI** (recommended), **Google Gemini**, **Anthropic Claude**, or a custom/local endpoint
- *(Claude and custom providers only)* A [Voyage AI](https://www.voyageai.com/) API key for embeddings

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/arunishshekhar/amis.git
cd amis
npm install
```

### 2. Log in to Devvit

```bash
devvit login
```

A browser window opens for Reddit OAuth. Log in with your moderator account.

### 3. Upload the app

```bash
devvit upload
```

### 4. Install on your subreddit

Go to your subreddit → **Mod Tools** → **App Directory** → find AMIS → **Install**.

Or via CLI:

```bash
devvit install r/yoursubreddit
```

### 5. Configure app settings

In the Reddit developer portal, navigate to your app's settings page. See the [App Settings Reference](#app-settings-reference) below.

---

## Running Locally (Playtest)

```bash
devvit playtest r/yoursubreddit
```

Hot-reloads on file changes. The app runs on Reddit's servers with your local code. Press `Ctrl+C` to stop.

---

## Running Tests

```bash
npm test               # run full test suite
npm run test:watch     # watch mode
```

> **Note:** The dashboard is a Devvit Web view in `public/index.html`; server behavior and pure logic are covered by Jest. End-to-end web view behavior is verified with `devvit playtest`.

---

## Deployment

```bash
devvit upload          # upload new version (sufficient for installed subreddits)
devvit publish         # publish to the public Reddit App Directory
```

---

## Usage: Menu Items

All items appear under **Subreddit → Mod Tools** (moderators only).

| Menu Label | What It Does | When to Run |
|---|---|---|
| **AMIS: Health Check** | Shows item count, embedding count, and pending insight count | After install; verify setup |
| **AMIS: Refresh Policy** | Re-ingests subreddit rules (title + description), automod YAML, wiki pages, removal reasons | After changing any rules |
| **AMIS: Analyze Queue** | Schedules a background batch analysis of the mod queue | On demand (also runs every 2 min automatically) |
| **AMIS: Consistency Check** | Schedules consistency analytics (requires ≥ 50 mod decisions); results appear in 💡 Insights | Weekly or after high-volume activity |
| **AMIS: Open Dashboard** | Creates the AMIS dashboard post or navigates to the existing one | Daily triage |

> **All menu actions that involve AI run as background scheduled jobs** — they return immediately with a toast and complete asynchronously (no UI timeout).

**Recommended workflow:**
1. `AMIS: Refresh Policy` — after any rule changes
2. Open the dashboard — it auto-analyses and auto-refreshes every 15s
3. `AMIS: Consistency Check` — weekly

---

## Dashboard Views

| View | Access | Description |
|---|---|---|
| **Triage** | Default | One-at-a-time review of flagged posts with Remove / Approve / Skip / Escalate actions |
| **📋 History** | Header button | Paginated log of all actions, filterable by By AI / Approved / Removed / Escalated (AND logic) |
| **💡 Insights** | Header button | Consistency analytics and enforcement drift alerts |
| **⚙️ Settings** | Header button | AI provider info, full-screen layout toggle, manual queue refresh |

---

## App Settings Reference

| Setting | Required | Description |
|---|---|---|
| `VOYAGE_API_KEY` | Claude/custom only | Voyage AI API key for embeddings |
| `AI_PROVIDER` | Optional | `openai` (default) \| `gemini` \| `claude` \| `custom` |
| `AI_API_KEY` | Required | API key for the chosen text-generation provider |
| `CUSTOM_API_BASE_URL` | `custom` only | OpenAI-compatible base URL (e.g. `http://localhost:11434/v1`) |
| `CUSTOM_MODEL` | `custom` only | Model name for custom endpoint (e.g. `llama3`) |
| `AUTO_ACT_ENABLED` | Optional | Enable automatic remove/approve on new posts (default: false) |
| `AUTO_REMOVE_THRESHOLD` | Optional | Confidence threshold for auto-remove (0–100, default: 90) |

---

## Architecture

```
New Post Submitted
      │
      ▼
[PostSubmit Trigger]           [Cron Job: every 2 min]
Immediate LLM analysis          Batch queue processor
      │                                │
      ▼                                ▼
┌──────────────────────────────────────────────────┐
│          Two-Tier Classification Pipeline         │
│                                                  │
│  1. Batch embed all posts (1 API call)           │
│  2. Cosine search → closest policy match         │
│  3. Similarity routing:                          │
│     < 0.45  → auto-approve (no LLM, very cheap) │
│     ≥ 0.85  → auto-flag   (no LLM)             │
│     0.45–0.85 or reported → LLM classify        │
│  4. Save recommendation to KV                    │
└──────────────────────────────────────────────────┘
      │
      ▼
KV Store (Recommendations, ModItems, History, Insights)
      │
      ▼
┌─────────────────────────────┐
│  Dashboard (Custom Post)    │
│  ┌────────┬───────┬──────┐  │
│  │ Triage │History│Insight│  │
│  └────────┴───────┴──────┘  │
│  Auto-polls KV every 15s    │
│  Live countdown on analysis │
└─────────────────────────────┘
```

See `CLAUDE.md` for detailed architectural notes, coding patterns, and Devvit platform constraints.

---

## Hard Constraints

- **Actions always execute on Reddit** — Remove/Approve from the dashboard immediately calls `reddit.remove()` / `reddit.approve()`. There is no "dry run" mode.
- **Every recommendation includes confidence score and rationale** — no black-box AI decisions.
- **History is permanent** — actioned items are never purged from KV; they accumulate as a permanent moderation log.
- **LLM prompt is factual-accuracy aware** — the classifier actively reasons about truth (e.g. "2+2=5" is flagged) not just text pattern matching.
