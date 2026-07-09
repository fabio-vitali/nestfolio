---
id: from-run-themes-intake-bare-capabilities-conformance-gap
type: bug
status: shipped
closed: 2026-07-09
validation_gate: "Commit 8dafc83c on main (TWELFTH runtime-driven workstream — run-next.mjs 3(execute)→3(ship floor)→0, lane=simple, fallback-free). run-themes.mjs/run-intake.mjs mains compose makeDriverCapabilities(); DC3 rewritten discovery-total over run-*.mjs (bans the raw constructor name anywhere incl. aliasing; const-capabilities assignment law), FAIL-PROVEN against an injected phantom bare-caps driver. runtime suite 421/421 + typecheck clean. ship-recheck gate-clean journaled; mint-considered --none (the sweep IS the mechanization). Dogfood: the patched run-intake main drove the from-intake-join-theme-cannot-express-epic-role filing in the same session."
done_when: "resolve: run-themes.mjs:66 and run-intake.mjs:82 compose bare
  makeClaudeCodeCapabilities({}) — harmless today (themes()/intake() never
  consume runProcedure/runGate; their parks are human asks), but it is the same
  construction divergence that caused the judge-binding gap in the four
  workstream-driver mains, and DC3 conformance deliberately covers only
  gate-running drivers. If a gate or skill:<name> judgment is ever added to the
  themes/intake drives, the fail-close ('unknown procedure') silently returns.
  Either wire makeDriverCapabilities() uniformly into ALL run-* mains and sweep
  DC3 over run-*.mjs instead of a hardcoded list, or record the bare-caps
  exemption explicitly. Surfaced during from-run-item-judge-binding-gap close
  (6.4b sweep, 2026-07-08)."
provenance:
  from_finding: run-themes-intake-bare-capabilities-conformance-gap
epic: runtime-operationalization
---

# from-run-themes-intake-bare-capabilities-conformance-gap

run-themes.mjs:66 and run-intake.mjs:82 compose bare makeClaudeCodeCapabilities({}) — harmless today (themes()/intake() never consume runProcedure/runGate; their parks are human asks), but it is the same construction divergence that caused the judge-binding gap in the four workstream-driver mains, and DC3 conformance deliberately covers only gate-running drivers. If a gate or skill:<name> judgment is ever added to the themes/intake drives, the fail-close ('unknown procedure') silently returns. Either wire makeDriverCapabilities() uniformly into ALL run-* mains and sweep DC3 over run-*.mjs instead of a hardcoded list, or record the bare-caps exemption explicitly. Surfaced during from-run-item-judge-binding-gap close (6.4b sweep, 2026-07-08).

**Promoted 2026-07-09 (user-approved, D1).** Two facts sharpened the case the day after filing:
(1) `runtime-operational-surface` shipped `run-view.mjs` — a FIFTH `runProcedure`-consuming main
(its `exec` dispatches through `makeDriverCapabilities`) that DC3's hardcoded four-file list does
not sweep, so a regression to bare caps there would pass conformance silently; the "sweep
`run-*.mjs` instead of a hardcoded list" clause now has a live instance. (2) The item carries no
`epic_role:` (the intake `join-theme` route cannot write one — gap filed separately), so it
defaults to **core** and would block the `runtime-operationalization` ship under rule 9 anyway —
draining it now resolves both the debt and the role ambiguity.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-09
- **Decision:** Disposition of from-run-themes-intake-bare-capabilities-conformance-gap after the run-view ship exposed DC3 hardcoded-list rot + the missing epic_role (de-facto core)
- **Options:** Work it now as the 12th runtime-driven workstream | Fix epic_role: captured only, leave code debt for the captured audit | Leave as-is (drains later as core before epic ship)
- **Chosen:** Work it now as the 12th runtime-driven workstream
- **Rationale:** run-view.mjs is a fifth runProcedure-consuming main outside DC3s hardcoded sweep — the items list-rots premise is now live, and the discovery-total sweep (CF1 pattern) is the reusable, self-extending fix. Shipping also dissolves the core/captured ambiguity (shipped members never block rule 9). User approved via AskUserQuestion.
- **Rejected:** Role-only fix leaves a proven-latent divergence plus an unswept fifth main; leave-as-is forces the same work later, after legacy retirement, with the epic ship blocked on it.

### D2 — 2026-07-09
- **Decision:** Ship floor + 6.4b mint consideration for from-run-themes-intake-bare-capabilities-conformance-gap
- **Options:** Ship + nothing to mint | Ship + mint a new check | Ship + file follow-up | Hold
- **Chosen:** Ship + nothing to mint
- **Rationale:** Pre-ship batch (lane=simple) + ship gate + ship-recheck gate-clean; runtime 421/421 + typecheck green; DC3 discovery-total fail-proven vs injected phantom; the patched run-intake main dogfooded live on the epicRole-gap filing. Mint --none: the lesson was mechanized INTO the fix (DC3 now discovery-total like CF1; adapter-ring node-test concern per the import-boundary precedent). User approved via AskUserQuestion.
- **Rejected:** Minting would duplicate the sweep that now IS the guard; holding had no failing evidence.
