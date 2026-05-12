# Docs Update — CLAUDE.md + README.md Design

**Date:** 2026-05-12
**Audience:** Hackathon judges + developers/contributors (balanced)

---

## Overview

Two documentation files need to be written/updated:

1. **README.md** — does not yet exist. Serves dual audience: judges want to understand what AMIS is and why it's impressive; developers want exact steps to install, configure, run, test, and deploy.
2. **CLAUDE.md** — exists but describes phases 5–6 as stretch goals (now shipped) and lacks coding-pattern guidance for future AI work.

---

## Section 1: README.md

### 1.1 Header

Project name, one-sentence tagline, and a 2–3 sentence paragraph explaining what AMIS does and what makes it different (semantic policy embeddings, not keyword rules; every suggestion explained; mods always in control).

### 1.2 Features

Bulleted list, one line each, mapping to the five shipped phases:
- Phase 1: Queue ingestion — fetches reported posts/comments from Reddit mod queue, normalises, stores
- Phase 2: Policy intelligence — ingests subreddit rules, automod YAML, wiki pages, removal reasons into a semantic embedding store
- Phase 3: Recommendation engine — matches each queue item to the closest policy, produces action + confidence % + AI rationale
- Phase 4: Consistency analytics — detects enforcement drift, decision divergence, and moderator variance over time
- Phase 5: Devvit dashboard — persistent triage UI pinned in the subreddit; one-item-at-a-time review; insights panel; settings panel

### 1.3 Prerequisites

- Node.js ≥ 18 and npm
- Devvit CLI: `npm install -g devvit`
- Reddit account that is a moderator of the target subreddit
- **Voyage AI API key** (always required — used for embeddings regardless of text-generation provider)
- **One text-generation API key**: Anthropic (Claude), OpenAI, or Google Gemini

### 1.4 Setup

Numbered steps:
1. `git clone` + `npm install`
2. `devvit login` (browser OAuth — mod account required)
3. `devvit upload` to register the app version
4. Install the app on the subreddit from the Reddit UI (`r/yoursubreddit` → App Directory)
5. Configure app settings (see Section 1.7 reference table) via the app settings page in Reddit's developer portal or via the Devvit CLI

### 1.5 Running Locally (Playtest)

```bash
devvit playtest r/yoursubreddit
```

Explains: playtest mode hot-reloads on file change; the app runs on Reddit's servers but with dev-mode flagging; all menu items and the dashboard post are live.

### 1.6 Running Tests

```bash
npm test                  # run full suite (132 tests)
npm run test:watch        # watch mode for TDD
```

Note: Devvit block components (`.tsx` UI files) require the Devvit runtime and are not unit-testable in Jest. They are verified via `devvit playtest`.

### 1.7 Deployment

```bash
npm run build             # compile TypeScript → dist/
devvit upload             # upload new version to Devvit
devvit publish            # publish to Reddit App Directory (makes it installable)
```

Note: `devvit upload` alone is sufficient for subreddits where the app is already installed. `devvit publish` is only needed for public listing.

### 1.8 Menu Items Reference

Table with columns: **Menu Label** | **What It Does** | **When to Run**

| Menu Label | What It Does | When to Run |
|---|---|---|
| AMIS: Health Check | Shows item count, embedding count, and pending insights count as a toast | Verify installation |
| AMIS: Refresh Policy | Re-ingests subreddit rules, automod YAML, wiki pages, removal reasons into embedding store | After rule changes |
| AMIS: Analyze Queue | Runs recommendation engine on current queue; generates suggested actions + rationale | Before triaging |
| AMIS: Consistency Check | Runs consistency analytics (requires ≥ 50 mod decisions); generates divergence/drift/variance insights | Periodically |
| AMIS: Open Dashboard | Creates (first time) or navigates to the pinned AMIS dashboard post | Daily triage |

### 1.9 App Settings Reference

Table with columns: **Setting Name** | **Required?** | **Description**

| Setting Name | Required | Description |
|---|---|---|
| `VOYAGE_API_KEY` | Always | Voyage AI key for generating embeddings. Get one at voyageai.com |
| `AI_PROVIDER` | Optional | `claude` (default) \| `openai` \| `gemini` \| `custom` |
| `AI_API_KEY` | Required if using claude/openai/gemini | API key for the chosen text-generation provider |
| `WIKI_PAGES` | Optional | Comma-separated wiki page names to ingest (e.g. `rules,guidelines`) |
| `CUSTOM_API_BASE_URL` | Only for `custom` provider | OpenAI-compatible base URL (e.g. `http://localhost:11434/v1`) |
| `CUSTOM_MODEL` | Only for `custom` provider | Model name to pass to the custom endpoint |

### 1.10 Architecture Overview

Short text diagram of the seven processing layers (same as CLAUDE.md but trimmed to 5–6 lines). Followed by a sentence pointing to `CLAUDE.md` for deeper architectural detail.

### 1.11 Hard Constraints

Three bullet points:
- AMIS never auto-removes, auto-approves, or overrides moderator decisions
- Every recommendation includes a confidence score and plain-English rationale
- Direct actions (remove/approve from the dashboard) default to OFF — mods must enable explicitly

---

## Section 2: CLAUDE.md Changes

### 2.1 Update "MVP Scope" → "Shipped Phases"

Remove the sentence: "Consistency analytics (Phases 5–6) are stretch goals."

Rename section to **Shipped Phases** and list all five shipped phases:
- Phase 1: Queue ingestion + storage (KV store, mod item normalisation, embeddings)
- Phase 2: Policy intelligence (rules, automod YAML, wiki, removal reasons → embedding store)
- Phase 3: Recommendation engine (semantic match + action suggestion + rationale generation)
- Phase 4: Consistency analytics (mod log fetcher, divergence/drift/variance detectors, insight generator)
- Phase 5: Devvit dashboard (custom post type, triage/insights/settings views)

### 2.2 Add "Coding Patterns" Section

New section added after "AI Strategy". Documents four patterns for future Claude sessions:

**Adding a new AI provider:**
1. Create `src/ai/<name>.ts` implementing both `EmbeddingClient` and `TextGenerationClient` interfaces from `src/ai/types.ts`
2. Add a case to the factory in `src/ai/provider.ts` matching `AI_PROVIDER` setting value
3. Add two `addSettings` entries in `src/main.ts`: one for the API key (secret), one for any provider-specific config
4. Follow the existing pattern: VoyageAI for embeddings, Anthropic/OpenAI/Gemini SDK for text generation

**Adding a new storage key:**
1. Add the key to the `KEYS` object in `src/storage/keys.ts`
2. Naming convention: static keys use `snake_case` strings; dynamic keys are functions returning `prefix:id`
3. Create a corresponding store file in `src/storage/` with `save*`, `get*`, `list*` functions taking `(kv: KVStore, ...)` as first arg

**Adding a new menu item:**
1. Use `Devvit.addMenuItem({ label, location: 'subreddit', forUserType: 'moderator', onPress })` in `src/main.ts`
2. Always guard with `if (!context.subredditName)` before using it
3. Show result as a `context.ui.showToast(...)` — menu items have no return value UI

**Adding a new Devvit block component:**
1. Create a `.tsx` file in `src/ui/` — `.tsx` extension required for JSX
2. Import `Devvit` from `@devvit/public-api` in every `.tsx` file (JSX factory)
3. `gap="xsmall"` is **not** a valid `ContainerGap` value — use `gap="small"` as the smallest gap
4. `useAsync` and `useState` hooks must be called at the root component level (no conditional hook calls)
5. `useAsync<T>` requires `T extends JSONValue` — use `as any` return + explicit cast on `data` for complex types

---

## File Inventory

### New Files
```
README.md                  — full project documentation for judges and developers
```

### Modified Files
```
CLAUDE.md                  — update MVP Scope → Shipped Phases; add Coding Patterns section
```

---

## Testing Strategy

Documentation only — no tests. Verification:
- `npm test` still passes after changes (nothing in tests/ depends on CLAUDE.md or README.md)
- Manually read both files to confirm links, table alignment, and command accuracy
