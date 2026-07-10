---
id: runtime-judgment-tier-maturation
status: parking
type: epic
notes: "Theme epic (minted 2026-07-10 by backlog-themes). Root cause: the runtime judgment/audit tier shipped as a deliberate MVP in runtime-check-migration-judgment-tier (2026-07-06, spec §8) — existence-only eval stubs + human-driven intake — and its maturation was deferred. 3 core members, all deferred from that same ship."
done_when: "Each member resolved or dropped: the runtime judgment/audit tier gains real teeth beyond the shipped MVP — flake-contracts become enforced regressions (not declared targets), the 3 backlog/epic-governance verdicts surface as live judgment CheckEntries (or are dropped as redundant with the already-shipped lint-level enforcement), and the audit cadence can route findings into filed backlog items with zero human step. All members shipped or dropped."
scope: "The deferred maturation of the runtime judgment/audit tier that shipped thin in runtime-check-migration-judgment-tier (spec §8): (a) runtime-judgment-flake-calibration — build the real flake-contract eval corpus (good/bad fixtures + n-run calibration) that turns a check's flake_contract into an enforced regression, replacing the existence-only eval_scenario stubs; (b) runtime-judgment-governance-gaps — migrate the 3 epic-governance judgment verdicts (epicCapturedAudit load-bearing, core-vs-captured classification, ship-time captured promote/spin-out) into runtime judgment CheckEntries, or drop as redundant with the shipped lint-level enforcement; (c) runtime-audit-auto-intake-ci — bind the intake execute capability to a headless runner so the weekly runtime-audit cadence files findings autonomously (findings → backlog items, zero human step)."
out_of_scope:
  - "The judgment/audit tier that already shipped (the 4 audit-* skill wrappers + existence-only eval scaffolding) — this theme is only the deferred 'make it real/autonomous' follow-ups."
  - "Runtime engine self-hosting debt (runtime-self-hosting-debt) and gate-baseline attribution semantics (runtime-gate-baseline-debt) — distinct root causes."
references: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime judgment-tier maturation (make the MVP real / autonomous)

Minted by `/backlog-themes` (2026-07-10). Three features deferred from the **same** ship
(`runtime-check-migration-judgment-tier`, SHIPPED 2026-07-06, spec §8) share one root cause: the
judgment/audit tier was deliberately shipped as an MVP — existence-only eval stubs and human-in-the-loop
intake — to bound the epic, and making it real was deferred. All three are `type: feature`,
`topic_memory: project_runtime_realization`.

**Members (3, core):**

- `runtime-judgment-flake-calibration` — build the REAL flake-contract calibration mechanics (SPEC 2
  §eval): the judgment eval corpus with good/bad fixtures + n-run calibration that turns a check's
  `flake_contract` (allowed_flake_rate / calibration / min_confidence) into an **enforced** regression.
  Today every judgment `eval_scenario` is an existence-only STUB.
- `runtime-judgment-governance-gaps` — migrate the 3 backlog/epic-governance judgment verdicts into
  runtime `judgment` CheckEntries driven by the live judge binding (epicCapturedAudit load-bearing
  verdict; core-vs-captured `epic_role` classification; ship-time captured promote/spin-out verdict).
  These have no existing skill wrapper (unlike the 4 shipped audit-*), needing net-new judge procedures.
  DROP as redundant if the shipped lint-level enforcement (`backlog-epic-captured-misroute-fix`) is
  judged sufficient.
- `runtime-audit-auto-intake-ci` — make the weekly runtime-audit cadence ALSO route its findings into
  backlog items automatically: bind the intake `execute` capability to a headless runner so
  `run-intake`'s selectRoute judgment resolves in-CI instead of parking for a human. Today the cadence
  dispatcher only PRODUCES findings; intake is human-driven.

**Disposition:** durable root-cause bucket (`status: parking`). Promote to a delivery epic when the
judgment tier needs real teeth (e.g. before relying on an audit check as a hard gate rather than an
advisory cadence artifact); ships when all three members are terminal.
