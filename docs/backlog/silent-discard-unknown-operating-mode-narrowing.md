---
id: silent-discard-unknown-operating-mode-narrowing
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "One-line fix: console.warn before narrowing assignment when raw value is non-empty."
---

# Silent discard of unknown operatingMode in portfolio-engine graph.ts narrowing

`services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:113-119`. Surfaced 2026-05-07 during Task 4 code review of α-tune workstream. When `payload.upstreamOutputs.operatingMode` (or the nested `investorProfile.operatingMode`) is a non-empty string that isn't `'CONSERVATIVE'` or `'AGGRESSIVE'`, it silently collapses to `'BALANCED'` with no log signal. Pre-existing — the narrowing pattern existed before this workstream typed it as `Record<OperatingMode, string>`. Production risk: a CONSERVATIVE mandate emitted with a typo (`'Conservative'`, `'conservative'`) would silently produce BALANCED allocations. One-line fix: `console.warn` before the narrowing assignment when raw value is non-empty and not in the union. Promote when (a) upstream services start emitting mixed-case values, or (b) a real-money cycle's mandate-vs-allocation mismatch is observed.
