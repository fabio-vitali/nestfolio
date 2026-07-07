// runtime/engine/loop/pre-ship-batch.mjs — the sha-conditional expensive pre-ship batch, shared by
// runOrchestrator (epic-pre-done) and runWorker (item-pre-ship). Extracted from orchestrator.mjs's inline
// block (F-14): journal.step is sha-AGNOSTIC, so freshness is a SEPARATE mechanism — record the result
// via journal.record('e2e',{sha,...}) and gate re-runs with e2eIsFresh(ledger, HEAD). A moved HEAD ⇒
// stale ⇒ re-run; a pure resume ⇒ short-circuit (never re-deploy). Ring-1: imports only ../lib/*.
import { runWatch } from '../lib/run-watch.mjs';
import { e2eIsFresh, gitHeadSha } from '../lib/journal.mjs';

export async function preShipBatch({ journal, runId, registry, changedScope, judge, headSha, contexts, cost_ceiling, on }) {
  const sha = headSha ?? gitHeadSha();
  const ledger = journal.read(runId);
  if (e2eIsFresh(ledger, sha)) return ledger.steps.get('e2e').value.findings;   // resume: no re-deploy
  const findings = await runWatch({ registry, trigger: { on, contexts, cost_ceiling }, changedScope, judge });
  journal.record(runId, 'e2e', { sha, green: findings.length === 0, findings });
  return findings;
}
