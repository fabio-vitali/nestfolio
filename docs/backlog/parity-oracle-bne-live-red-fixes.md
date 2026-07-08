---
id: parity-oracle-bne-live-red-fixes
status: active
type: bug
epic: runtime-operationalization
epic_role: core
notes: "First live oracle sweep (2026-07-08, Opus 4.8, 17 pairs) came back 15/17 dominant; both WS-4 bne-* twins red on their first-ever live run (WS-4 had deferred live parity to the soak gate). Deterministic no-LLM repro isolated two stacked defects: (1) operator-protocol seam — the epic spine parks members under journal step key `member.<id>` with decision id `execute:<id>`, but mapping.mjs OPERATOR_PROMPT identifies execute-parks by pending-KEY prefix `execute:` and orders a STOP otherwise, so a compliant operator can never advance an epic member (worker spine keys coincide, which is why all next-* pairs pass); (2) sandbox data gap — fixtures/rt/epic-clean lacks BACKLOG.md (index-fresh red at epic-pre-done) and the runtime sandbox seeds no services/**|libs/** TS file (registry-integrity staleness on no-unsafe-casts), so epic-pre-done fails and the merge floor is structurally unreachable. bne-ship-clean's 0-turn/600s timeout was transient Opus unavailability layered on top. Blocks the oracle-green clause of runtime-replatform-soak-gate."
out_of_scope:
  - "run-epic.mjs adapter-level fulfil-by-decision-id acceptance and the backlog-next-epic SKILL wording ambiguity ('fulfil the printed decision key') — same root-cause family but production-path robustness, filed separately."
  - "Re-mapping any of the still-unmapped P5 scenarios — this item only makes the two ALREADY-mapped bne pairs green."
  - "The soak-gate closure itself (>=5 runtime workstreams) — this item only clears the oracle-green blocker."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Fix the two red WS-4 bne-* parity pairs (operator protocol + epic-clean fixture)

First live sweep evidence: `benchmarks/parity-oracle/parity-2026-07-08T07-17-03-187Z.md` —
`bne-ship-clean` (runtime 0 turns, timeout) and `bne-e8-auto-no-self-merge` (runtime 25 turns,
gate=0 via the journal layer only: `expected awaiting "merge-e"`).

Fixes, at the rings where each defect lives:

- **A (protocol ring, `scripts/parity-oracle/mapping.mjs`):** `OPERATOR_PROMPT` identifies an
  execute-park by the pending entry's **`decision.id`** starting `execute:` and fulfils by the
  pending **key** (the journal step key — the only key `journal.step` replays). Worker scenarios
  unaffected (step key == decision id there).
- **B (fixture):** add `scripts/parity-oracle/fixtures/rt/epic-clean/BACKLOG.md` indexing the
  three live items (e, m1, m2) so `index-fresh` passes at epic-pre-done.
- **C (sandbox builder, `scripts/parity-oracle/runtime-sandbox.mjs`):** seed one clean TS source
  file so `no-unsafe-casts`'s scope resolves to ≥1 file (kills the `registry-integrity`
  staleness finding that grades the sandbox, not the engine).

TDD anchor: a deterministic (no-LLM) drive test in `scripts/parity-oracle/test/` that builds the
epic-clean sandbox, drives `run-epic.mjs` through both member fulfils by step key, and asserts
the run parks `awaiting merge-e` with `gradeJournal` green — RED before B+C, GREEN after.
