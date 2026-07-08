// scripts/parity-oracle/mapping.mjs — THE source of truth: every legacy benchmark-backlog scenario id
// appears exactly once, either mapped to an rt-* scenario module or explicitly unmapped:'P5' with a
// reason. The unmapped rows ARE the P5 migration checklist (rendered in every report — no silent caps).

export const OPERATOR_PROMPT = (taskLine) => `You are the RUNTIME LOOP OPERATOR. Your job: ${taskLine}
Drive the runtime loop driver command given above. Protocol:
1. Run the driver command with Bash. Read its JSON output.
2. If it exits with exit code 3 (parked), inspect out.pending[]. A pending entry whose decision.id starts
   with "execute:" is an execute park — its pending KEY may differ from the decision id (e.g. the epic spine
   parks members under key member.<id> with decision execute:<id>): perform the described task yourself in
   this repository (edit files, run commands), then re-invoke the SAME driver command appending:
   --fulfil '<the pending KEY, exactly as printed — NOT the decision id>' --value '<json>' where <json> is a
   TaskResult like {"taskId":"<task id>","status":"done","summary":"<what you did>"}. For an intake route
   decision the summary MUST be EXACTLY the route JSON, e.g.
   {"taskId":"intake-f1","status":"done","summary":"{\\"route\\":\\"fold\\",\\"epic\\":\\"acme-epic\\",\\"epicRole\\":\\"core\\"}"}.
3. If a pending entry's decision.id does NOT start with "execute:" (a ship/merge/mint/curate floor decision),
   STOP — that is a human decision. Your ENTIRE final response must be one line: <<HARNESS-PAUSE: floor decision <key>>>.
4. Repeat until the driver exits 0 (done) — then summarize what was filed/done — or until a floor stop.
Never modify files under runtime/. Never invent driver flags.`;

const P5 = (reason) => ({ unmapped: 'P5', reason });
const RT = (scenario) => ({ runtime: { scenario } });

export const MAPPING = {
  // ---- router parity: backlog-add vs run-intake (7 of 9 mapped) ----
  'add-atomicity-split': RT('rt-add-atomicity-split.scenario.mjs'),
  'add-commit-scope': RT('rt-add-commit-scope.scenario.mjs'),
  'add-fold-captured': RT('rt-add-fold-captured.scenario.mjs'),
  'add-fold-core': RT('rt-add-fold-core.scenario.mjs'),
  'add-id-collision-suffix': P5('runtime slug is deterministic from finding.check (from-<check>); id-collision suffixing is backlog-add filename prose — no engine analogue until P5 re-platforms the writer'),
  'add-join-theme': RT('rt-add-join-theme.scenario.mjs'),
  'add-mint-aggregation': RT('rt-add-mint-aggregation.scenario.mjs'),
  'add-notes-scalar': P5('notes-scalar formatting is backlog-add write-layer prose; ItemSchema/item-store-valid covers shape, not notes styling'),
  'add-orphan': RT('rt-add-orphan.scenario.mjs'),
  // ---- driver parity: backlog-next vs worker spine (engine-expressible subset, 4) ----
  'next-lane-complex-ship': RT('rt-next-lane-complex-ship.scenario.mjs'),
  'next-auto-floor-pause': RT('rt-next-auto-floor-pause.scenario.mjs'),
  'next-auto-finishing-pr-stop': RT('rt-next-auto-finishing-pr-stop.scenario.mjs'),
  'next-preflight-dirty-stop': RT('rt-next-preflight-dirty-stop.scenario.mjs'),
  'next-lane-doc-layer': RT('rt-next-lane-doc-layer.scenario.mjs'),
  'next-lane-simple': P5('classifyLane is diff-driven (D3): "simple" needs a real single-service code diff, but the services-free runtime sandbox seeds no services/ tree and this routing item does a docs-only lifecycle transition, so the branch delta reduces to Doc-layer in-sandbox. The simple/complex branch correctness is carried by classify-lane.test.mjs (9 cases); the batch-firing path is proven by rt-next-lane-complex-ship (infra-retention-bump). A sandbox that seeds a services/ tree is the forward upgrade.'),
  'next-lane-design-doc': RT('rt-next-lane-design-doc.scenario.mjs'),
  'next-lane-complex': P5('same seam as next-lane-simple: diff-driven classifyLane needs a real code diff the services-free sandbox cannot produce (standalone-complex names no concrete file to create, unlike infra-retention-bump), so its in-sandbox delta reduces to Doc-layer. Batch-firing is proven by rt-next-lane-complex-ship + classify-lane.test.mjs.'),
  'next-auto-design-pause': RT('rt-next-auto-design-pause.scenario.mjs'),
  'next-auto-fork-resolve': RT('rt-next-auto-fork-resolve.scenario.mjs'),
  // ---- orchestrator parity: backlog-next-epic vs runOrchestrator spine (WS-4) ----
  // The spine-expressible epic happy-path twins move to RT (both stop at the merge floor park — the spine never
  // auto-merges). The rest stay P5 in two HONEST buckets so the checklist says WHY each is still unmapped.
  'bne-ship-clean': RT('rt-bne-ship-clean.scenario.mjs'),
  'bne-e8-auto-no-self-merge': RT('rt-bne-e8-auto-no-self-merge.scenario.mjs'),
  // Bucket A — host-side, DEFERRED per spec §8/§10: the gh-PR-state probe (resume-gate.mjs), the worktree-ops
  // binding, and epic selection/promotion — host-git/PR/selection prose with no in-sandbox spine analogue.
  ...Object.fromEntries([
    'bne-e0-dirty-tree-stop', 'bne-e2-worktree-reattach', 'bne-e8-conflict-resolution', 'bne-e8-pr-route',
    'bne-e84-postflight-cwd-survival', 'bne-resume-absent-fresh', 'bne-resume-corrupt-stop',
    'bne-resume-merged-tail-only', 'bne-resume-partial', 'bne-resume-pr-open-stop', 'bne-promote-clean',
    'bne-promote-already-drainable', 'bne-select-auto-confirm', 'bne-select-bare-epic-id',
    'bne-select-impact-rank', 'bne-select-like-criterion', 'bne-select-zero-candidates',
  ].map((id) => [id, P5('WS-4 defers the gh-PR-state probe (resume-gate.mjs) + worktree-ops binding + epic selection/promotion (spec §8/§10) — host-git/PR/selection prose with no in-sandbox spine analogue; epics drain as standalone member PRs (epic D1)')])),
  // Bucket B — deterministic spine/driver behavior proven by unit tests (orchestrator.test.mjs +
  // run-epic.test.mjs: sha-conditional replay, gate-red, member park/resume, rule-11 guard) or host auto/
  // E-phase prose; not distinctly expressible as a live-operator scenario in the services-free sandbox.
  ...Object.fromEntries([
    'bne-ship-stale-sha', 'bne-ship-e2e-red-no-ship', 'bne-ship-captured-promote', 'bne-member-checkpoint-clear',
    'bne-rule11-different-active', 'bne-member-debug-budget', 'bne-member-f21-nonshared-no-typecheck',
    'bne-e6-zero-tests-red', 'bne-e71-chained-e6', 'bne-auto-blast-fail', 'bne-auto-blast-pass',
    'bne-auto-catchall-pause', 'bne-auto-design-pause', 'bne-auto-irreversible-pause',
  ].map((id) => [id, P5('deterministic spine/driver behavior proven by orchestrator.test.mjs + run-epic.test.mjs (sha-conditional replay, gate-red, member park/resume, rule-11 guard) or host auto/E-phase prose; not distinctly expressible as a live-operator scenario in the services-free sandbox')])),
  'themes-cluster-root-cause': P5('parking-lot clustering is backlog-themes prose; no engine procedure exists'),
  'themes-discrimination': P5('parking-lot clustering is backlog-themes prose; no engine procedure exists'),
};

/** The still-unmapped legacy ids — the P5 migration checklist (drains toward 0 as skills re-platform). */
export function unmappedIds() { return Object.entries(MAPPING).filter(([, m]) => m.unmapped).map(([id]) => id); }

export function mappedIds() {
  return Object.entries(MAPPING).filter(([, m]) => m.runtime).map(([id]) => id);
}
