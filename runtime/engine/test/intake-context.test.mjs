import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIntakeContext, renderIntakePrompt } from '../lib/intake-context.mjs';

const finding = { id: 'f1', check: 'no-x', kind: 'inconsistency', scope: ['a/b.ts'], detail: 'broke', raised_at: 't' };

test('loadIntakeContext surfaces the active epic with done_when/scope/out_of_scope', () => {
  const backlog = [
    { id: 'acme-epic', status: 'active', type: 'epic', done_when: 'acme redesigned', scope: 'src/acme/**', out_of_scope: ['x'] },
    { id: 'other', status: 'queued', type: 'bug' },
  ];
  const ctx = loadIntakeContext({ backlog });
  assert.equal(ctx.activeEpic.id, 'acme-epic');
  assert.equal(ctx.activeEpic.done_when, 'acme redesigned');
  assert.equal(ctx.activeEpic.scope, 'src/acme/**');
  assert.deepEqual(ctx.activeEpic.out_of_scope, ['x']);
});

test('loadIntakeContext returns null activeEpic when no epic is active (an active non-epic is not it)', () => {
  const backlog = [{ id: 'exec', status: 'active', type: 'refactor' }];
  const ctx = loadIntakeContext({ backlog });
  assert.equal(ctx.activeEpic, null);
});

test('loadIntakeContext lists parking theme epics and parking orphans, excluding members and non-parking', () => {
  const backlog = [
    { id: 'theme-a', status: 'parking', type: 'epic', notes: 'root cause A' },
    { id: 'orphan-1', status: 'parking', type: 'bug', notes: 'lonely bug' },
    { id: 'member-1', status: 'parking', type: 'bug', notes: 'in an epic', epic: 'theme-a' },
    { id: 'shipped-1', status: 'shipped', type: 'bug', notes: 'done' },
  ];
  const ctx = loadIntakeContext({ backlog });
  assert.deepEqual(ctx.themeEpics.map((t) => t.id), ['theme-a']);
  assert.deepEqual(ctx.orphans.map((o) => o.id), ['orphan-1']); // member-1 (has epic:) + shipped-1 excluded
});

test('renderIntakePrompt embeds the finding, the active-epic done_when, and the closure-predicate instruction', () => {
  const context = loadIntakeContext({ backlog: [
    { id: 'acme-epic', status: 'active', type: 'epic', done_when: 'acme redesigned', scope: 's', out_of_scope: [] },
  ] });
  const p = renderIntakePrompt({ finding, context });
  assert.match(p, /broke/);            // finding detail
  assert.match(p, /acme-epic/);
  assert.match(p, /acme redesigned/);  // done_when reaches the judge
  assert.match(p, /closure-predicate/i);
});

test('renderIntakePrompt requests epicRole route-agnostically — for join-theme and mint-aggregation, not only fold', () => {
  const context = loadIntakeContext({ backlog: [
    { id: 'acme-epic', status: 'active', type: 'epic', done_when: 'acme redesigned', scope: 's', out_of_scope: [] },
  ] });
  const p = renderIntakePrompt({ finding, context });
  // every epic-attaching route must invite the judge to set epicRole (else the write defaults it to core)
  assert.match(p, /join-theme[^\n]*epicRole/i);
  assert.match(p, /mint-aggregation[^\n]*epicRole/i);
});

test('renderIntakePrompt states fold is unavailable when there is no active epic', () => {
  const context = loadIntakeContext({ backlog: [] });
  const p = renderIntakePrompt({ finding, context });
  assert.match(p, /ACTIVE EPIC: none/);
});
