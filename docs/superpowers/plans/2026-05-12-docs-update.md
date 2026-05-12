# Docs Update — CLAUDE.md + README.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create README.md for dual audience (judges + developers) and update CLAUDE.md to reflect all five shipped phases plus coding patterns for future work.

**Architecture:** Two independent file operations — create README.md from scratch, then make targeted edits to the bottom of CLAUDE.md. No tests involved; verification is manual read + confirming `npm test` still passes.

**Tech Stack:** Markdown, git.

---

## File Inventory

### New Files
```
README.md                        — full project documentation
```

### Modified Files
```
CLAUDE.md                        — replace MVP Scope section; add Coding Patterns section
```

---

## Task 1: Create README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

Write the following content exactly:

```markdown
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
```

- [ ] **Step 2: Verify the file was created**

```bash
wc -l README.md
```

Expected: approximately 130–160 lines.

```bash
head -5 README.md
```

Expected: starts with `# AMIS — AI Moderation Intelligence System`.

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
npm test -- --no-coverage
```

Expected: 132 tests passing. (README.md has no effect on tests — this is a sanity check.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, deployment, and usage guide"
```

---

## Task 2: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

The current CLAUDE.md ends with:

```
## AI Strategy (Three Layers)

1. **Deterministic logic** — thresholds, report counts, keyword rules, duplicate windows
2. **Semantic AI** — embeddings, summarization, similarity, policy interpretation (Claude API)
3. **Governance intelligence** — consistency analytics, policy drift (post-MVP)

## MVP Scope

Focus Phase 1–4 only:
- Devvit integration + queue ingestion + storage
- Embeddings + clustering + semantic search
- Rule ingestion + policy embeddings + moderation memory
- Moderation suggestions + reasoning generation

Consistency analytics (Phases 5–6) are stretch goals.
```

Two changes are needed:
1. Replace the `## MVP Scope` section with `## Shipped Phases`
2. Append a new `## Coding Patterns` section at the end

- [ ] **Step 1: Replace the MVP Scope section**

Find and replace the following block in `CLAUDE.md`:

**Old text (exact):**
```
## MVP Scope

Focus Phase 1–4 only:
- Devvit integration + queue ingestion + storage
- Embeddings + clustering + semantic search
- Rule ingestion + policy embeddings + moderation memory
- Moderation suggestions + reasoning generation

Consistency analytics (Phases 5–6) are stretch goals.
```

**New text:**
```
## Shipped Phases

All five phases are complete and deployed:

- **Phase 1** — Devvit integration + queue ingestion + storage (KV store, mod item normalisation, embedding generation)
- **Phase 2** — Policy intelligence (subreddit rules, automod YAML, wiki pages, removal reasons → embedding store)
- **Phase 3** — Recommendation engine (semantic match → action suggestion + confidence % + AI rationale)
- **Phase 4** — Consistency analytics (mod log fetcher, divergence / drift / variance detectors, insight generator)
- **Phase 5** — Devvit dashboard (custom post type, triage / insights / settings views, KV-backed direct actions toggle)
```

- [ ] **Step 2: Append the Coding Patterns section**

Append the following to the end of `CLAUDE.md` (after the Shipped Phases section):

```
## Coding Patterns

### Adding a new AI provider

1. Create `src/ai/<name>.ts` implementing both `EmbeddingClient` and `TextGenerationClient` interfaces from `src/ai/types.ts`
2. Add a case for the new provider name in the factory at `src/ai/provider.ts` (`createAIProvider` function)
3. Add two `Devvit.addSettings` entries in `src/main.ts`: one secret entry for the API key, one non-secret entry for any provider-specific config
4. The `AI_PROVIDER` setting value is the string that must match the new case in the factory

### Adding a new storage key

1. Add the key to the `KEYS` object in `src/storage/keys.ts`
2. Naming convention: static keys use `snake_case` strings (e.g. `'mod_item_index'`); dynamic keys are arrow functions returning `'prefix:id'` (e.g. `(id: string) => \`mod_item:${id}\``)
3. Create a corresponding store file in `src/storage/` with `save*`, `get*`, and `list*` functions — always take `(kv: KVStore, ...)` as the first argument
4. Follow the index pattern: store a list of IDs under a `*_index` key so callers can enumerate all records

### Adding a new menu item

1. Use `Devvit.addMenuItem({ label, location: 'subreddit', forUserType: 'moderator', onPress })` in `src/main.ts`
2. Always guard with `if (!context.subredditName)` before using `subredditName` — it can be undefined
3. Show results as `context.ui.showToast(...)` — menu item handlers have no return-value UI
4. Keep handlers thin: delegate to engine/store functions imported from `src/`

### Adding a new Devvit block component

1. Use `.tsx` extension — required for JSX syntax
2. Import `Devvit` from `@devvit/public-api` in every `.tsx` file — it is the JSX factory
3. `gap="xsmall"` is **not** a valid `ContainerGap` on `vstack`/`hstack` — the smallest valid value is `gap="small"`
4. All hooks (`useState`, `useAsync`) must be called at the root component level — no conditional hook calls
5. `useAsync<T>` requires `T extends JSONValue` — for complex domain types, omit the generic and cast `data` after: `const typed = data as MyType | null`
6. `useAsync` options `finally` callback signature is `(data: T | null, error: AsyncError | null) => void` — two parameters
7. Return type annotation on components is `JSX.Element`
```

- [ ] **Step 3: Verify the changes**

```bash
grep -n "Shipped Phases" CLAUDE.md
```

Expected: one match showing the new section header.

```bash
grep -n "Coding Patterns" CLAUDE.md
```

Expected: one match showing the new section header.

```bash
grep -c "stretch goals" CLAUDE.md
```

Expected: `0` — the old stretch-goals line is gone.

- [ ] **Step 4: Run tests to confirm no regressions**

```bash
npm test -- --no-coverage
```

Expected: 132 tests passing.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — shipped phases + coding patterns"
```

---

## Exit Criterion Summary

- `README.md` exists at the project root with all sections: Features, Prerequisites, Setup, Playtest, Tests, Deployment, Menu Items, App Settings, Architecture, Hard Constraints
- `CLAUDE.md` no longer contains "stretch goals" or "Phase 1–4 only"
- `CLAUDE.md` contains "Shipped Phases" and "Coding Patterns" sections
- `npm test` — 132 tests green
