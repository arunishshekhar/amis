# Phase 5 — UX + Ship

**Merges spec phases:** 6 (UX & Explainability) + 7 (Reliability & Demo)
**Depends on:** Phases 1–4 all complete
**Unlocks:** hackathon submission

---

## Goal

Everything built in Phases 1–4 surfaces through a polished, trustworthy moderator dashboard. Every AI decision is explainable. The system is demo-ready with a clear before/after narrative.

---

## Outcomes

- Main dashboard shows: queue overview, urgent items, active clusters, policy alerts, and consistency insights — all in one view
- Every recommendation has an audit trail: which rule triggered it, which similar cases matched, what confidence score it carried
- Moderator can navigate from a cluster card → individual item → full explanation trace without leaving the Devvit UI
- Consistency insights panel is gated to mod-team-only visibility
- Demo flow works end-to-end: install app → chaotic queue appears → AI surfaces clusters, recommendations, and one consistency insight → moderator processes queue in under 3 minutes
- No automatic actions occur at any point in the demo flow — every outcome requires a moderator click

---

## Exit Criterion

A non-technical observer watching the demo can describe what the system does, why it suggested each action, and confirm that the moderator remained in control at all times.

---

## Key Components

**Dashboard**
- Queue summary panel: total items, top violation categories, active cluster count, high-risk flags
- Cluster cards: label, size, representative content, recommended action, rule alignment, confidence
- Rule alignment panel: matched rule, historical similar cases, explanation trace
- Consistency insights panel: inconsistent enforcement patterns, drift alerts (mod-team only)

**Explainability**
- Per-item audit view: rule that triggered, similar historical cases, confidence score, full reasoning chain
- Uncertainty display: low-confidence recommendations are visually distinguished, not hidden

**Reliability**
- Synthetic attack scenario tests: scam wave, repost flood, coordinated harassment cluster — system must detect and cluster correctly
- Error states: graceful degradation when queue is empty, policy store is stale, or Claude API is unavailable

**Demo Flow**
- Scripted before/after narrative: chaotic queue → AI-organized queue with clusters and recommendations
- All actions taken by a real moderator during the demo; AI only provides information

---

## Constraints

- Low-confidence recommendations must be visually distinct (not suppressed)
- All error states must display a plain-language explanation — no raw API errors shown to moderators
- Demo must be reproducible on any subreddit with at least 5 queued items
