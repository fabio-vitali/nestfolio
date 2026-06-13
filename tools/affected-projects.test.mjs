// node:test sibling for affected-projects.mjs.
// Unit tests use synthetic graphs (exact known answers). The golden test
// asserts topology-stable anchors against a committed real-graph fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reverseDependents, mapFilesToProjects, affectedProjects, GLOBAL_FILES,
} from './affected-projects.mjs';

// Build a synthetic graph. nodes: [name, root, type?, targets?]. edges: [source, target].
function makeGraph(nodes, edges) {
  const graph = { nodes: {}, dependencies: {} };
  for (const [name, root, type = 'lib', targets = { test: {} }] of nodes) {
    graph.nodes[name] = {
      name, type,
      data: { root, projectType: type === 'app' ? 'application' : 'library', targets },
    };
    graph.dependencies[name] = [];
  }
  for (const [s, t] of edges) graph.dependencies[s].push({ source: s, target: t, type: 'static' });
  return graph;
}

// A depends on B and C; B depends on C. D is an isolated sink.
// A,B,D are apps with test-integration; C is a lib without it.
const G = makeGraph(
  [
    ['a', 'services/x/a', 'app', { test: {}, 'test-integration': {} }],
    ['b', 'services/x/b', 'app', { test: {}, 'test-integration': {} }],
    ['c', 'libs/c', 'lib', { test: {} }],
    ['d', 'services/x/d', 'app', { test: {}, 'test-integration': {} }],
  ],
  [['a', 'b'], ['a', 'c'], ['b', 'c']],
);

test('reverseDependents inverts the edges', () => {
  const dep = reverseDependents(G);
  assert.deepEqual([...dep.get('c')].sort(), ['a', 'b']);
  assert.deepEqual([...dep.get('b')].sort(), ['a']);
  assert.equal(dep.get('a'), undefined); // nothing depends on a
});

test('affected(touch lib c) = c + all transitive dependents', () => {
  const out = affectedProjects(G, { files: ['libs/c/src/index.ts'] });
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('affected(touch sink d) = only d', () => {
  const out = affectedProjects(G, { files: ['services/x/d/src/main.ts'] });
  assert.deepEqual(out, ['d']);
});

test('affected(touch leaf a) = only a (nothing depends on it)', () => {
  const out = affectedProjects(G, { files: ['services/x/a/src/main.ts'] });
  assert.deepEqual(out, ['a']);
});

test('--with-target filters to projects having that target', () => {
  // c is affected but lacks test-integration → dropped
  const out = affectedProjects(G, { files: ['libs/c/src/index.ts'], withTarget: 'test-integration' });
  assert.deepEqual(out, ['a', 'b']);
});

test('--type filters to app/lib', () => {
  const out = affectedProjects(G, { files: ['libs/c/src/index.ts'], type: 'app' });
  assert.deepEqual(out, ['a', 'b']); // c is a lib
});

test('a global file affects every project', () => {
  for (const gf of GLOBAL_FILES) {
    const out = affectedProjects(G, { files: [gf] });
    assert.deepEqual(out, ['a', 'b', 'c', 'd'], `global file ${gf}`);
  }
});

test('unmapped files (docs, .github) affect nothing', () => {
  const out = affectedProjects(G, { files: ['docs/x.md', '.github/workflows/y.yml'] });
  assert.deepEqual(out, []);
});

test('longest-prefix wins for nested roots', () => {
  const nested = makeGraph(
    [['outer', 'services/x', 'app'], ['inner', 'services/x/inner', 'app']],
    [],
  );
  assert.deepEqual([...mapFilesToProjects(nested, ['services/x/inner/src/f.ts'])], ['inner']);
  assert.deepEqual([...mapFilesToProjects(nested, ['services/x/other/f.ts'])], ['outer']);
});

test('exact-root match (no trailing slash needed) maps to the project', () => {
  const out = mapFilesToProjects(G, ['services/x/d']);
  assert.deepEqual([...out], ['d']);
});
