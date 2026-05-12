# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI Moderation Intelligence System (AMIS)** — a Devvit-native Reddit app for the Reddit Mod Tools Hackathon. It is NOT a moderation bot or auto-enforcer. It is a semantic moderation intelligence platform: AI provides queue analysis, rule-aware suggestions, and consistency insights, while human moderators retain full control.

The full spec lives in `AI_Moderation_Intelligence_System_Advanced_Plan.md`.

## Tech Stack

- **Platform:** [Devvit](https://developers.reddit.com/docs) (Reddit's developer platform)
- **Language:** TypeScript
- **AI/Embeddings:** Claude API (Anthropic SDK) for summarization, reasoning, and policy interpretation
- **Storage:** Devvit KV Store / Redis for moderation metadata, embeddings, and analytics

## Common Commands

Once scaffolded with `devvit new`:

```bash
npm run build          # compile TypeScript
devvit upload          # upload app to Reddit
devvit playtest        # test on a subreddit in dev mode
npm test               # run test suite
```

## Architecture

Seven processing layers, executed in order per moderation run:

```
Subreddit Installation
  → Policy Ingestion (rules, automod config, wiki, removal reasons, history)
  → Queue Fetch Pipeline (reported posts/comments, spam queue, unmoderated)
  → Normalization Layer (item ID, author, timestamp, body, report reasons, content type)
  → Embedding Generation (title, body, report reasons, rule text via Claude)
  → Semantic Classification + Duplicate Clustering (cosine similarity grouping)
  → Policy Alignment Engine (match queue items to subreddit-specific rule embeddings)
  → Recommendation Engine (suggested action + confidence + reasoning trace)
  → Consistency Analytics (drift detection, enforcement variance — optional/stretch)
  → Moderator Dashboard (Devvit UI blocks)
```

### Key Layers

**Community Policy Engine** — the technical moat. Ingests subreddit rules, automod YAML, wiki pages, and removal reason history into a policy embedding store. Every recommendation is grounded in THIS subreddit's rules, not generic classifiers.

**Semantic Intelligence Engine** — generates embeddings for queue items and clusters semantically similar violations (scam campaigns, repost waves, coordinated harassment). Each cluster has a representative example, confidence score, and recommended action.

**Recommendation Engine** — outputs: suggested action, confidence %, matched rule, moderation rationale, related historical examples, risk level. Always suggestions only — never automatic enforcement.

**Consistency Analytics** (stretch) — detects similar-content divergence, rule drift, and moderator action variance. Frame all output as "policy alignment analytics," never as moderator blame or bias detection.

## Hard Constraints

- **Never auto-ban, auto-remove, or override moderators.** Every action requires explicit moderator approval.
- **Always show confidence scores and reasoning traces.** No AI black boxes.
- **Do not expose public moderator rankings or name-specific variance data** outside the mod team view.
- **Store minimally** — avoid raw long-term content storage and unnecessary personal data.
- **Frame consistency insights as operational analytics**, not bias detection.

## AI Strategy (Three Layers)

1. **Deterministic logic** — thresholds, report counts, keyword rules, duplicate windows
2. **Semantic AI** — embeddings, summarization, similarity, policy interpretation (Claude API)
3. **Governance intelligence** — consistency analytics, policy drift (post-MVP)

## Shipped Phases

All five phases are complete and deployed:

- **Phase 1** — Devvit integration + queue ingestion + storage (KV store, mod item normalisation, embedding generation)
- **Phase 2** — Policy intelligence (subreddit rules, automod YAML, wiki pages, removal reasons → embedding store)
- **Phase 3** — Recommendation engine (semantic match → action suggestion + confidence % + AI rationale)
- **Phase 4** — Consistency analytics (mod log fetcher, divergence / drift / variance detectors, insight generator)
- **Phase 5** — Devvit dashboard (custom post type, triage / insights / settings views, KV-backed direct actions toggle)

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
