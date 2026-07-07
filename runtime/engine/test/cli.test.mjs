import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../cli.mjs';

test('init copies the 7 starter checks into a project content ring', () => {   // +deploy-gate (WS-3)
  const to = join(mkdtempSync(join(tmpdir(), 'ramp-')), 'checks');
  mkdirSync(to, { recursive: true });
  runInit({ from: 'runtime/starter/checks', to });
  assert.equal(readdirSync(to).filter((f) => f.endsWith('.yaml')).length, 7);
});
