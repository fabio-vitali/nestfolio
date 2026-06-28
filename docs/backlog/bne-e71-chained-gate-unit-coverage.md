---
id: bne-e71-chained-gate-unit-coverage
status: parking
type: tooling
notes: "The backlog-next-epic chained-second-gate invariant (after a captured-promote rework, re-run the batched gate before shipping) is not deterministically coverable as a live corpus scenario — its premise is the E7.1 audit's model judgment and 'gate ran twice' is uncountable by the substring callLog teeth. bne-e71-chained-e6 now gates on the deterministic deploy-bearing green-ship path + keeps the chained-gate as an informational rubric; deterministic coverage belongs at the unit level."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
---

# Chained-second-gate invariant needs unit-level coverage

Surfaced during the `backlog-eval-corpus-hardening` E6-recovery work (the live full-corpus baseline run
that died at the subscription window cap). `bne-e71-chained-e6` was authored to live-test the chained
gate — after the captured audit promotes a load-bearing member and that member is reworked, the batched
e2e gate must run a SECOND time before the epic ships (E7.2 freshness gate / F-14). But that invariant is
**not deterministically gateable as a corpus scenario**:

- The premise (E7.1 audit judging a captured member load-bearing → promote → rework) is a model judgment.
- "The gate ran twice" can't be asserted — `grade.mjs` `callLog` matches by substring `includes`, which
  cannot count occurrences.

Per the shipped `bne-resume-partial` / `bne-promote-clean` pattern, `bne-e71-chained-e6` now gates on the
deterministic, elicitable part (a deploy-bearing epic ships cleanly through a green batched gate) and keeps
the chained-gate as an **informational** rubric. This leaves the chained-second-gate invariant with no
deterministic regression signal.

The right home for that signal is a **unit test** of the orchestrator's freshness logic: `runstate.mjs`
already exposes `e2e-fresh` (E7.2 / F-14 — the recorded `e2e.sha` must equal HEAD before ship). A unit
test that (a) records an e2e pass at SHA-A, (b) moves HEAD (simulating a re-opened/reworked member), and
(c) asserts `e2e-fresh` now reports stale → forcing a return to E6, would cover the chained-gate invariant
deterministically where a live corpus scenario cannot.
