import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, registryErrorLines } from '../lib/load-registry.mjs';
import { validCheck, withTmpDir, writeYaml } from './_fixtures.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// A1
test('loads 3 valid checks: length 3, byId complete, no errors', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  for (const id of ['a', 'b', 'c']) writeYaml(dir, id, validCheck({ id }));
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 3);
  assert.equal(reg.byId.size, 3);
  assert.ok(reg.byId.has('a') && reg.byId.has('b') && reg.byId.has('c'));
  assert.deepEqual(reg.errors, []);
}));

// A2 — parseable-precondition parity with backlog-lint: malformed file is LOCATED, others still load, no throw
test('a malformed YAML file is reported located-by-filename; the rest still load; no throw', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  writeYaml(dir, 'good', validCheck({ id: 'good' }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'broken.yaml'), 'id: [unterminated\n  bad: : :', 'utf8');
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 1);
  assert.equal(reg.errors.length, 1);
  assert.match(reg.errors[0].file, /broken\.yaml$/);
}));

// A3 — duplicate id
test('two files with the same id → a duplicate-id error', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  writeYaml(dir, 'first', validCheck({ id: 'dup' }));
  writeYaml(dir, 'second', validCheck({ id: 'dup' }));
  const reg = loadRegistry({ checksDir: dir });
  assert.ok(reg.errors.some((e) => /duplicate id/i.test(e.error) && /dup/.test(e.error)));
}));

// A4 — missing required field, named by file + field
test('a check missing `property` → a zod error naming the file and field', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  const bad = validCheck({ id: 'nofield' }); delete bad.property;
  writeYaml(dir, 'nofield', bad);
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 0);
  const e = reg.errors.find((e) => /nofield\.yaml$/.test(e.file));
  assert.ok(e && /property/.test(e.error));
}));

// A5 — judgment without flake_contract rejected at load
test('a judgment check with no flake_contract → a validation error at load', () => withTmpDir((root) => {
  const dir = join(root, 'checks');
  const j = validCheck({ id: 'j', evaluator: { type: 'judgment', run: 'skill:audit-service' } });
  delete j.flake_contract;
  writeYaml(dir, 'j', j);
  const reg = loadRegistry({ checksDir: dir });
  assert.equal(reg.checks.length, 0);
  assert.ok(reg.errors.some((e) => /flake_contract/.test(e.error)));
}));

// empty dir → empty registry, no throw
test('an empty/absent checksDir yields an empty registry, no throw', () => withTmpDir((root) => {
  const reg = loadRegistry({ checksDir: join(root, 'does-not-exist') });
  assert.deepEqual(reg.checks, []); assert.deepEqual(reg.errors, []);
}));

test('registryErrorLines: null when clean, located lines when corrupt', () => {
  assert.equal(registryErrorLines({ errors: [] }), null);
  const lines = registryErrorLines({ errors: [{ file: 'checks/bad.yaml', error: 'malformed YAML: x' }] });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /checks\/bad\.yaml.*malformed YAML/);
});
