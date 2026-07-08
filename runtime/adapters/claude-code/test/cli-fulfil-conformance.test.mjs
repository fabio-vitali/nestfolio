// runtime/adapters/claude-code/test/cli-fulfil-conformance.test.mjs — ONE adapter-ring conformance
// test for the malformed --fulfil/--value badPair guard (backported everywhere by
// run-next-fulfil-badpair-guard). CF1 discovery has teeth: a NEW run-*.mjs adapter that mentions
// --fulfil but is missing from TABLE fails the totality assertion, so future adapters get the
// conformance for free. CF2 asserts every adapter exits 2 + prints its usage line on the three
// malformed shapes — validated I/O-free (dummy positionals never reach the journal or disk).
// Replaces the per-adapter copies (run-item DRV4, run-next RN3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const DIR = 'runtime/adapters/claude-code';

// argv prefix per adapter = the minimal invocation BEFORE the malformed flags. Dummies are safe:
// every adapter validates flags I/O-free before resolving ids/files (run-backward "Finding 2").
const TABLE = {
  'run-item.mjs': ['x'],
  'run-next.mjs': ['x'],
  'run-epic.mjs': ['x'],
  'run-intake.mjs': ['--finding', 'no-such-finding.json'],
  'run-themes.mjs': [],
  'run-backward.mjs': ['curate', '--check', 'x', '--trigger', 'ship-gate'],
  'run-view.mjs': [],   // read-only surface: ANY --fulfil/--value is rejected outright (its hints mention --fulfil)
};

const MALFORMED = [
  ['--fulfil', 'k'],             // --value missing entirely
  ['--fulfil', '--value', '5'],  // flag swallows flag: key would parse as '--value'
  ['--fulfil', 'k', '--value'],  // trailing --value with no json
];

const fulfilAdapters = () => readdirSync(DIR)
  .filter((f) => /^run-.*\.mjs$/.test(f))
  .filter((f) => readFileSync(join(DIR, f), 'utf8').includes('--fulfil'));

test('CF1 discovery totality: every --fulfil-mentioning run-*.mjs adapter is in the conformance table', () => {
  assert.deepEqual(fulfilAdapters().sort(), Object.keys(TABLE).sort(),
    'a new --fulfil-parsing run-*.mjs adapter must be added to TABLE (it gets the badPair conformance for free)');
});

test('CF2 every adapter exits 2 + prints usage on the three malformed --fulfil/--value shapes', () => {
  for (const [file, prefix] of Object.entries(TABLE)) {
    for (const shape of MALFORMED) {
      const argv = [join(DIR, file), ...prefix, ...shape];
      const r = spawnSync('node', argv, { encoding: 'utf8', cwd: process.cwd() });
      assert.equal(r.status, 2, `${file} argv: ${argv.slice(1).join(' ')}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
      assert.match(r.stderr, /usage/, `${file} argv: ${argv.slice(1).join(' ')}`);
    }
  }
});
