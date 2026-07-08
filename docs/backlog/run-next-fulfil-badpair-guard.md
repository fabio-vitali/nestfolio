---
id: run-next-fulfil-badpair-guard
status: queued
rank: 4
type: bug
epic: runtime-operationalization
epic_role: core
notes: "run-next.mjs main() lacks the malformed --fulfil/--value badPair guard run-epic.mjs has — a flag typo silently journals a junk step instead of exiting 2. Backport the WS-4 guard."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# run-next.mjs: backport run-epic's malformed `--fulfil` badPair guard

Found in the post-ship review of WS-3/WS-4. `runtime/adapters/claude-code/run-epic.mjs:44` (WS-4) validates the fulfil pair:

```js
const badPair = fi >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
```

`runtime/adapters/claude-code/run-next.mjs:42` (WS-3, earlier) only checks `(fi >= 0) !== (vi >= 0)`. So `node run-next.mjs <id> --fulfil --value '5'` passes the parity check, parses `key='--value'`, and `resolveFulfilKey` rule 4 (no pending match → pass-through, `fulfil-key.mjs:19`) lets `journal.fulfil` append an orphan `'--value'` step — the run proceeds as if nothing was fulfilled, masking the operator's typo instead of exiting 2.

**Fix:** copy the `badPair` guard into `run-next.mjs` `main()` (usage exit 2), plus a `run-next.test.mjs` case mirroring run-epic's. One-file backport; the two adapters should stay shape-identical at the CLI seam.

**Promoted 2026-07-08** (parking → queued, rank 4, user-confirmed via `/backlog-next` AskUserQuestion): drained from the `runtime-operationalization` theme epic as a standalone runtime-driven workstream — soak-gate target 5/5 (the closing run). No trigger sentence existed to remove; the item was parked only as a theme-epic member.
