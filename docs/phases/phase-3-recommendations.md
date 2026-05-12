# Phase 3 — Recommendations

**Merges spec phases:** 4 (Recommendation Engine)
**Depends on:** Phase 1 (ModItem embeddings) + Phase 2 (policy embeddings)
**Unlocks:** Phase 4, Phase 5

---

## Goal

Wire the policy store and queue embeddings together into a recommendation engine. For every item in the modqueue, the moderator sees a suggested action, the rule it likely violates, a confidence score, and a plain-language explanation. Still suggestions only — no automatic enforcement.

---

## Outcomes

- For each queue item, the system surfaces: suggested action (Remove / Approve / Escalate), matched rule, confidence %, and a 1-2 sentence moderation rationale
- Semantically similar queue items are grouped into clusters — a moderator can see "8 items in this cluster, likely violating Rule #3"
- Each cluster has a representative example, size, and a single recommended bulk action
- Moderator can accept or dismiss any suggestion — the decision is logged but enforcement is always manual
- A moderator reviewing the queue can process a 20-item queue in under 2 minutes using the suggestions (demo benchmark)

---

## Exit Criterion

On a test subreddit with at least 10 queued items, every item has a visible recommendation with a rule reference and confidence score, and at least one cluster of 2+ semantically similar items is detected.

---

## Key Components

- Policy alignment scorer: cosine similarity between each `ModItem` embedding and all `PolicyObject` embeddings; returns top match + score
- Recommendation generator: Claude API call taking matched rule + item content → produces suggested action + rationale
- Duplicate clustering engine: groups `ModItem` embeddings by similarity threshold into named clusters
- Cluster metadata: representative example, member count, violation category, recommended bulk action
- Moderator decision logger: records accept/dismiss per recommendation (feeds Phase 4 consistency analytics)
- Basic queue UI surface: list of items with inline recommendation cards (full polish deferred to Phase 5)

---

## Constraints

- Confidence scores must always be visible — never hidden or rounded to 100%
- Suggestions must never be pre-applied; the UI must require an explicit moderator action to execute
- Clustering threshold should default to conservative (high similarity required) to avoid false groupings
