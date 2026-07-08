// runtime/adapters/claude-code/test/driver-capabilities.test.mjs — the judge-binding regression
// (from-run-next-pre-ship-judge-binding-gap): workstream-driver mains must compose JUDGED capabilities,
// or every skill:<name> judgment check the start/pre-ship/ship gates select fail-closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveJudge } from '../../../engine/lib/derive-judge.mjs';
import { makeClaudeCodeCapabilities } from '../index.mjs';
import { makeDriverCapabilities } from '../driver-capabilities.mjs';

const CHECK = { evaluator: { run: 'skill:audit-service' }, scope: { paths: ['services/**'] } };

test('DC1 judge from makeDriverCapabilities resolves skill:audit-*, model from RUNTIME_AUDIT_MODEL', async () => {
  const models = [];
  const runScenario = async (_scenario, _sha, opts) => {
    models.push(opts.model);
    return { result: '```json\n{"findings":[{"detail":"d","evidence":"e","scope":["s"]}]}\n```' };
  };
  const caps = makeDriverCapabilities({ env: { RUNTIME_AUDIT_MODEL: 'model-x' }, runScenario });
  const findings = await deriveJudge(caps.runProcedure)(CHECK);
  assert.equal(findings.length, 1);
  assert.deepEqual(models, ['model-x']);
});

test('DC2 regression contract: bare makeClaudeCodeCapabilities({}) fail-closes the same check', async () => {
  const judge = deriveJudge(makeClaudeCodeCapabilities({}).runProcedure);
  await assert.rejects(() => judge(CHECK), /unknown procedure: audit-service/);
});

test('DC3 conformance: every workstream-driver main() composes via makeDriverCapabilities', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const f of ['run-next.mjs', 'run-epic.mjs', 'run-audit.mjs', 'run-item.mjs']) {
    const src = readFileSync(join(here, '..', f), 'utf8');
    assert.match(src, /makeDriverCapabilities\(/, `${f} must build judged capabilities`);
    assert.doesNotMatch(src, /makeClaudeCodeCapabilities\(\{\}\)/, `${f} must not build bare capabilities`);
  }
});
