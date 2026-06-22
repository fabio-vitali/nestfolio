import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChanges,
  resolveDeployServices,
  DEPLOY_VIA,
} from '../detect-deploy-needed.mjs';

// ---------------------------------------------------------------------------
// Half 1 — harness-lib over-fan-out: a test-only lib change must NOT deploy,
// and must NOT seed the true-affected resolver (which would fan out to its
// full dependent service closure — 27 services in the live graph).
// ---------------------------------------------------------------------------

test('harness-lib-only change (test-support) → deploy=false, seedFiles empty', () => {
  const r = classifyChanges(['libs/test-support/src/event-bus-trap.ts']);
  assert.equal(r.deploy, false, 'a test-only lib change requires no deploy');
  assert.deepEqual(r.seedFiles, [], 'harness-lib files must not seed the resolver');
  assert.equal(r.triggers.length, 1);
  assert.equal(r.triggers[0].noRuntimeDeploy, true);
});

test('integration-testing is also noRuntimeDeploy', () => {
  const r = classifyChanges(['libs/integration-testing/src/fixture.ts']);
  assert.equal(r.deploy, false);
  assert.deepEqual(r.seedFiles, []);
  assert.equal(r.triggers[0].noRuntimeDeploy, true);
});

test('harness-lib mixed with a real service change → deploy=true, seed excludes the harness lib', () => {
  const r = classifyChanges([
    'libs/test-support/src/trap.ts',
    'services/advisory/decision-workflow-ctrl/src/handlers/a.ts',
  ]);
  assert.equal(r.deploy, true, 'the real service change still requires a deploy');
  assert.deepEqual(
    r.seedFiles,
    ['services/advisory/decision-workflow-ctrl/src/handlers/a.ts'],
    'only the real-deploy file seeds the resolver — the harness lib is excluded so it cannot widen the fan-out',
  );
});

test('a real backend-lib change is still a real trigger and seeds the resolver', () => {
  const r = classifyChanges(['libs/event-processor/src/pipeline.ts']);
  assert.equal(r.deploy, true);
  assert.deepEqual(r.seedFiles, ['libs/event-processor/src/pipeline.ts']);
  assert.equal(r.triggers[0].noRuntimeDeploy ?? false, false);
});

test('TIER0 + harness-lib only → deploy=false, no seed', () => {
  const r = classifyChanges(['docs/x.md', 'libs/test-support/src/y.ts']);
  assert.equal(r.deploy, false);
  assert.deepEqual(r.seedFiles, []);
});

// ---------------------------------------------------------------------------
// Half 2 — frontend changes must classify (not fall through to "unknown") and
// resolve to a correct, NON-EMPTY deploy target.
// ---------------------------------------------------------------------------

test('frontend MFE + shell-host source paths classify as triggers (not unknown)', () => {
  const r = classifyChanges([
    'apps/advisory-mfe/src/x.ts',
    'apps/nestfolio-host/src/y.ts',
  ]);
  assert.equal(r.deploy, true);
  assert.equal(r.unknownPaths.length, 0, 'frontend apps must be classified, not unknown');
  // both seed the resolver
  assert.deepEqual(r.seedFiles.sort(), ['apps/advisory-mfe/src/x.ts', 'apps/nestfolio-host/src/y.ts']);
});

// A minimal fake nx graph exercising the deployable predicate + DEPLOY_VIA.
//   ui (lib)        ← mfe-a (app, deploy-mfe target), host (app, no deploy target)
//   frontend-deps   (lib, no app dependents)
//   svc-a (app, deploy target)
//   e2e   (app, NO targets)
function fakeGraph() {
  const node = (root, type, targets = {}) => ({ type, data: { root, targets } });
  return {
    nodes: {
      'ui': node('libs/ui', 'lib'),
      'frontend-deps': node('libs/frontend-deps', 'lib'),
      'mfe-a': node('apps/mfe-a', 'app', { 'deploy-mfe': {} }),
      'nestfolio-host': node('apps/nestfolio-host', 'app', { build: {} }),
      'investor-web': node('services/investor/investor-web', 'app', { deploy: {}, 'deploy-shell': {} }),
      'svc-a': node('services/advisory/svc-a', 'app', { deploy: {} }),
      'e2e': node('apps/e2e', 'app', {}),
    },
    dependencies: {
      'mfe-a': [{ source: 'mfe-a', target: 'ui' }],
      'nestfolio-host': [{ source: 'nestfolio-host', target: 'ui' }],
      'investor-web': [],
      'svc-a': [],
      'e2e': [],
    },
  };
}

test('frontend lib resolves to consuming MFEs + shell host (host→investor-web)', () => {
  const out = resolveDeployServices(fakeGraph(), ['libs/ui/src/x.ts']);
  assert.deepEqual(out, ['investor-web', 'mfe-a'],
    'ui change deploys the MFE that imports it + investor-web (the shell host bundle is uploaded by investor-web:deploy-shell)');
});

test('shell-host source change alone resolves to investor-web', () => {
  const out = resolveDeployServices(fakeGraph(), ['apps/nestfolio-host/src/x.ts']);
  assert.deepEqual(out, ['investor-web']);
});

test('frontend-deps (no app dependents in graph) resolves to investor-web via DEPLOY_VIA', () => {
  const out = resolveDeployServices(fakeGraph(), ['libs/frontend-deps/src/x.ts']);
  assert.deepEqual(out, ['investor-web']);
});

test('a deployable service app passes through as itself', () => {
  const out = resolveDeployServices(fakeGraph(), ['services/advisory/svc-a/src/x.ts']);
  assert.deepEqual(out, ['svc-a']);
});

test('an MFE source change resolves to that MFE', () => {
  const out = resolveDeployServices(fakeGraph(), ['apps/mfe-a/src/x.ts']);
  assert.deepEqual(out, ['mfe-a']);
});

test('an app with no deploy target and not in DEPLOY_VIA is dropped (never emitted)', () => {
  const out = resolveDeployServices(fakeGraph(), ['apps/e2e/src/x.ts']);
  assert.deepEqual(out, [], 'a non-deployable harness app must not appear in --services');
});

test('DEPLOY_VIA documents the shell-bundle coupling for both host and frontend-deps', () => {
  assert.equal(DEPLOY_VIA['nestfolio-host'], 'investor-web');
  assert.equal(DEPLOY_VIA['frontend-deps'], 'investor-web');
});
