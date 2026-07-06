import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAudit } from '../run-audit.mjs';

const auditCheck = (id) => ({
  id, property: 'p', kind: 'gap',
  evaluator: { type: 'judgment', run: `skill:${id}` },
  cost_tier: 'expensive', contexts: ['audit'], scope: { paths: ['services/**'] },
  status: 'active',
  flake_contract: { eval_scenario: 'x.mjs', allowed_flake_rate: 0.05, calibration: 'c' },
});
const trigger = { on: 'schedule', contexts: ['audit'], cost_ceiling: 'expensive' };

test('runAudit runs the judge over selected audit checks and returns completed findings', async () => {
  const registry = { checks: [auditCheck('audit-service')], byId: new Map(), errors: [] };
  const judge = async (check) => [{ detail: `${check.id} drift`, scope: ['services/a/**'] }];
  const findings = await runAudit({ registry, trigger, judge, changedScope: ['**/*'] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'audit-service');
  assert.equal(findings[0].detail, 'audit-service drift');
  assert.ok(findings[0].raised_at, 'watch completes raised_at');
});

test('--only filters the registry to a single check', async () => {
  const registry = { checks: [auditCheck('audit-service'), auditCheck('audit-domain')], byId: new Map(), errors: [] };
  const judge = async (check) => [{ detail: `${check.id} drift`, scope: ['services/a/**'] }];
  const findings = await runAudit({ registry, trigger, judge, changedScope: ['**/*'], only: 'audit-service' });
  assert.deepEqual(findings.map((f) => f.check), ['audit-service']);
});

test('clean audit yields zero findings', async () => {
  const registry = { checks: [auditCheck('audit-service')], byId: new Map(), errors: [] };
  const judge = async () => [];
  const findings = await runAudit({ registry, trigger, judge, changedScope: ['**/*'] });
  assert.deepEqual(findings, []);
});
