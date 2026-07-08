// runtime/adapters/claude-code/test/run-view.test.mjs — the §14 operator-surface driver. RV1–RV4:
// audit-artifact merge, runId→resume-hint mapping, read-only view smoke over the real repo, and the
// exec/usage guard rails (--fulfil is REJECTED — the view is read-only; resume goes via the hints).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAuditFindings, resumeHints } from '../run-view.mjs';

const DRIVER = 'runtime/adapters/claude-code/run-view.mjs';

test('RV1 loadAuditFindings merges run-audit artifacts; missing dir → []', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-audit-'));
  try {
    writeFileSync(join(dir, 'audit-manual-local.json'), JSON.stringify({
      runId: 'audit-manual-local', trigger: 'manual', findings: [{ id: 'af1', detail: 'audit says' }],
    }));
    writeFileSync(join(dir, 'audit-empty.json'), JSON.stringify({ runId: 'audit-empty', trigger: 'schedule', findings: [] }));
    const rows = loadAuditFindings(dir);
    assert.deepEqual(rows.map((r) => [r.runId, r.key]), [['audit-manual-local', 'audit:manual']]);
    assert.equal(rows[0].findings[0].id, 'af1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(loadAuditFindings(join(tmpdir(), 'rv-absent-none')), []);
});

test('RV2 resumeHints maps runId prefixes to the owning driver command', () => {
  const hints = resumeHints(['item-foo', 'epic-bar', 'intake-baz', 'other-x']);
  assert.match(hints['item-foo'], /run-next\.mjs foo --fulfil/);
  assert.match(hints['epic-bar'], /run-epic\.mjs bar --fulfil/);
  assert.match(hints['intake-baz'], /run-intake\.mjs --finding/);
  assert.equal(hints['other-x'], undefined);          // unknown prefix → no hint, row still renders
});

test('RV3 view --json smoke over the real repo: exit 0, derived surface shape present', () => {
  const r = spawnSync('node', [DRIVER, 'view', '--json'], { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const k of ['active', 'ranked', 'pending', 'findings', 'provenance']) assert.ok(k in out.surface, `missing surface.${k}`);
  assert.ok(out.surface.provenance.length > 0, 'registry provenance should be non-empty on the real repo');
});

test('RV4 usage rails: unknown subcommand / malformed exec / any --fulfil → exit 2 + usage (I/O-free)', () => {
  for (const argv of [['bogus'], ['exec'], ['exec', '--procedure'], ['--fulfil', 'k', '--value', '{}']]) {
    const r = spawnSync('node', [DRIVER, ...argv], { encoding: 'utf8' });
    assert.equal(r.status, 2, `argv ${argv.join(' ')}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /usage/);
  }
});
