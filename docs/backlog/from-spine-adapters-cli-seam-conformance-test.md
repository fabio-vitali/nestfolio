---
id: from-spine-adapters-cli-seam-conformance-test
type: bug
status: shipped
closed: 2026-07-08
validation_gate: "cli-fulfil-conformance.test.mjs shipped (commit 8bc3ad9f): CF1 discovery totality over every --fulfil-mentioning run-*.mjs adapter — fail-proven by an injected phantom adapter (pass 1/fail 1) — + CF2 exit-2/usage on the three malformed shapes across all six adapters (item/next/epic/intake/themes/backward); per-adapter copies run-item DRV4 + run-next RN3 removed. Full runtime suite green (pnpm nx run runtime:test). ship-recheck clean (journaled gate-clean); mint consideration recorded --none. EIGHTH runtime-driven workstream, fallback-free (run-next 3→3→0, lane=simple via the just-shipped classifyLane fix)."
out_of_scope:
  - "Guard behavior changes — the badPair guards themselves shipped in run-next-fulfil-badpair-guard; this item only pins them with one conformance test."
  - "Promoting the guard to a runtime/content check — stays a node --test guard per the import-boundary precedent (user-confirmed at filing)."
done_when: "resolve: run-epic.mjs, run-intake.mjs, run-themes.mjs carry the
  malformed --fulfil/--value badPair guard but NO CLI test pins it (only
  run-item DRV4 + run-next RN3 do). Replace per-adapter test copies with ONE
  adapter-ring conformance test that enumerates every --fulfil-parsing run-*.mjs
  adapter and asserts exit 2 + usage on the three malformed shapes — auto-covers
  future adapters. Per the import-boundary precedent this stays a node --test
  guard, not a runtime/content check. Surfaced during
  run-next-fulfil-badpair-guard (soak 5/5) mint consideration, user-confirmed
  no-mint/file-test."
provenance:
  from_finding: spine-adapters-cli-seam-conformance-test
epic: runtime-operationalization
---

# from-spine-adapters-cli-seam-conformance-test

run-epic.mjs, run-intake.mjs, run-themes.mjs carry the malformed --fulfil/--value badPair guard but NO CLI test pins it (only run-item DRV4 + run-next RN3 do). Replace per-adapter test copies with ONE adapter-ring conformance test that enumerates every --fulfil-parsing run-*.mjs adapter and asserts exit 2 + usage on the three malformed shapes — auto-covers future adapters. Per the import-boundary precedent this stays a node --test guard, not a runtime/content check. Surfaced during run-next-fulfil-badpair-guard (soak 5/5) mint consideration, user-confirmed no-mint/file-test.
