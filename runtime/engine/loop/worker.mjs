// runtime/engine/loop/worker.mjs — the single-item spine (§9.1). Calls ONLY capabilities + ring-1.
// Sequence: begin → start-gate → execute (the inline, visible work) → ship-gate → ask-to-ship.
// The merge/ship is ALWAYS a floor ask (never auto) — no option runs an irreversible act.
import { runGate } from '../lib/run-gate.mjs';

const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export async function runWorker({ item, capabilities, registry }) {
  const { journal, execute, ask } = capabilities;
  const runId = `item-${item.id}`;
  journal.begin(runId, { runId, branch: `feat/${item.id}`, worktree: `.wt/${item.id}`, auto: false });

  const startGate = await journal.step(runId, 'gate.start', async () => runGate({ registry, boundary: 'start', item, judge: capabilities.judge }));
  if (!startGate.passed) return { taskId: item.id, status: 'failed', summary: `start gate: ${startGate.findings.length} findings`, findings: startGate.findings };

  const work = await execute({ id: item.id, prompt: `Implement item ${item.id}`, scope: toGlobs(item.scope), payload: { item } });
  if (work.status === 'paused') return { taskId: item.id, status: 'paused', summary: work.summary };
  if (work.status === 'failed') return { taskId: item.id, status: 'failed', summary: work.summary, findings: work.findings };

  const shipGate = await journal.step(runId, 'gate.ship', async () => runGate({ registry, boundary: 'ship', item, judge: capabilities.judge }));
  if (!shipGate.passed) return { taskId: item.id, status: 'failed', summary: `ship gate: ${shipGate.findings.length} findings`, findings: shipGate.findings };

  const choice = await ask({ id: `ship-${item.id}`, question: `Ship item ${item.id}?`,
    options: [{ label: 'Ship', value: 'ship', recommended: true }, { label: 'Hold', value: 'hold' }], context: item.done_criteria });
  return { taskId: item.id, status: 'done', summary: `worked ${item.id}; ship=${choice.value}` };
}
