import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('./emit-index-html.mjs', import.meta.url).pathname;

function runEmit(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' });
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'emit-index-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('substitutes {{CSP}} placeholder with csp.txt contents (trimmed)', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />\n<body></body>');
    writeFileSync(csp, "default-src 'self'\n");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 0, result.stderr);
    const emitted = readFileSync(out, 'utf-8');
    assert.match(emitted, /<meta content="default-src 'self'" \/>/);
    assert.ok(!emitted.includes('{{CSP}}'));
  });
});

test('emits a "DO NOT EDIT" comment as the second line of output', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<!doctype html>\n<html><head><meta content="{{CSP}}" /></head></html>');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 0, result.stderr);
    const lines = readFileSync(out, 'utf-8').split('\n');
    assert.equal(lines[0], '<!doctype html>');
    assert.match(lines[1], /<!-- Generated from index.html.tmpl \+ csp\.txt\. DO NOT EDIT\. -->/);
  });
});

test('fails with exit 1 when template is missing', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'nope.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /template/i);
  });
});

test('fails with exit 1 when csp file is missing', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'nope.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />');

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /csp/i);
  });
});

test('fails with exit 1 when csp file is empty', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />');
    writeFileSync(csp, '  \n  ');

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty/i);
  });
});

test('fails with exit 1 when {{CSP}} placeholder is absent', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="no placeholder here" />');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /placeholder/i);
  });
});

test('fails with exit 1 when {{CSP}} placeholder appears more than once', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" /><meta content="{{CSP}}" />');
    writeFileSync(csp, "default-src 'self'");

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /placeholder/i);
  });
});

test('fails with exit 1 when invoked with wrong number of arguments', () => {
  const result = runEmit(['only-one']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage/i);
});

test('writes atomically via temp file + rename', () => {
  withTmp((dir) => {
    const tmpl = join(dir, 'index.html.tmpl');
    const csp = join(dir, 'csp.txt');
    const out = join(dir, 'index.html');
    writeFileSync(tmpl, '<meta content="{{CSP}}" />');
    writeFileSync(csp, "default-src 'self'");
    writeFileSync(out, 'OLD CONTENT');

    const result = runEmit([tmpl, csp, out]);
    assert.equal(result.status, 0, result.stderr);
    const emitted = readFileSync(out, 'utf-8');
    assert.ok(!emitted.includes('OLD CONTENT'));
    assert.match(emitted, /<meta content="default-src 'self'" \/>/);
  });
});
