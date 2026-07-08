// runtime/content/test/classify-lane.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLane, laneToTrigger } from '../lib/classify-lane.mjs';

test('CL1 docs-only diff → doc-layer', () => {
  assert.equal(classifyLane({ id: 'x', type: 'refactor' }, ['docs/backlog/x.md', 'MEMORY.md']), 'doc-layer');
});
test('CL2 design item landing only a doc → doc-layer', () => {
  assert.equal(classifyLane({ id: 'x', type: 'design' }, ['docs/superpowers/specs/x.md']), 'doc-layer');
});
test('CL3 single-service src change, no interface → simple', () => {
  assert.equal(classifyLane({ id: 'x', type: 'bug' }, ['services/investor/investor-ctrl/src/handler.ts']), 'simple');
});
test('CL4 requires_deploy → complex', () => {
  assert.equal(classifyLane({ id: 'x', requires_deploy: true }, ['services/investor/investor-ctrl/src/h.ts']), 'complex');
});
test('CL5 public-interface (event-types) → complex', () => {
  assert.equal(classifyLane({ id: 'x' }, ['libs/event-types/src/foo.ts']), 'complex');
});
test('CL6 >1 service touched → complex', () => {
  assert.equal(classifyLane({ id: 'x' }, ['services/a/a-ctrl/src/h.ts', 'services/b/b-ctrl/src/h.ts']), 'complex');
});
test('CL7 infrastructure change → complex', () => {
  assert.equal(classifyLane({ id: 'x' }, ['infrastructure/config/retention-days.txt']), 'complex');
});
test('CL8 laneToTrigger: doc-layer skips the batch', () => {
  assert.equal(laneToTrigger('doc-layer'), null);
});
test('CL10 runtime engine code diff (with adoption docs) → simple, not doc-layer', () => {
  assert.equal(classifyLane({ id: 'x', type: 'bug' }, ['runtime/engine/lib/run-watch.mjs', 'docs/backlog/x.md']), 'simple');
});
test('CL11 tools-only code diff → simple', () => {
  assert.equal(classifyLane({ id: 'x', type: 'bug' }, ['tools/affected-projects.mjs']), 'simple');
});
test('CL12 skill .mjs code diff → simple', () => {
  assert.equal(classifyLane({ id: 'x', type: 'bug' }, ['.claude/skills/backlog-next/preflight.mjs']), 'simple');
});
test('CL13 skill SKILL.md prose-only diff → doc-layer (only .mjs in skills is code)', () => {
  assert.equal(classifyLane({ id: 'x', type: 'refactor' }, ['.claude/skills/backlog-next/SKILL.md']), 'doc-layer');
});
test('CL9 laneToTrigger: complex → expensive audit item-pre-ship', () => {
  assert.deepEqual(laneToTrigger('complex'), { contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
});
