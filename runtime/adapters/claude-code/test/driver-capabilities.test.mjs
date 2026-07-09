// runtime/adapters/claude-code/test/driver-capabilities.test.mjs — the judge-binding regression
// (from-run-next-pre-ship-judge-binding-gap): workstream-driver mains must compose JUDGED capabilities,
// or every skill:<name> judgment check the start/pre-ship/ship gates select fail-closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('DC3 conformance (discovery-total): every run-*.mjs adapter composes capabilities ONLY via makeDriverCapabilities', () => {
  // Sweeps the adapter dir instead of a hardcoded main list (the CF1 pattern) — a NEW run-*.mjs
  // driver gets the conformance for free (the hardcoded four-file list missed run-view.mjs the day
  // it landed). Two teeth: (1) the raw constructor NAME is banned anywhere in a run-*.mjs source
  // (covers bare calls, {procedures}-by-hand, and import aliasing — the sanctioned wrapper lives in
  // driver-capabilities.mjs, which is not a run-*.mjs); (2) any `const capabilities =` assignment
  // must be the seam call (covers a future hand-rolled capability object).
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = readdirSync(dir).filter((f) => /^run-.*\.mjs$/.test(f));
  assert.ok(files.length >= 9, `discovery looks broken: only ${files.length} run-*.mjs found`);
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(src, /makeClaudeCodeCapabilities/, `${f}: never compose raw capabilities in a driver — use makeDriverCapabilities (judge binding)`);
    if (/const capabilities =/.test(src)) {
      assert.match(src, /const capabilities = makeDriverCapabilities\(/, `${f}: capabilities must be built by makeDriverCapabilities`);
    }
  }
});
