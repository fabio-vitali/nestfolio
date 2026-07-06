// scripts/parity-oracle/suites.mjs — assemble the two defineSuite instances + the mapped pairs.
import { readdirSync } from 'node:fs';
import { defineSuite } from '../benchmark-backlog/suite.mjs';
import { buildSandbox } from '../benchmark-backlog/sandbox.mjs';
import { gradeScenario } from '../benchmark-backlog/grade.mjs';
import { STUB_BINARIES } from '../benchmark-backlog/structural-lint.mjs';
import { buildRuntimeSandbox } from './runtime-sandbox.mjs';
import { gradeRuntimeScenario } from './runtime-grade.mjs';
import { MAPPING, mappedIds } from './mapping.mjs';

async function importAll(dirUrl) {
  const out = new Map();
  for (const f of readdirSync(dirUrl).filter((x) => x.endsWith('.scenario.mjs')))
    out.set(f.replace('.scenario.mjs', ''), (await import(new URL(f, dirUrl))).default);
  return out;
}

export async function loadSuites() {
  const legacyById = await importAll(new URL('../benchmark-backlog/scenarios/', import.meta.url));
  const rtById = await importAll(new URL('./scenarios/', import.meta.url));
  const pairs = mappedIds().map((id) => ({
    id,
    legacy: legacyById.get(id),
    runtime: rtById.get(MAPPING[id].runtime.scenario.replace('.scenario.mjs', '')),
  }));
  const legacySuite = defineSuite({ buildSandbox, stubs: STUB_BINARIES, grade: gradeScenario,
    scenarios: pairs.map((p) => p.legacy) });
  const runtimeSuite = defineSuite({ buildSandbox: buildRuntimeSandbox, stubs: STUB_BINARIES,
    grade: gradeRuntimeScenario, scenarios: pairs.map((p) => p.runtime) });
  return { legacySuite, runtimeSuite, pairs };
}
