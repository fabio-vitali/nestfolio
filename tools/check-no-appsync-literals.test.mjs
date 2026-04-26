// node:test sibling for check-no-appsync-literals.mjs.
// Verifies the gate flags AppSync literals and stays silent on clean trees.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'tools/check-no-appsync-literals.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-charter-check-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}

function runGate(root) {
  return spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
}

test('exit 0 on a clean tree', () => {
  const root = makeTree({
    'apps/foo-mfe/src/main.ts': "console.log('hello');",
    'libs/shell/src/lib.ts': "export const x = 1;",
    'libs/frontend-deps/index.js': "module.exports = {};",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1 with file in report when appsync-api appears in apps/', () => {
  const root = makeTree({
    'apps/foo-mfe/src/main.ts': "const url = 'https://x.appsync-api.us-east-1.amazonaws.com/graphql';",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /apps\/foo-mfe\/src\/main\.ts/);
    assert.match(r.stdout + r.stderr, /appsync-api/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1 when wss appsync-realtime-api appears', () => {
  const root = makeTree({
    'apps/bar-mfe/src/index.html': '<a href="wss://x.appsync-realtime-api.us-east-1.amazonaws.com/graphql">x</a>',
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /appsync-realtime-api/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1 when bare amazonaws.com appears in libs/shell', () => {
  const root = makeTree({
    'libs/shell/src/foo.ts': "const region = 'sqs.us-east-1.amazonaws.com';",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /amazonaws\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 0 when libs/cdk-constructs (out of scope) contains appsync-api', () => {
  const root = makeTree({
    'libs/cdk-constructs/src/foo.ts': "const url = 'https://x.appsync-api.us-east-1.amazonaws.com';",
    'apps/foo-mfe/src/main.ts': "console.log('clean');",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `expected clean (cdk-constructs is out of scope), got: ${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit 0 ignores node_modules / dist / cdk.out / .worktrees', () => {
  const root = makeTree({
    'apps/foo-mfe/node_modules/dep/file.js': "appsync-api.us-east-1.amazonaws.com",
    'apps/foo-mfe/dist/main.js': "appsync-api.us-east-1.amazonaws.com",
    'apps/foo-mfe/src/main.ts': "console.log('clean');",
    '.worktrees/old/apps/foo-mfe/src/main.ts': "appsync-api.us-east-1.amazonaws.com",
  });
  try {
    const r = runGate(root);
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
