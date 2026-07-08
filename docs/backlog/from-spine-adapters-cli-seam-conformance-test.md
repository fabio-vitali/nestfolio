---
id: from-spine-adapters-cli-seam-conformance-test
type: bug
status: queued
rank: 5
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
