---
id: run-next-fulfil-badpair-guard
status: shipped
closed: 2026-07-08
type: bug
epic: runtime-operationalization
epic_role: core
notes: "run-next.mjs main() lacks the malformed --fulfil/--value badPair guard run-epic.mjs has — a flag typo silently journals a junk step instead of exiting 2. Backport the WS-4 guard."
references: []
out_of_scope:
  - "Sibling adapters' CLI seams — run-item.mjs (badPair guard, line 32) and run-backward.mjs (parseFlags `f.fulfil === true` check, line 156) already reject the malformed pair; no change there."
  - "Extracting a shared arg-parser across the spine adapters — they intentionally stay shape-identical by copy at the CLI seam (WS-3/WS-4 precedent); a DRY extraction is a separate refactor."
  - "fulfil-key.mjs rule-4 pass-through semantics — unmatched keys still pass through by design (fresh-run pre-seeded choices keep working); this fixes only the malformed-flag path upstream of it."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "Commit 2045b5ea (main): badPair guard backported into run-next.mjs main() (verbatim run-epic.mjs/run-item.mjs shape); RN3 mirrors run-item DRV4 across 3 malformed shapes, TDD red→green (red failed exactly on `--fulfil --value 5` — exit 2 only via the unknown-item coincidence, empty stderr). pnpm nx run-many -t test,lint -p runtime,tools → 0 fail. detect-doc-derivation exit 10; detect-deploy exit 10 (all Tier 0). Runtime-engine drive fallback-free (soak 5/5, closing run): run-next.mjs exit 0 'worked run-next-fulfil-badpair-guard; ship approved'; ship-recheck gate-clean + consider --none journaled (sha 218f8e97); side-finding from-spine-adapters-cli-seam-conformance-test filed via runtime intake (join-theme runtime-operationalization, core)."
---

# run-next.mjs: backport run-epic's malformed `--fulfil` badPair guard

Found in the post-ship review of WS-3/WS-4. `runtime/adapters/claude-code/run-epic.mjs:44` (WS-4) validates the fulfil pair:

```js
const badPair = fi >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
```

`runtime/adapters/claude-code/run-next.mjs:42` (WS-3, earlier) only checks `(fi >= 0) !== (vi >= 0)`. So `node run-next.mjs <id> --fulfil --value '5'` passes the parity check, parses `key='--value'`, and `resolveFulfilKey` rule 4 (no pending match → pass-through, `fulfil-key.mjs:19`) lets `journal.fulfil` append an orphan `'--value'` step — the run proceeds as if nothing was fulfilled, masking the operator's typo instead of exiting 2.

**Fix:** copy the `badPair` guard into `run-next.mjs` `main()` (usage exit 2), plus a `run-next.test.mjs` case mirroring the existing CLI-guard test precedent. One-file backport; the two adapters should stay shape-identical at the CLI seam.

> Citation corrected at adoption (2026-07-08): the *guard* to backport is run-epic.mjs's (`run-epic.mjs:44`), but the *test* precedent is `run-item.test.mjs` DRV4 ("CLI --fulfil with a missing/malformed trailing value prints usage and exits 2") — `run-epic.test.mjs` carries no badPair CLI case. Also verified `run-item.mjs:32` already has the guard and `run-backward.mjs:156` guards via `parseFlags`, so run-next.mjs is the only unguarded spine adapter.

**Promoted 2026-07-08** (parking → queued, rank 4, user-confirmed via `/backlog-next` AskUserQuestion): drained from the `runtime-operationalization` theme epic as a standalone runtime-driven workstream — soak-gate target 5/5 (the closing run). No trigger sentence existed to remove; the item was parked only as a theme-epic member.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Pick + promotion: work run-next-fulfil-badpair-guard (named id, was status: parking, member of parking theme epic runtime-operationalization)
- **Options:** Promote to queued (rank 4) and proceed — runtime soak 5/5 closing target | Stop and leave in parking
- **Chosen:** Promote to queued (rank 4) and proceed — runtime soak 5/5 closing target
- **Rationale:** Parking refuses even in --auto (a refusal is a stop, not a decision --auto may take); promotion surfaced via AskUserQuestion and USER-CONFIRMED. Matches the epic-clean-fixture-twin-id-typo / import-boundary-dynamic-import-gap drain pattern; driving it fallback-free closes the soak gate ≥5 clause.
- **Rejected:** Stop here — would leave the soak gate at 4/5 with a user-ready one-file backport.

### D2 — 2026-07-08
- **Decision:** Lane classification for run-next-fulfil-badpair-guard
- **Options:** Simple (main) | Complex (worktree + PR) | Doc-layer (main, docs only)
- **Chosen:** Simple (main)
- **Rationale:** One tooling file (runtime/adapters/claude-code/run-next.mjs) + its test; no deploy, no public interface (internal adapter CLI seam), no architectural fork — a verbatim backport of an existing guard. Identical classification to the soak-4/5 precedent import-boundary-dynamic-import-gap (a16fd74d, on main).
- **Rejected:** Complex — no cross-service blast radius, PR overhead unearned; Doc-layer — produces code, not just docs.

### D3 — 2026-07-08
- **Decision:** Ship floor: ship-run-next-fulfil-badpair-guard (runtime worker parks, never auto-ships)
- **Options:** Ship (recommended by worker) | Hold
- **Chosen:** Ship
- **Rationale:** All gates green before fulfilment: RN3 TDD red→green; nx test,lint runtime,tools 0 fail; detect-doc-derivation exit 10; detect-deploy exit 10 (all Tier 0); ship-recheck gate-clean journaled; mint consideration recorded (consider --none, side-finding filed 218f8e97). Simple lane on main — no PR gate applies; git push is the pre-authorized lane completion.
- **Rejected:** Hold — nothing outstanding; holding would strand soak run 5/5.
