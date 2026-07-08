---
id: import-boundary-dynamic-import-gap
status: queued
rank: 4
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "import-boundary.test.mjs only matches static `from '…'` — a dynamic await import('…/content/…') in ring-1 would slip past the engine→content ban. Extend the regex to import(…)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# import-boundary guard: dynamic `import()` slips past the ring-1 seam bans

Found in the post-ship review of WS-3. `runtime/engine/test/import-boundary.test.mjs:17-18` bans engine→adapter / engine→skill / engine→content / shelling-claude via patterns anchored on `from ['"]…` — static imports only. A future ring-1 file that lazily loads content via `await import('../../content/lib/classify-lane.mjs')` (the exact shape `deploy-gate-runner.mjs:18-19` legitimately uses in the *adapter* ring) would reintroduce the WS-3 first-cut violation without failing the guard. Bare side-effect imports (`import '…/content/…'`) are also unmatched.

**Fix:** add `import\(\s*['"][^'"]*\/(adapters|content)\//` (and the bare-import form) to the offender patterns; verify the extended guard fails on an injected dynamic-import violation, mirroring how the WS-3 engine→content extension was verified.

**Promoted 2026-07-08** (parking → queued, rank 4, user-confirmed): drained from the `runtime-operationalization` theme epic as a standalone runtime-driven workstream — soak-gate target 4/5. No trigger sentence existed to remove; the item was parked only as a theme-epic member.
