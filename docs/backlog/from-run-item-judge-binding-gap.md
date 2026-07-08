---
id: from-run-item-judge-binding-gap
type: bug
status: queued
rank: 4
done_when: "run-item.mjs main() builds capabilities via makeDriverCapabilities()
  (the Seam A′ composition in runtime/adapters/claude-code/driver-capabilities.mjs)
  so the runProcedure-derived judge resolves skill:<name> judgment checks selected
  during a run-item drive instead of fail-closing ('unknown procedure'), matching
  run-next/run-epic/run-audit; a regression test asserts the wiring."
out_of_scope:
  - "Retiring run-item itself — that is P6 runtime-legacy-retirement (user-triggered, sequenced after the operator surface)."
  - "run-next/run-epic/run-audit driver mains — already wired via from-run-next-pre-ship-judge-binding-gap."
  - "Changing the seam API itself (driver-capabilities.mjs) — frozen by the D2 seam decision."
provenance:
  from_finding: run-item-judge-binding-gap
epic: runtime-operationalization
---

# from-run-item-judge-binding-gap

run-item.mjs:35 builds capabilities via bare makeClaudeCodeCapabilities({}) — the exact judge-binding gap fixed in run-next/run-epic/run-audit by from-run-next-pre-ship-judge-binding-gap: worker.mjs:21 derives the judge from runProcedure and uses it at the start-gate AND ship-gate, so any skill:<name> judgment check selected during a run-item drive fail-closes ('unknown procedure'). Deliberately not fixed there (out_of_scope, separate closure verdict): run-item is the generic SPEC-3 CLI.

## Promotion (2026-07-08)

The parked fork was "wire makeDriverCapabilities() or retire run-item at P6". The trigger fired: the
seam shipped (from-run-next-pre-ship-judge-binding-gap, commit f3674507), making this a one-line
closure, while P6 runtime-legacy-retirement is user-triggered and not imminent — run-item would
fail-close on judgment checks for the whole interim. User approved promote-and-work-now via
AskUserQuestion (2026-07-08). Resolution chosen: wire the seam — all four driver mains (run-next,
run-epic, run-audit, run-item) then construct capabilities through the single makeDriverCapabilities
composition, and run-item is the generic SPEC-3 reference CLI others would lift, so it especially
should demonstrate the correct wiring.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Parking item named via /backlog-next <id> --auto: promote-and-work now vs leave for P6 retirement
- **Options:** Promote to queued rank 4 and work now (wire makeDriverCapabilities into run-item) | Leave parked for P6 runtime-legacy-retirement | Drop as subsumed by P6
- **Chosen:** Promote to queued rank 4 and work now (wire makeDriverCapabilities into run-item)
- **Rationale:** User-approved via AskUserQuestion (rule-8 refusal surfaced, never silently promoted). The seam shipped in from-run-next-pre-ship-judge-binding-gap (f3674507) making this a one-line closure; P6 is user-triggered and not imminent; uniform makeDriverCapabilities usage across all four driver mains is the reusable pattern.
- **Rejected:** Leave-parked keeps run-item fail-closing on skill:<name> judgment checks for the whole interim; drop loses the separate closure verdict the item was filed to track.
