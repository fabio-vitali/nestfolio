// scripts/parity-oracle/runtime-grade.mjs — bef's 3 grading layers + the runtime's native evidence
// surface: journal invariants. A journal spec entry asserts a step key is complete ('has'), pending
// ('awaiting'), or absent from a runId's ledger (root = <sandbox>/.git, where the in-sandbox drivers
// write via makeJournal({}) → gitCommonDir()).
import { join } from 'node:path';
import { gradeScenario } from '../benchmark-backlog/grade.mjs';
import { makeJournal, pendingDecisions } from '../../runtime/engine/lib/journal.mjs';
import { RUNTIME_PATH_KEY } from '../../runtime/engine/lib/path-provenance.mjs';

export function gradeJournal(scenario, sandboxDir) {
  const failures = [];
  const specs = scenario.journal ?? [];
  if (!specs.length) return { pass: true, failures };
  const journal = makeJournal({ root: join(sandboxDir, '.git') });
  for (const spec of specs) {
    const ledger = journal.read(spec.runId);
    const step = (k) => ledger?.steps.get(k);
    if (spec.has && step(spec.has)?.status !== 'complete') failures.push(`journal ${spec.runId}: expected complete step "${spec.has}"`);
    if (spec.awaiting && !pendingDecisions(ledger).some((r) => r.key === spec.awaiting)) failures.push(`journal ${spec.runId}: expected awaiting "${spec.awaiting}"`);
    if (spec.absent && step(spec.absent)) failures.push(`journal ${spec.runId}: step "${spec.absent}" should be absent`);
    if (spec.path && step(RUNTIME_PATH_KEY)?.value?.path !== spec.path)
      failures.push(`journal ${spec.runId}: expected path record "${spec.path}" (runtime path did not drive)`);
  }
  return { pass: failures.length === 0, failures };
}

export async function gradeRuntimeScenario(scenario, runResult, sandboxDir, stubsLog) {
  const base = await gradeScenario(scenario, runResult, sandboxDir, stubsLog);
  const journal = gradeJournal(scenario, sandboxDir);
  return { ...base, journal, gatePass: base.gatePass && journal.pass };
}
