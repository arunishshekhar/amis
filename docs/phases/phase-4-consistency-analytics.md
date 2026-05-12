# Phase 4 — Consistency Analytics

**Merges spec phases:** 5 (Moderation Consistency Engine)
**Depends on:** Phase 3 (moderator decision log must have accumulated history)
**Unlocks:** Phase 5

---

## Goal

Surface patterns where similar content has received different moderation outcomes. This is the stretch/differentiator layer — framed entirely as "policy alignment analytics," never as moderator blame or bias detection.

---

## Outcomes

- The system detects semantically similar posts that received divergent outcomes (e.g., 8 removed, 2 approved) and flags them as a "potential inconsistent enforcement pattern"
- Rule drift is surfaced when moderation actions have evolved away from written rules (e.g., rule says "no self-promotion" but large creators are consistently approved)
- Moderator action variance is computed and displayed as an enforcement distribution — no public rankings, no named comparisons, visible to mod team only
- Each insight has a plain-language explanation of what was detected and a suggested policy clarification
- A moderator can dismiss or acknowledge any insight — acknowledged insights are archived, not deleted

---

## Exit Criterion

Given a test subreddit with at least 50 historical moderation decisions (real or seeded synthetic data), at least one inconsistency pattern or drift signal is detected and surfaced in the insights panel.

---

## Key Components

- Similar-content divergence detector: finds `ModItem` clusters where outcomes split (removed vs. approved above a threshold ratio)
- Rule drift analyzer: compares `PolicyObject` embeddings against the distribution of actual moderator decisions over time
- Enforcement variance calculator: per-rule action rate distributions (remove %, approve %, escalate %) — no per-moderator named output
- Insight generator: Claude API call producing a plain-language description + suggested policy clarification for each detected signal
- Insight acknowledgment store: tracks dismissed/acknowledged insights per subreddit
- Mod-team-only access gate: insights panel is hidden from non-moderator Devvit contexts

---

## Constraints

- Never surface per-moderator named rankings or comparison tables
- All output must be framed as "policy alignment" language — avoid "bias," "mistake," or "error" terminology
- Insights are advisory only; no suggested action is pre-applied
- Minimum history threshold: do not run drift detection with fewer than 50 historical decisions (surface a "not enough data" state instead)
