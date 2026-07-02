import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('runtime.config.json carries the triggersFile binding', () => {
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  assert.equal(cfg.checksDir, 'runtime/content/checks');
  assert.equal(cfg.triggersFile, 'runtime/content/triggers.yaml');
});

test('project.json test + typecheck targets discover the new trees', () => {
  const proj = JSON.parse(readFileSync('runtime/project.json', 'utf8'));
  const cmd = proj.targets.test.options.command;
  assert.match(cmd, /engine\/loop\/test\/\*\.test\.mjs/);
  assert.match(cmd, /adapters\/\*\*\/test\/\*\.test\.mjs/);
  // the typecheck cache MUST bust on a capability-contract type edit (else a broken contract stays green)
  assert.match(JSON.stringify(proj.targets.typecheck.inputs), /engine\/\*\*\/\*\.ts|capabilities/);
});

test('tsconfig includes the capability contract + the journal schema explicitly', () => {
  const ts = JSON.parse(readFileSync('runtime/tsconfig.json', 'utf8'));
  assert.ok(ts.include.some((g) => g.includes('capabilities')));
  assert.ok(ts.include.includes('engine/schema/journal.schema.ts'));   // non-vacuous: an explicit entry
});
