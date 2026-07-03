// runtime/engine/loop/orchestrator.mjs — the epic spine (§9.3). Re-freeze 2026-07-03: member steps are
// pausable parks (a paused member no longer wedges the run — fulfil + replay resumes it); the merge ask
// is a journaled floor step whose answer is honored; gitHeadSha is an options param (git is universal
// infrastructure, not a capability). Epic-pre-done stays SHA-CONDITIONAL via e2eIsFresh (F-14).
import { runWatch } from '../lib/run-watch.mjs';
import { e2eIsFresh, gitHeadSha, askStep, fulfilledChoices } from '../lib/journal.mjs';
import { deriveJudge } from '../lib/derive-judge.mjs';

const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export async function runOrchestrator({ epic, members, capabilities, registry, locus = {}, auto = false, headSha }) {
  const { journal, execute, ask, runProcedure } = capabilities;
  const runId = `epic-${epic.id}`;
  journal.begin(runId, { runId, auto,
    ...(locus.branch ? { branch: locus.branch } : {}), ...(locus.worktree ? { worktree: locus.worktree } : {}) });
  const judge = deriveJudge(runProcedure);

  const core = members.filter((m) => (m.epic_role ?? 'core') === 'core');
  for (const m of core) {
    const task = { id: m.id, prompt: `Work member ${m.id}`, scope: toGlobs(m.scope),
      payload: { member: m }, choices: fulfilledChoices(journal.read(runId)), locus };
    const res = await journal.step(runId, `member.${m.id}`, async () => execute(task));
    if (res.status === 'paused') return { taskId: epic.id, status: 'paused', summary: `member ${m.id}: ${res.summary}`, decision: res.decision };
    if (res.status !== 'done') return { taskId: epic.id, status: res.status, summary: `member ${m.id}: ${res.summary}`, findings: res.findings };
  }

  // epic-pre-done batch — SHA-CONDITIONAL, not step-replay (a moved HEAD re-runs; a resume never replays stale).
  const sha = headSha ?? gitHeadSha();
  const ledger = journal.read(runId);
  let findings;
  if (e2eIsFresh(ledger, sha)) {
    findings = ledger.steps.get('e2e').value.findings;
  } else {
    findings = await runWatch({ registry, trigger: { on: 'epic-pre-done', contexts: ['audit', 'gate'], cost_ceiling: 'expensive' }, changedScope: ['**/*'], judge });
    journal.record(runId, 'e2e', { sha, green: findings.length === 0, findings });
  }
  if (findings.length) return { taskId: epic.id, status: 'failed', summary: `epic-pre-done raised ${findings.length} findings`, findings };

  const decision = { id: `merge-${epic.id}`, question: `Merge epic ${epic.id} (single PR)?`,
    options: [{ label: 'Merge', value: 'merge', recommended: true }, { label: 'Hold', value: 'hold' }] };
  const choice = await askStep({ journal, runId, decision, ask, recordWhen: (c) => c.value === 'merge' });
  if (!choice) return { taskId: epic.id, status: 'paused', summary: `awaiting floor: ${decision.id}`, decision };
  if (choice.value !== 'merge') return { taskId: epic.id, status: 'paused', summary: `held: epic ${epic.id} (re-asked next wake)`, decision };
  return { taskId: epic.id, status: 'done', summary: `epic ${epic.id}: ${core.length} core members driven inline; merge approved` };
}
