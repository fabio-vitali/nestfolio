---
id: runtime-replatform-soak-gate
status: queued
rank: 4
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "P5 terminal tracking item (spec §9.6, §12): the binding soak gate. Closes ONLY when scripts/parity-oracle/soak-observer.mjs reports ≥5 distinct real workstreams driven end-to-end by the runtime loop (path:runtime), zero path:legacy-fallback in the window, AND the parity oracle green (all mapped pairs dominant incl. the newly-mapped scenarios). Both clauses satisfied as of 2026-07-08 — the closure run remains: composed --oracle-green verdict + absorb the WS-2 differential-realign follow-up + ship."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
out_of_scope:
  - "Building the observer/flag/oracle — that is runtime-replatform-prereqs; this item only consumes them for the verdict."
  - "Legacy-path deletion (P6, user-triggered) — a separate act after this gate passes, never bundled."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Terminal soak gate — ≥5 fallback-free runtime workstreams + oracle green

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §9.6 & §12.
The go/no-go that declares the work-driver re-platform done. Its closure evidence is the
`soak-observer.mjs` verdict; its verdict is legitimately multi-workstream (why this is a separate item —
the CLAUDE.md atomicity rule).

**Was blocked on:** all of `runtime-replatform-{prereqs,add,lint,next,next-epic}` plus ≥5 accumulated
fallback-free runtime workstreams.

**Promoted 2026-07-08** (parking → queued, rank 4, user-confirmed at the `run-next-fulfil-badpair-guard`
ship boundary review): the trigger fired — all 5 re-platform members shipped, and the soak observer
reports `enoughRuntime=true` (5 distinct `item-*` runtime workstreams: `run-epic-fulfil-key-decision-id-ambiguity`,
`deploy-gate-runner-pipefail-silent-green`, `epic-clean-fixture-twin-id-typo`, `import-boundary-dynamic-import-gap`,
`run-next-fulfil-badpair-guard`) with `zeroFallback=true`; the live oracle sweep went green 2026-07-08
(17/17 mapped pairs dominant on Opus 4.8). Closure run: `soak-observer.mjs --oracle-green` composed verdict,
absorb the WS-2 differential-realign follow-up (`lint-differential.mjs` runtimeExit `--on=manual` →
`--on=commit --changed=docs/backlog/*.md`), ship.
