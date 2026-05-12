# AMIS 5-Phase Development Plan — Design Doc

**Date:** 2026-05-10
**Project:** AI Moderation Intelligence System (AMIS)
**Source spec:** `AI_Moderation_Intelligence_System_Advanced_Plan.md`

---

## Summary

The AMIS project spec defines 7 phases. This document records the decision to condense those into 5 phases with outcome-level deliverables, and explains the grouping rationale.

---

## Grouping Decision

**Option A — Infrastructure First** was chosen.

| Phase File | Spec Phases Merged | Rationale |
|---|---|---|
| phase-1-foundation-embeddings.md | 1 + 2 | Both are pure data pipeline work — Devvit wiring and embedding generation share the same storage/infra setup |
| phase-2-policy-intelligence.md | 3 | Standalone — rule ingestion is a distinct capability that feeds phases 3+ |
| phase-3-recommendations.md | 4 | The first moderator-visible value; depends on phases 1 and 2 |
| phase-4-consistency-analytics.md | 5 | Stretch differentiator; depends on recommendation history accumulating |
| phase-5-ux-ship.md | 6 + 7 | UX polish and demo readiness are both ship-readiness concerns |

---

## Deliverable Format

Each phase file uses **outcome-level deliverables**: every deliverable is a testable, observable outcome — not a list of functions or files to write. Each phase also carries an explicit **exit criterion** that must be verifiable before the next phase begins.

---

## Hard Constraints Carried Into All Phases

- No automatic moderation actions at any point — every outcome requires a moderator click
- Every AI recommendation exposes its confidence score and reasoning trace
- Consistency analytics data is mod-team-only; no public moderator rankings
- Minimize raw content storage; avoid long-term personal data retention

---

## Phase Files

- [Phase 1 — Foundation + Embeddings](../../phases/phase-1-foundation-embeddings.md)
- [Phase 2 — Policy Intelligence](../../phases/phase-2-policy-intelligence.md)
- [Phase 3 — Recommendations](../../phases/phase-3-recommendations.md)
- [Phase 4 — Consistency Analytics](../../phases/phase-4-consistency-analytics.md)
- [Phase 5 — UX + Ship](../../phases/phase-5-ux-ship.md)
