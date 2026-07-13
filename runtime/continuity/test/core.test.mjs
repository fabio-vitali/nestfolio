import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { loadBacklogItem, updateBacklogItem } from '../lib/backlog-binding.mjs';
import { createFixture } from './test-fixture.mjs';

test('repository store enforces expected revisions and rebuilds derived index', () => {
  const root = createFixture();
  const store = createStore(root);
  const first = store.writeArtifact('work-items', 'w1', { status: 'selected', value: 1 }, { expectedRevision: 0 });
  assert.equal(first.revision, 1);
  assert.throws(
    () => store.writeArtifact('work-items', 'w1', { ...first, value: 2 }, { expectedRevision: 0 }),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  const second = store.writeArtifact('work-items', 'w1', { ...first, value: 2 }, { expectedRevision: 1 });
  assert.equal(second.revision, 2);
  const index = store.rebuildIndex();
  assert.equal(index.artifacts['work-items'][0].revision, 2);
  store.deleteDerivedIndex();
  assert.equal(existsSync(join(root, '.continuity', 'derived', 'index.json')), false);
  const rebuilt = store.rebuildIndex();
  assert.equal(rebuilt.artifacts['work-items'][0].id, 'w1');
  assert.equal(store.readArtifact('work-items', 'w1').value, 2);
});

test('Nestfolio backlog binding uses source digest as the revision guard', () => {
  const root = createFixture();
  const before = loadBacklogItem(root, 'continuity-vs001-resumable-agent-work-session');
  const updated = updateBacklogItem(root, before.frontmatter.id, {
    expected_sha256: before.sha256,
    status: 'shipped',
    closed: '2026-07-13',
    validation_gate: 'fixture validation',
  });
  assert.equal(updated.frontmatter.status, 'shipped');
  assert.match(updated.text, /validation_gate: "fixture validation"/);
  assert.throws(
    () => updateBacklogItem(root, before.frontmatter.id, {
      expected_sha256: before.sha256,
      status: 'shipped',
    }),
    (error) => error.code === 'REVISION_CONFLICT',
  );
});
