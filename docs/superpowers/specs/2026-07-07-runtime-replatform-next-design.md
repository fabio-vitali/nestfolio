# WS-3 — Re-Platform `backlog-next` onto `runWorker` (deploy-gate build)

- **Date:** 2026-07-07
- **Status:** design (WS-3 of the work-driver strangler; produces engine + content + adapter code)
- **Backlog item:** `runtime-replatform-next` (core member of epic `runtime-operationalization`)
- **Parent strategy spec:** `docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md` §8 (WS-3), §14
- **Depends on (SHIPPED):** `runtime-replatform-prereqs` (RUNTIME_ENGINE flag, path-provenance, parity-oracle extension, soak-observer), `runtime-replatform-add` (WS-1, intake/router ported), `runtime-replatform-lint` (WS-2, backlog content gate on `run-watch`)
- **Related seams (verified against code 2026-07-07):** `runtime/engine/loop/worker.mjs:11`, `runtime/engine/loop/orchestrator.mjs:27-37`, `runtime/engine/lib/journal.mjs:146-149`, `runtime/engine/schema/check.schema.ts:71-88`, `.claude/skills/backlog-next/detect-deploy-needed.mjs:173`, `.claude/skills/backlog-next/backlog-gate.mjs:12-25`, `scripts/parity-oracle/mapping.mjs`

---

## 1. Context & motivation

`runtime-realization` shipped the engine as a library; `runtime-operationalization` made enforcement fire and ported the router (`intake`, WS-1) and the backlog content gate (WS-2). What remains for the work-driver headline is the **worker**: `backlog-next`'s procedure is still authoritative skill prose, while `runWorker` (`worker.mjs:11`) is built and unit-tested but drives no real workstream.

WS-3 is the **highest-risk slice** (parent spec §14): a real evaluator over a real AWS deploy + e2e. It re-platforms `backlog-next` onto `runWorker` behind `RUNTIME_ENGINE`, with the deploy + integration + involved-e2e validation gate modeled as a **sha-conditional expensive batch** the runtime owns.

## 2. Architectural invariants (what de-risks this)

- **The engine is already built.** `runWorker` spine (start-gate → execute → ship-gate → ship floor-ask) is live; WS-3 adds one pre-ship step and wires an adapter driver. This is wiring, not engine construction.
- **No data migration.** `docs/backlog/*.md` stays the one item store; only the procedure moves. Rollback = stop calling `run-next.mjs` (flag off).
- **The legacy body stays byte-for-byte** throughout soak (no-cleanup-during-migration; deletion is P6, user-triggered).
- **Principled check boundary (Decision D4).** The check registry holds *codebase/validation properties*; git-*workflow* preconditions and diff *detectors* stay host adapter scripts. This matches what WS-2 actually shipped (content gate → `run-watch`; tree-clean/main-ahead/stale-worktree stayed in `preflight.mjs`).

## 3. Decisions

| id | Decision | Chosen | Rejected |
|----|----------|--------|----------|
| **D1** | Where the sha-pinned expensive deploy-gate batch lives | **Shared ring-1 helper** `preShipBatch`, extracted from `orchestrator.mjs:27-37`, called by both `runOrchestrator` and `runWorker` | Inline batch in `runWorker` only (duplicates the pattern); ring-2 driver owns it (sha-pinning leaks to adapter, ordering vs internal ship-ask breaks) |
| **D2** | Deploy-gate evaluator kind | **Deterministic `cmd:`** runner (`deploy-gate-runner.mjs`), no flake_contract | Procedure-backed `judgment` (`skill:` via `deriveJudge`) — schema forces a flake_contract on a deterministic deploy (`check.schema.ts:82-87`); semantically wrong |
| **D3** | Lane classification locus | **Dedicated `classifyLane(item,diffPaths)`** content module + pure `laneToTrigger(lane)→{contexts,cost_ceiling}` | Derive from detect-deploy + interface-touch (conflates deploy-need with lane); static `lane:` frontmatter (drops diff derivation, unbreakable by `next-lane-*` scenarios) |
| **D4** | How far "preflight/postflight/detect-* become checks" | **Principled split** — content + deploy/e2e validation are registry checks; git-workflow preconditions + detectors stay host adapter scripts behind the flag | Maximalist (git-workflow state as invariant checks — registry pollution; meaningless in sandbox); Minimalist (only deploy-gate is a check — thin gates, no registry advance) |
| **D5** | `--auto` floor + decision-log | Worker's `askStep` journaled floor; a deterministic **`autoResolvePolicy(fork)`** content module (same shape as D3) consulted by the driver; `## Decision log` stays a **side-car** via `decision-log.mjs` | A net-new engine floor mechanism |
| **D6** | Flag & provenance | One `run-next` entry branch on `usesRuntimeEngine(process.env)` (the `backlog-gate.mjs` idiom); `recordRuntimePath` after driving | Per-skill bespoke flags; soft auto-fallback |

## 4. Component design

### 4.1 Ring-1 — `preShipBatch` (shared expensive batch)

Extract the inline block at `orchestrator.mjs:27-37` into a named helper (new file `runtime/engine/loop/pre-ship-batch.mjs`, or a lib export):

```js
export async function preShipBatch({ journal, runId, registry, changedScope, judge, headSha, on, contexts, cost_ceiling }) {
  const sha = headSha ?? gitHeadSha();
  const ledger = journal.read(runId);
  if (e2eIsFresh(ledger, sha)) return ledger.steps.get('e2e').value.findings;   // resume: no re-deploy
  const findings = await runWatch({ registry, trigger: { on, contexts, cost_ceiling }, changedScope, judge });
  journal.record(runId, 'e2e', { sha, green: findings.length === 0, findings });
  return findings;
}
```

- The `contexts`/`cost_ceiling` are **caller-supplied** (not hardcoded) so the worker can pass lane-derived values.
- `runOrchestrator` refactors its inline block to call this with `on:'epic-pre-done'`, `contexts:['audit','gate']`, `cost_ceiling:'expensive'`, `changedScope:['**/*']` — **behavior-preserving** (guarded by existing orchestrator tests + the parity `bne-*` scenarios).
- `runWorker` gains a new step **between execute and ship-gate**, gated on lane: `if (lane !== 'doc-layer') { const t = laneToTrigger(lane); const findings = await preShipBatch({ ..., on:'item-pre-ship', changedScope: itemDiffPaths, ...t }); if (findings.length) return { taskId: item.id, status: 'failed', summary: ..., findings }; }`. This is the D1 spine extension; re-freezes into SPEC 1.
- `changedScope` for the worker is the item's branch delta (`origin/main..HEAD`), so `runWatch` scope-selection targets the touched surface.
- **Freshness key** is `sha` via `e2eIsFresh(ledger, sha)` (`journal.mjs:146-149`); `journal.step` is sha-agnostic, which is exactly why the batch uses `journal.record` (a moved HEAD ⇒ stale ⇒ re-deploy; a pure resume ⇒ short-circuit).

### 4.2 Content ring

- **`classifyLane(item, diffPaths) → 'doc-layer'|'simple'|'complex'`** — pure, mirroring `classifyChanges`/`resolveDeployServices`. Doc-layer = docs/backlog/MEMORY only; complex = code/infra, cross-service, public-interface touch, or `requires_deploy`; simple otherwise. Graded by the 4 `next-lane-*` scenarios.
- **`laneToTrigger(lane) → {contexts, cost_ceiling} | null`** — pure map. `doc-layer → null` (worker **skips** `preShipBatch` entirely — no deploy). `simple` and `complex → {contexts:['audit'], cost_ceiling:'expensive'}`; the runner (§4.3) then decides deploy-vs-skip *internally* via `detect-deploy-needed` exit-code, so lane only decides *whether the batch runs*, not what it deploys.
- **`autoResolvePolicy(fork) → 'pause'|'auto-resolve'|'hard-floor'`** — pure, mirroring D3. Encodes the legacy `--auto` per-source policy: `type:design`→pause; safe in-workstream fork (blast-radius clean)→auto-resolve the reusable option; irreversible/outward-facing→hard-floor pause. Graded by `next-auto-design-pause` / `next-auto-fork-resolve`.
- **`deploy-gate.yaml`** CheckEntry — `evaluator: { type: deterministic, run: "cmd:node .claude/skills/backlog-next/deploy-gate-runner.mjs" }`, `cost_tier: expensive`, **`contexts: [audit]`** (NOT `[gate]`), scope = code/infra surface. It carries `audit` — not `gate` — precisely so it is selected **only** by the sha-pinned `preShipBatch` (whose trigger includes `audit`) and **never** by the worker's per-wake ship `runGate` (which selects `contexts.includes('gate')` and does not cost-filter). This is the fix that prevents a re-deploy on every ship-gate wake and a double-run alongside `preShipBatch`.

### 4.3 Adapter ring

- **`deploy-gate-runner.mjs`** (host runner behind the seam) — sequences: `changedFiles(origin/main..HEAD)` → `classifyChanges` → `resolveDeployServices(graph, seedFiles)` (`detect-deploy-needed.mjs:173`) → `deploy.sh --services=<tokens>` → `nx run-many -t test-integration -p <affected>` → involved e2e scenarios. Exit 0 = all green (evaluator returns `[]`), non-zero = one finding with stdout/stderr evidence. Spawns the real `deploy.sh` (stub-testable; parity asserts `callLog.called:['deploy.sh']`).
- **`run-next.mjs`** CLI driver — mirrors `run-item.mjs`: loads item/registry, builds `makeClaudeCodeCapabilities({ runner })` where `runner` performs the execute work (or parks for the interactive session), drives `runWorker`, records `recordRuntimePath(journal,{runId,workstream,sha})`. Behind the flag it also calls the host **side-cars**: `preflight.mjs`/`postflight.mjs` (git-workflow preconditions), `detect-doc-derivation.mjs` (6.1), `detect-deploy-needed.mjs` exit-code (routing), and mirrors fulfilled floor choices into `decision-log.mjs append`. Exit contract `0 done / 3 paused / 1 failed / 2 usage`.

## 5. Data flow (flag on)

```
run-next --id <id>
  → usesRuntimeEngine(env) ? runtime path : legacy body
  → preflight.mjs (host: tree-clean, main-not-ahead, backlog gate, no-stale-worktrees)
  → build capabilities (deploy-gate runner injected)
  → runWorker({item, capabilities, registry}):
       start-gate  (runGate boundary:'start' — content/invariant checks in item scope)
       execute     (journal.step; parks → session works → fulfil → replay)
       preShipBatch(on:'item-pre-ship', changedScope=itemDiff)   ← D1: sha-pinned deploy+e2e
       ship-gate   (runGate boundary:'ship')
       ship floor-ask (askStep — never auto-ships; --auto per autoResolvePolicy)
  → recordRuntimePath(journal,...)                                ← soak-observer counts this
  → postflight.mjs (host: tree-clean, lint, shipped-frontmatter, main-sync, branch-deleted)
```

Lane (`classifyLane`) gates whether `preShipBatch` runs and with what `cost_ceiling` (doc-layer ⇒ no deploy batch). Worktree/branch creation + cleanup remain **host git** (skill/`worktree-ops.mjs`), not engine concerns.

## 6. Acceptance — parity mapping

WS-3's slice of the 43 `unmapped:'P5'` rows in `scripts/parity-oracle/mapping.mjs`:

| Scenario | Grades | Owner |
|---|---|---|
| `next-lane-doc-layer`, `next-lane-simple`, `next-lane-design-doc`, `next-lane-complex` | `classifyLane` | WS-3 (core) |
| `next-auto-design-pause`, `next-auto-fork-resolve` | `autoResolvePolicy` + floor | WS-3 (core) |
| `add-id-collision-suffix`, `add-notes-scalar` | write-layer (filename suffixing / notes scalar) | WS-3 **if** the worker write path covers them, else filed forward to a WS-1 follow-up |

For each: author the `rt-<scenario>.scenario.mjs` twin (template: `scripts/parity-oracle/scenarios/rt-next-lane-complex-ship.scenario.mjs`), flip `MAPPING[<id>]` from `P5(...)` to `RT(...)`, and assert `{ runId:'item-<id>', path:'runtime' }` in the scenario `journal[]` so `gradeJournal` (`runtime-grade.mjs:21`) verifies the runtime path actually drove it. Green = every mapped pair `dominant` (`verdict.mjs pairVerdict`). Then flip `RUNTIME_ENGINE` for the backlog-next slice.

The 33 `bne-*` (epic orchestrator) are **WS-4**. The 2 `themes-*` are separate.

## 7. Out of scope

- **WS-4** (`next-epic` → `runOrchestrator`, the 33 `bne-*` scenarios, `run-epic.mjs`).
- **Legacy-body deletion** (P6, user-triggered) — the `backlog-next` SKILL.md prose stays byte-for-byte.
- **`runtime-operational-surface`** (view+executor).
- **Re-designing frozen ring-1 contracts** beyond the additive `preShipBatch` extraction (which re-freezes into SPEC 1).
- **Worktree-ops binding** — host git stays; the engine does not manage worktrees.
- The 2 `add-*` write-layer scenarios **if** they prove to be pure WS-1 router concerns (then filed forward, not forced into WS-3).

## 8. Testing strategy

- **Unit:** `preShipBatch` (sha-fresh short-circuit vs re-run; findings→failed), `classifyLane`, `laneToTrigger`, `autoResolvePolicy`, `deploy-gate-runner` (sequence + exit-code mapping, with stubbed `deploy.sh`/`nx`), `run-next` flag branch + exit contract.
- **Orchestrator regression:** the refactor of `orchestrator.mjs:27-37` to call `preShipBatch` must keep existing orchestrator tests + `bne-*` parity green (behavior-preserving).
- **Parity:** the 6 (+2) scenarios above go `unmapped → dominant` with `path:runtime` assertions.
- **Dogfood:** this workstream's own closing phase (§6.3/6.4 of `backlog-next`) exercises the real deploy-gate against dev sandbox once — the primary-risk-carrier's live proof.

## 9. Risks & open questions

- **Real-deploy cost/latency in the batch.** The sha-pinning bounds re-runs (a resume never re-deploys), but the first firing is a real `deploy.sh` + integration + e2e. Mitigation: `laneToTrigger` skips the batch entirely for doc-layer/simple-no-deploy; cost is surfaced via the closing-phase e2e cost gate.
- **`changedScope` correctness for the worker batch.** Must be the item branch delta, not `['**/*']` (which the orchestrator uses because an epic spans everything). Getting this wrong over- or under-scopes `runWatch` selection.
- **The 2 `add-*` scenarios' true owner** — resolved at plan time by inspecting whether the worker write path (vs the WS-1 intake write path) is what these grade.
- **Ring-1 re-freeze.** The `preShipBatch` extraction + `runWorker` step must update the SPEC-1 frozen record and pass the import-boundary test (no skill import from ring-1 — the runner stays in the adapter/content ring, invoked via `cmd:`).
