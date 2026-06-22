import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChanges } from '../detect-deploy-needed.mjs';

test('TIER1: services/<domain>/<service>/src/** captures the service name', () => {
  const result = classifyChanges([
    'services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['decision-workflow-ctrl']);
  assert.equal(result.unknownPaths.length, 0);
  assert.equal(result.triggers[0].reason, 'Lambda code');
});

test('TIER1: services/<domain>/<service>/infrastructure/** captures the service name', () => {
  const result = classifyChanges([
    'services/execution/broker-alpaca-adpt/infrastructure/service.stack.ts',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['broker-alpaca-adpt']);
  assert.equal(result.triggers[0].reason, 'CDK stack');
});

test('TIER1: services/<domain>/<service>/domain/** captures the service name', () => {
  const result = classifyChanges([
    'services/investor/investor-profile-ctrl/domain/events/profile-updated.ts',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['investor-profile-ctrl']);
  assert.equal(result.triggers[0].reason, 'event/intent schema');
});

test('TIER1: changes in multiple services across domains aggregate uniquely', () => {
  const result = classifyChanges([
    'services/advisory/decision-workflow-ctrl/src/handlers/a.ts',
    'services/advisory/decision-workflow-ctrl/src/handlers/b.ts',
    'services/execution/broker-ctrl/infrastructure/service.stack.ts',
    'services/ledger/ledger-bff/domain/events/x.ts',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['broker-ctrl', 'decision-workflow-ctrl', 'ledger-bff']);
  assert.equal(result.unknownPaths.length, 0);
});

test('TIER1: domain-root changes (no service segment) fall through to unknown', () => {
  // Regression guard: the old regex /^services\/([^/]+)\/src\// captured `<domain>` as service.
  // The new regex requires a second segment, so a stray `services/<domain>/README.md`
  // should NOT be classified as a service path.
  const result = classifyChanges([
    'services/advisory/README.md',
  ]);
  assert.equal(result.services.length, 0);
  assert.equal(result.unknownPaths.length, 1);
  assert.equal(result.unknownPaths[0], 'services/advisory/README.md');
});

test('TIER0: services/<domain>/<service>/test/** is no-deploy (test-only change never builds an artifact)', () => {
  const result = classifyChanges([
    'services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts',
  ]);
  assert.equal(result.deploy, false);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.triggers.length, 0);
  assert.equal(result.unknownPaths.length, 0, 'a test-only service change must NOT fall through to the conservative deploy=true default');
  assert.equal(result.seedFiles.length, 0, 'a Tier-0 test file must not seed the true-affected resolver');
});

test('TIER0: a test-only change mixed with src isolates the deploy to the src service only', () => {
  const result = classifyChanges([
    'services/advisory/decision-workflow-ctrl/src/handlers/a.ts',
    'services/advisory/decision-workflow-ctrl/test/integration/a.int.test.ts',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['decision-workflow-ctrl']);
  assert.equal(result.skipped.length, 1, 'the test file is skipped');
  assert.equal(result.unknownPaths.length, 0);
});

test('TIER1 precedence: services/<domain>/<service>/src/** with "test" in a deeper segment still deploys', () => {
  // Guard the regex anchor: the Tier-0 rule must match the `/test/` directory segment,
  // not the substring "test" anywhere — a src file named *.test.ts is runtime-adjacent
  // fixture/helper under src/ and stays Tier 1.
  const result = classifyChanges([
    'services/ledger/ledger-bff/src/handlers/posting.test-helpers.ts',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['ledger-bff']);
  assert.equal(result.triggers[0].reason, 'Lambda code');
});

test('TIER0: docs/ and .claude/ are skipped', () => {
  const result = classifyChanges([
    'docs/backlog/foo.md',
    '.claude/skills/backlog-next/detect-deploy-needed.mjs',
  ]);
  assert.equal(result.deploy, false);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.triggers.length, 0);
  assert.equal(result.unknownPaths.length, 0);
});

test('ROOT_DEPLOY: pnpm-lock.yaml triggers workspace-wide deploy with no service scoping', () => {
  const result = classifyChanges(['pnpm-lock.yaml']);
  assert.equal(result.deploy, true);
  assert.equal(result.services.length, 0);
  assert.equal(result.triggers[0].reason, 'workspace-wide config');
});

test('mixed: services/<domain>/<service>/src/** + docs/** isolates the service and skips docs', () => {
  const result = classifyChanges([
    'services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts',
    'docs/backlog/some-fix.md',
  ]);
  assert.equal(result.deploy, true);
  assert.deepEqual(result.services, ['decision-workflow-ctrl']);
  assert.equal(result.skipped.length, 1);
});

test('empty input', () => {
  const result = classifyChanges([]);
  assert.equal(result.deploy, false);
  assert.equal(result.services.length, 0);
  assert.equal(result.triggers.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.unknownPaths.length, 0);
});
