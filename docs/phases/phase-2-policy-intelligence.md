# Phase 2 — Policy Intelligence

**Merges spec phases:** 3 (Community Policy Engine)
**Depends on:** Phase 1 (KV Store + embedding infrastructure)
**Unlocks:** Phase 3

---

## Goal

The app reads the subreddit's own rules, automod config, wiki pages, and removal reason history, and converts them into a searchable policy memory. This is the layer that makes recommendations subreddit-specific rather than generic.

---

## Outcomes

- Subreddit rules are ingested and stored as structured policy objects with a category, severity, and plain-language description
- AutoModerator config is parsed and its patterns/banned terms are extracted into the policy store
- Each policy object has an embedding vector stored alongside the `ModItem` embeddings from Phase 1
- A moderator can trigger "refresh policy" and see a confirmation: "X rules ingested, X automod patterns extracted"
- Semantic search against the policy store returns the most relevant rule for a given piece of text (verifiable via a dev console test)

---

## Exit Criterion

Given a sample post body, querying the policy store returns the top-3 most semantically relevant subreddit rules with similarity scores.

---

## Key Components

- Rule ingestion: parse subreddit rules API into structured `PolicyObject` records
- AutoModerator YAML parser: extract regex patterns, banned terms, and content thresholds
- Wiki ingestion: extract moderation philosophy and edge-case guidance from relevant wiki pages
- Removal reason ingestion: extract moderator rationale patterns from historical removal reasons
- Policy embedding generation: embed each `PolicyObject` using the same Claude API pipeline as Phase 1
- Semantic rule search: cosine similarity lookup against the policy embedding store

---

## Constraints

- Policy embeddings must be re-generated on "refresh policy" trigger, not on every queue run
- AutoMod config parsing must be tolerant of malformed YAML (log and skip invalid entries)
- No raw wiki or automod content stored beyond the extracted structured fields
