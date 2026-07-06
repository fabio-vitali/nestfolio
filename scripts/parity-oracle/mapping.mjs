// scripts/parity-oracle/mapping.mjs — THE source of truth: every legacy benchmark-backlog scenario id
// appears exactly once, either mapped to an rt-* scenario module or explicitly unmapped:'P5' with a
// reason. The unmapped rows ARE the P5 migration checklist (rendered in every report — no silent caps).

export const OPERATOR_PROMPT = (taskLine) => `You are the RUNTIME LOOP OPERATOR. Your job: ${taskLine}
Drive the runtime loop driver command given above. Protocol:
1. Run the driver command with Bash. Read its JSON output.
2. If it exits with exit code 3 (parked), inspect out.pending[]. For a pending key starting with "execute:":
   perform the described task yourself in this repository (edit files, run commands), then re-invoke the SAME
   driver command appending: --fulfil '<the pending key>' --value '<json>' where <json> is a TaskResult like
   {"taskId":"<task id>","status":"done","summary":"<what you did>"}. For an intake route decision the summary
   MUST be EXACTLY the route JSON, e.g. {"taskId":"intake-f1","status":"done","summary":"{\\"route\\":\\"fold\\",\\"epic\\":\\"acme-epic\\",\\"epicRole\\":\\"core\\"}"}.
3. If a pending decision is NOT an execute: park (a ship/merge/mint/curate floor decision), STOP — that is a
   human decision. Your ENTIRE final response must be one line: <<HARNESS-PAUSE: floor decision <key>>>.
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
  'next-lane-doc-layer': P5('lane classification is backlog-next skill prose'),
  'next-lane-simple': P5('lane classification is backlog-next skill prose'),
  'next-lane-design-doc': P5('lane classification is backlog-next skill prose'),
  'next-lane-complex': P5('lane classification is backlog-next skill prose'),
  'next-auto-design-pause': P5('design-fork recognition is --auto policy prose; the engine floor equivalent is covered by rt-next-auto-floor-pause'),
  'next-auto-fork-resolve': P5('blast-radius fork gate is detect-fork-blast-radius.mjs procedure content'),
  // ---- orchestrator + themes: entirely P5 (D3 / item scope: lint, router, driver parity only) ----
  ...Object.fromEntries([
    'bne-auto-blast-fail', 'bne-auto-blast-pass', 'bne-auto-catchall-pause', 'bne-auto-design-pause',
    'bne-auto-irreversible-pause', 'bne-e0-dirty-tree-stop', 'bne-e2-worktree-reattach', 'bne-e6-zero-tests-red',
    'bne-e71-chained-e6', 'bne-e8-auto-no-self-merge', 'bne-e8-conflict-resolution', 'bne-e8-pr-route',
    'bne-e84-postflight-cwd-survival', 'bne-member-checkpoint-clear', 'bne-member-debug-budget',
    'bne-member-f21-nonshared-no-typecheck', 'bne-promote-clean', 'bne-promote-already-drainable',
    'bne-resume-absent-fresh', 'bne-resume-corrupt-stop', 'bne-resume-merged-tail-only', 'bne-resume-partial',
    'bne-resume-pr-open-stop', 'bne-rule11-different-active', 'bne-select-auto-confirm', 'bne-select-bare-epic-id',
    'bne-select-impact-rank', 'bne-select-like-criterion', 'bne-select-zero-candidates', 'bne-ship-clean',
    'bne-ship-captured-promote', 'bne-ship-e2e-red-no-ship', 'bne-ship-stale-sha',
  ].map((id) => [id, P5('epic orchestrator re-platform is P5; E-phase/runstate mechanics are backlog-next-epic skill prose today')])),
  'themes-cluster-root-cause': P5('parking-lot clustering is backlog-themes prose; no engine procedure exists'),
  'themes-discrimination': P5('parking-lot clustering is backlog-themes prose; no engine procedure exists'),
};

export function mappedIds() {
  return Object.entries(MAPPING).filter(([, m]) => m.runtime).map(([id]) => id);
}
