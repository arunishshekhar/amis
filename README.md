# AMIS — AI Moderation Intelligence System

A Devvit-native Reddit app that brings semantic AI intelligence to subreddit moderation. AMIS analyses your mod queue, matches items against your subreddit's own rules using embeddings, and surfaces actionable recommendations — with full reasoning — while keeping every decision in the moderator's hands.

Built for the Reddit Mod Tools Hackathon.

## Features

- **Queue ingestion** — fetches reported posts and comments from your mod queue, normalises them, and stores structured items with author, content type, report reasons, and timestamps
- **Policy intelligence** — ingests your subreddit's rules, automod YAML, wiki pages, and removal reasons into a semantic embedding store; every recommendation is grounded in *your* rules, not generic classifiers
- **Recommendation engine** — matches each queue item to the closest policy using cosine similarity, then generates a suggested action (remove / approve / escalate / monitor), a confidence percentage, and a plain-English AI rationale
- **Consistency analytics** — detects enforcement drift (approval rate shifting over time), decision divergence (similar items getting different outcomes), and variance across rule categories — framed as policy alignment insights, never as moderator blame
- **Triage dashboard** — a persistent Devvit custom post pinned in your subreddit; review items one at a time in priority order, acknowledge insights, toggle direct actions, and refresh the queue — without leaving Reddit

## Prerequisites

- Node.js ≥ 18 and npm
- Devvit CLI: `npm install -g devvit`
- A Reddit account that is a **moderator** of your target subreddit
- A [Voyage AI](https://www.voyageai.com/) API key (always required — used for embeddings)
- An API key for one text-generation provider: **Anthropic** (Claude), **OpenAI**, or **Google Gemini** (or a local OpenAI-compatible endpoint)

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
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

This registers the current version of the app on Reddit's platform. Required before playtest or install.

### 4. Install the app on your subreddit

Go to your subreddit → **Mod Tools** → **App Directory** → find AMIS → **Install**.

Alternatively, use the Devvit CLI:

```bash
devvit install r/yoursubreddit
```

### 5. Configure app settings

In the Reddit developer portal, navigate to your app's settings page and fill in the values from the [App Settings Reference](#app-settings-reference) table below.

## Running Locally (Playtest)

```bash
devvit playtest r/yoursubreddit
```

Playtest mode hot-reloads on file changes. The app runs on Reddit's servers with your local code. All menu items and the dashboard post are fully live. Press `Ctrl+C` to stop.

## Running Tests

```bash
npm test                 # run full test suite (132 tests across 22 suites)
npm run test:watch       # watch mode — re-runs on file change
```

**Note:** Devvit block components (`.tsx` UI files in `src/ui/`) require the Devvit runtime and cannot be unit-tested in Jest. They are verified via `devvit playtest`. All pure logic (helpers, engines, stores) is fully covered by Jest.

## Deployment

```bash
npm run build            # compile TypeScript → dist/
devvit upload            # upload new version to Devvit
```

To publish publicly to the Reddit App Directory:

```bash
devvit publish
```

`devvit upload` alone is sufficient for subreddits where the app is already installed. `devvit publish` is only needed for public listing in the App Directory.

## Usage: Menu Items

All menu items appear under **Subreddit → More Options** (mod accounts only).

| Menu Label | What It Does | When to Run |
|---|---|---|
| **AMIS: Health Check** | Shows item count, embedding count, and pending insight count as a toast notification | First check after install; verify everything is wired up |
| **AMIS: Refresh Policy** | Re-ingests subreddit rules, automod YAML, wiki pages, and removal reasons into the embedding store | After changing subreddit rules or automod config |
| **AMIS: Analyze Queue** | Runs the recommendation engine on the current mod queue; generates suggested actions + confidence + rationale | Before opening the triage dashboard |
| **AMIS: Consistency Check** | Runs consistency analytics (requires ≥ 50 mod decisions); generates divergence, drift, and variance insights | Periodically — weekly or after a wave of moderation activity |
| **AMIS: Open Dashboard** | Creates the pinned AMIS dashboard post (first run) or navigates to the existing one | Daily triage |

**Recommended flow for each moderation session:**

1. **AMIS: Refresh Policy** — keep rule embeddings current after any rule changes
2. **AMIS: Analyze Queue** — score and rank the current queue
3. **AMIS: Open Dashboard** — triage items one at a time

The scheduler also runs queue processing every 6 hours and consistency analysis daily at 2 AM automatically after install.

## App Settings Reference

Configure these in the Reddit developer portal under your app's settings page.

| Setting | Required | Description |
|---|---|---|
| `VOYAGE_API_KEY` | **Always** | Voyage AI API key for generating embeddings. Get one at [voyageai.com](https://www.voyageai.com/) |
| `AI_PROVIDER` | Optional | Text-generation provider: `claude` (default) \| `openai` \| `gemini` \| `custom` |
| `AI_API_KEY` | Required when using claude / openai / gemini | API key for the chosen text-generation provider |
| `WIKI_PAGES` | Optional | Comma-separated wiki page names to ingest as policy context (e.g. `rules,guidelines,faq`) |
| `CUSTOM_API_BASE_URL` | Only for `custom` provider | OpenAI-compatible base URL (e.g. `http://localhost:11434/v1` for Ollama) |
| `CUSTOM_MODEL` | Only for `custom` provider | Model name to pass to the custom endpoint |

## Architecture

```
Subreddit Installation
  → Policy Ingestion       (rules, automod YAML, wiki pages, removal reasons → embeddings)
  → Queue Fetch            (reported posts/comments → normalised ModItem records)
  → Embedding Generation   (item content → vector embeddings via Voyage AI)
  → Recommendation Engine  (cosine similarity match → action + confidence + rationale)
  → Consistency Analytics  (mod decision history → drift/divergence/variance insights)
  → Triage Dashboard       (Devvit custom post type — triage / insights / settings views)
```

See `CLAUDE.md` for detailed architectural notes, coding patterns, and hard constraints.

## Hard Constraints

- **AMIS never auto-removes, auto-approves, or overrides moderator decisions.** Every action requires explicit moderator confirmation.
- **Every recommendation includes a confidence score and plain-English rationale.** No black-box AI decisions.
- **Direct actions (remove/approve from the dashboard) default to OFF.** Moderators must explicitly enable this in the dashboard settings.
