// runtime/engine/loop/worker.mjs — the single-item spine (§9.1). Calls ONLY capabilities + ring-1.
// Re-freeze 2026-07-03: gates are CHECKS (re-run every wake; record() evidence), execute is a pausable
// step (park-not-complete), the ship ask is a journaled floor step and its answer is honored.
// The merge/ship is ALWAYS a floor ask (never auto) — no option runs an irreversible act.
import { runGate } from '../lib/run-gate.mjs';
import { askStep, fulfilledChoices } from '../lib/journal.mjs';
import { deriveJudge } from '../lib/derive-judge.mjs';

const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export async function runWorker({ item, capabilities, registry, locus = {}, auto = false }) {
  const { journal, execute, ask, runProcedure } = capabilities;
  const runId = `item-${item.id}`;
  journal.begin(runId, { runId, auto,
    ...(locus.branch ? { branch: locus.branch } : {}), ...(locus.worktree ? { worktree: locus.worktree } : {}) });
  const judge = deriveJudge(runProcedure);

  const startGate = await runGate({ registry, boundary: 'start', item, judge });   // a gate is a CHECK — never step()ed
  journal.record(runId, 'gate.start', { passed: startGate.passed, findings: startGate.findings });
  if (!startGate.passed) return { taskId: item.id, status: 'failed', summary: `start gate: ${startGate.findings.length} findings`, findings: startGate.findings };

  const task = { id: item.id, prompt: `Implement item ${item.id}`, scope: toGlobs(item.scope),
    payload: { item }, choices: fulfilledChoices(journal.read(runId)), locus };
  const work = await journal.step(runId, `execute:${item.id}`, async () => execute(task));
  if (work.status === 'paused') return { taskId: item.id, status: 'paused', summary: work.summary, decision: work.decision };
  if (work.status === 'failed') return { taskId: item.id, status: 'failed', summary: work.summary, findings: work.findings };

  const shipGate = await runGate({ registry, boundary: 'ship', item, judge });
  journal.record(runId, 'gate.ship', { passed: shipGate.passed, findings: shipGate.findings });
  if (!shipGate.passed) return { taskId: item.id, status: 'failed', summary: `ship gate: ${shipGate.findings.length} findings`, findings: shipGate.findings };

  const decision = { id: `ship-${item.id}`, question: `Ship item ${item.id}?`,
    options: [{ label: 'Ship', value: 'ship', recommended: true }, { label: 'Hold', value: 'hold' }],
    context: item.done_when };
  const choice = await askStep({ journal, runId, decision, ask, recordWhen: (c) => c.value === 'ship' });
  if (!choice) return { taskId: item.id, status: 'paused', summary: `awaiting floor: ${decision.id}`, decision };
  if (choice.value !== 'ship') return { taskId: item.id, status: 'paused', summary: `held: ${item.id} (re-asked next wake)`, decision };
  return { taskId: item.id, status: 'done', summary: `worked ${item.id}; ship approved` };
}
