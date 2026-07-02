// runtime/engine/loop/orchestrator.mjs — the epic spine (§9.3). Drives CORE members one-at-a-time via
// execute (INLINE — the decision-bearing spine, never fanOut), batches the expensive checks once at
// epic-pre-done via runWatch, single merge via ask. fanOut is reserved for BREADTH work only.
// The epic-pre-done batch is SHA-CONDITIONAL (e2eIsFresh, F-14): a moved HEAD re-runs it, never replays stale.
import { runWatch } from '../lib/run-watch.mjs';
import { e2eIsFresh, gitHeadSha } from '../lib/journal.mjs';

export async function runOrchestrator({ epic, members, capabilities, registry }) {
  const { journal, execute, ask } = capabilities;
  const runId = `epic-${epic.id}`;
  journal.begin(runId, { runId, branch: `feat/epic-${epic.id}`, worktree: `.wt/epic-${epic.id}`, auto: false });

  const core = members.filter((m) => (m.epic_role ?? 'core') === 'core');
  for (const m of core) {
    const res = await journal.step(runId, `member.${m.id}`, async () =>
      execute({ id: m.id, prompt: `Work member ${m.id}`, scope: (m.scope ?? '').split(/[\s,]+/).filter(Boolean), payload: { member: m } }));
    if (res.status !== 'done') return { taskId: epic.id, status: res.status, summary: `member ${m.id}: ${res.summary}` };
  }

  // epic-pre-done batch — the expensive checks (incl. the live e2e). SHA-CONDITIONAL, not step-replay:
  // journal.step short-circuits on ANY recorded value, so a resume after HEAD moved would replay STALE
  // findings. Gate on e2eIsFresh (F-14) — a moved HEAD ⇒ re-run against the new tree, then re-record.
  const headSha = (capabilities.gitHeadSha ?? gitHeadSha)();
  const ledger = journal.read(runId);
  let findings;
  if (e2eIsFresh(ledger, headSha)) {
    findings = ledger.steps.get('e2e').value.findings;                  // fresh vs HEAD — replay, no re-run
  } else {
    findings = await runWatch({ registry, trigger: { on: 'epic-pre-done', contexts: ['audit', 'gate'], cost_ceiling: 'expensive' }, changedScope: ['**/*'], judge: capabilities.judge });
    journal.record(runId, 'e2e', { sha: headSha, green: findings.length === 0, findings });   // key 'e2e' — e2eIsFresh reads it
  }
  if (findings.length) return { taskId: epic.id, status: 'failed', summary: `epic-pre-done raised ${findings.length} findings`, findings };

  const choice = await ask({ id: `merge-${epic.id}`, question: `Merge epic ${epic.id} (single PR)?`,
    options: [{ label: 'Merge', value: 'merge', recommended: true }, { label: 'Hold', value: 'hold' }] });
  return { taskId: epic.id, status: 'done', summary: `epic ${epic.id}: ${core.length} core members driven inline; merge=${choice.value}` };
}
