---
id: runtime-replatform-soak-gate
status: parking
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "P5 terminal tracking item (spec §9.6, §12): the binding soak gate. Closes ONLY when scripts/parity-oracle/soak-observer.mjs reports ≥5 distinct real workstreams driven end-to-end by the runtime loop (path:runtime), zero path:legacy-fallback in the window, AND the parity oracle green (all mapped pairs dominant incl. the newly-mapped scenarios). The one item whose closure verdict is legitimately deferred across future workstreams. Promote once all 4 per-skill re-platforms have shipped and real workstreams begin accumulating on the runtime path."
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

**Blocked on:** all of `runtime-replatform-{prereqs,add,lint,next,next-epic}` plus ≥5 accumulated
fallback-free runtime workstreams. Promote when that count is within reach.
