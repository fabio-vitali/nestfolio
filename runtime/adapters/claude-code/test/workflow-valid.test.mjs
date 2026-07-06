import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('runtime-audit workflow is valid and wired to the dispatcher + weekly cadence', () => {
  const wf = parse(readFileSync('.github/workflows/runtime-audit.yml', 'utf8'));
  // NOTE: YAML parses the `on:` key as boolean true — assert on the parsed key.
  const triggers = wf[true] ?? wf.on;
  assert.ok('workflow_dispatch' in triggers, 'manual dispatch');
  assert.ok(Array.isArray(triggers.schedule) && triggers.schedule[0].cron, 'weekly schedule cron');
  const steps = wf.jobs.audit.steps;
  const runsDispatcher = steps.some((s) => (s.run ?? '').includes('run-audit.mjs'));
  assert.ok(runsDispatcher, 'a step runs run-audit.mjs');
  const usesToken = steps.some((s) => JSON.stringify(s.env ?? {}).includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.ok(usesToken, 'the dispatcher step passes CLAUDE_CODE_OAUTH_TOKEN');
});
