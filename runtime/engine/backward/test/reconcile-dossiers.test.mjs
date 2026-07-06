import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { reconcileDossiers } from '../lib/reconcile-dossiers.mjs';

function tmpMem() {
  const dir = mkdtempSync(join(tmpdir(), 'nf-dossier-'));
  writeFileSync(join(dir, 'project_alpha.md'), '---\nname: Alpha\ntype: project\nrelated_workstreams:\n  - stale-ws\n---\nbody\n', 'utf8');
  writeFileSync(join(dir, 'project_beta.md'), '---\nname: Beta\ntype: project\n---\nbody\n', 'utf8');
  writeFileSync(join(dir, 'feedback_x.md'), '---\nname: fb\n---\nlesson\n', 'utf8'); // must be ignored
  return dir;
}

test('reconcileDossiers derives related_workstreams from item.topic_memory (sorted), clears stale, ignores feedback_*', () => {
  const dir = tmpMem();
  try {
    const items = [
      { id: 'ws-b', topic_memory: ['project_beta.md'] },
      { id: 'ws-a', topic_memory: ['project_beta.md'] },
      { id: 'ws-none', topic_memory: [] },
    ];
    reconcileDossiers({ items, memDir: dir });
    const beta = parse(readFileSync(join(dir, 'project_beta.md'), 'utf8').split('---')[1]);
    assert.deepEqual(beta.related_workstreams, ['ws-a', 'ws-b']); // sorted
    const alpha = parse(readFileSync(join(dir, 'project_alpha.md'), 'utf8').split('---')[1]);
    assert.deepEqual(alpha.related_workstreams, []); // stale 'stale-ws' cleared (no incoming pointer)
    const fb = readFileSync(join(dir, 'feedback_x.md'), 'utf8');
    assert.ok(!fb.includes('related_workstreams')); // feedback_* untouched
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
