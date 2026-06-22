import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDerivation } from '../detect-doc-derivation.mjs';

// `baseExists` is injected so the classifier is pure (no git access). For an
// established service it returns true; a false return marks a brand-new service.
const allExist = () => true;

function actionKeys(result) {
  return result.actions.map((a) => a.action);
}

test('infrastructure change → C4 pipeline + service card', () => {
  const r = classifyDerivation(
    ['services/execution/broker-ctrl/infrastructure/service.stack.ts'],
    { baseExists: allExist },
  );
  assert.equal(r.derivation, true);
  assert.deepEqual(r.affectedServices, ['broker-ctrl']);
  assert.ok(actionKeys(r).includes('generate-c4-diagrams (full pipeline)'));
  assert.ok(actionKeys(r).includes('audit-service broker-ctrl'));
});

test('domain/events.ts change → service card + flow-spec regen', () => {
  const r = classifyDerivation(
    ['services/investor/investor-ctrl/domain/events.ts'],
    { baseExists: allExist },
  );
  assert.equal(r.derivation, true);
  assert.deepEqual(r.affectedServices, ['investor-ctrl']);
  assert.ok(actionKeys(r).includes('audit-service investor-ctrl'));
  assert.ok(
    actionKeys(r).some((k) => k.startsWith('identify-and-regen affected flow specs')),
  );
});

test('src/event-listener.ts change → service card + flow-spec regen', () => {
  const r = classifyDerivation(
    ['services/ledger/ledger-bff/src/event-listener.ts'],
    { baseExists: allExist },
  );
  assert.ok(actionKeys(r).includes('audit-service ledger-bff'));
  assert.ok(
    actionKeys(r).some((k) => k.startsWith('identify-and-regen affected flow specs')),
  );
});

test('other src change → service card audit only (no flow-spec regen)', () => {
  const r = classifyDerivation(
    ['services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts'],
    { baseExists: allExist },
  );
  assert.deepEqual(actionKeys(r), ['audit-service decision-workflow-ctrl']);
});

test('adapter change → audit-domain for both domains', () => {
  const r = classifyDerivation(
    ['services/execution/broker-alpaca-adpt/src/event-listener.ts'],
    { baseExists: allExist },
  );
  assert.deepEqual(r.adapterChanges, ['broker-alpaca-adpt']);
  assert.ok(
    actionKeys(r).some((k) => k.startsWith('audit-domain for both domains touched by broker-alpaca-adpt')),
  );
});

test('new service (baseExists=false) → full sweep, not a plain service-card audit', () => {
  const r = classifyDerivation(
    ['services/investor/brand-new-ctrl/src/handlers/x.ts'],
    { baseExists: (svcDir) => svcDir !== 'services/investor/brand-new-ctrl' },
  );
  assert.deepEqual(r.newServices, ['brand-new-ctrl']);
  assert.equal(r.affectedServices.length, 0, 'a new service is not also an affected (existing) service');
  assert.ok(actionKeys(r).includes('generate-c4-diagrams (full pipeline)'));
  assert.ok(actionKeys(r).includes('flow spec coverage for new service brand-new-ctrl'));
  assert.ok(actionKeys(r).includes('audit-system (cross-domain consistency check for new service)'));
});

test('test/ + project.json + tsconfig under a service are skipped (no derivation)', () => {
  const r = classifyDerivation(
    [
      'services/investor/investor-bff/test/unit/foo.test.ts',
      'services/investor/investor-bff/project.json',
      'services/investor/investor-bff/tsconfig.app.json',
    ],
    { baseExists: allExist },
  );
  assert.equal(r.derivation, false);
  assert.equal(r.actions.length, 0);
  assert.equal(r.affectedServices.length, 0);
});

test('flows/*.flow.yaml → validate-flow', () => {
  const r = classifyDerivation(['flows/broker-circuit-breaker.flow.yaml'], { baseExists: allExist });
  assert.deepEqual(r.flowSpecsTouched, ['flows/broker-circuit-breaker.flow.yaml']);
  assert.ok(actionKeys(r).includes('validate-flow flows/broker-circuit-breaker.flow.yaml'));
});

test('MFE substantive change → card regen; css/package.json are skipped', () => {
  const r = classifyDerivation(
    [
      'apps/investor-web/dashboard-mfe/src/app/app.ts',
      'apps/investor-web/dashboard-mfe/src/styles.scss',
      'apps/investor-web/dashboard-mfe/package.json',
    ],
    { baseExists: allExist },
  );
  assert.equal(r.actions.length, 1);
  assert.ok(actionKeys(r)[0].includes('apps/investor-web/dashboard-mfe'));
});

test('empty input → no derivation', () => {
  const r = classifyDerivation([], { baseExists: allExist });
  assert.equal(r.derivation, false);
  assert.equal(r.actions.length, 0);
  assert.equal(r.affectedServices.length, 0);
  assert.equal(r.newServices.length, 0);
});

test('pure: docs/ + .claude/ only → no derivation (resume-signal: member delta with no source change)', () => {
  // Mirrors the F-2 fix in action: given a member-start base whose only delta is
  // backlog + skill tooling, the classifier reports no outstanding derivation.
  const r = classifyDerivation(
    ['docs/backlog/x.md', '.claude/skills/backlog-next/detect-doc-derivation.mjs'],
    { baseExists: allExist },
  );
  assert.equal(r.derivation, false);
});
