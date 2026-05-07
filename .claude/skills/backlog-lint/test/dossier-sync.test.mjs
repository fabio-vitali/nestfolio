import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncDossiers } from '../lib/dossier-sync.mjs';

test('syncDossiers writes related_workstreams from topic_memory pointers', () => {
  const memDir = mkdtempSync(join(tmpdir(), 'mem-'));
  writeFileSync(join(memDir, 'project_alpha.md'),
    `---\nname: alpha\n---\n\n# Alpha\nBody.\n`);
  writeFileSync(join(memDir, 'project_beta.md'),
    `# Beta\n\nNo frontmatter.\n`);

  const backlogFiles = [
    { id: 'work-1', frontmatter: { topic_memory: ['project_alpha.md'] } },
    { id: 'work-2', frontmatter: { topic_memory: ['project_alpha.md', 'project_beta.md'] } },
  ];

  syncDossiers(backlogFiles, memDir);

  const alpha = readFileSync(join(memDir, 'project_alpha.md'), 'utf8');
  assert.match(alpha, /related_workstreams:\s*\n\s*-\s*work-1\n\s*-\s*work-2/);
  // existing fields preserved
  assert.match(alpha, /name:\s*alpha/);

  const beta = readFileSync(join(memDir, 'project_beta.md'), 'utf8');
  // beta had no frontmatter — gets one prepended
  assert.match(beta, /^---\nrelated_workstreams:\s*\n\s*-\s*work-2\n---\n/);
  assert.match(beta, /# Beta/);

  rmSync(memDir, { recursive: true });
});

test('syncDossiers clears related_workstreams when no backlog file points to a dossier', () => {
  const memDir = mkdtempSync(join(tmpdir(), 'mem-'));
  // Pre-existing dossier with stale related_workstreams
  writeFileSync(join(memDir, 'project_alpha.md'),
    `---\nname: alpha\nrelated_workstreams:\n  - old-id\n---\n\nBody.\n`);
  // No backlog file references this dossier
  syncDossiers([{ id: 'work-1', frontmatter: {} }], memDir);
  const alpha = readFileSync(join(memDir, 'project_alpha.md'), 'utf8');
  // Stale id removed; related_workstreams now empty
  assert.doesNotMatch(alpha, /old-id/);
  assert.match(alpha, /related_workstreams:\s*(\[\]|\n)/);
  // Other fields preserved
  assert.match(alpha, /name:\s*alpha/);
  rmSync(memDir, { recursive: true });
});
