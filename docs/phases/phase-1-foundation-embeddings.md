# Phase 1 — Foundation + Embeddings

**Merges spec phases:** 1 (Platform Foundation) + 2 (Semantic Engine)
**Depends on:** nothing
**Unlocks:** Phase 2, Phase 3

---

## Goal

The app installs on a subreddit, fetches its moderation queue, normalizes each item into a standard shape, and generates semantic embeddings for every item. Nothing is shown to moderators yet — this phase is purely data pipeline.

---

## Outcomes

- A moderator can install the app on their subreddit without errors
- Devvit scheduled job runs and fetches the live modqueue (reported posts, reported comments, spam queue)
- Each queue item is normalized into a standard `ModItem` object: `{ id, author, timestamp, title, body, reportReasons, contentType, subredditId }`
- Each `ModItem` has a Claude-generated embedding vector stored in Devvit KV Store
- A health-check trigger confirms: "X items fetched, X embeddings stored"

---

## Exit Criterion

A developer can trigger the pipeline manually and verify embeddings exist in the KV store for at least 10 queue items.

---

## Key Components

- Devvit app lifecycle setup (permissions, installation hooks, scheduled jobs)
- Queue fetch pipeline covering: reported posts, reported comments, spam queue, unmoderated queue
- Normalization layer producing consistent `ModItem` shape
- Embedding generation via Voyage AI (`voyage-3` model, title + body + report reasons concatenated; Claude API is reserved for reasoning in Phase 3+)
- KV Store schema for `ModItem` records and their embedding vectors

---

## Constraints

- Raw post/comment content must not be stored beyond what is needed to generate the embedding
- Embeddings must be regenerated if the source content changes
