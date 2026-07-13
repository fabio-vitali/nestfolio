import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkpointRun, interruptSession, recordFileEffect, selectWork } from '../lib/workflow.mjs';
import { createFixture } from './test-fixture.mjs';

const workId = 'continuity-vs001a-claude-code-session-confirmation';
const workingSetId = 'ws-continuity-vs001a';
const runId = 'run-vs001a';
const session1 = 'session-vs001a-1';
const session2 = 'session-vs001a-2';
const effectKey = 'vs001a-material-effect';
const effectPath = 'continuity/dogfood/vs001a-effect.txt';
const effectContent = 'VS-001A keyed effect completed exactly once.';
const claudeSession1 = '11111111-2222-4333-8444-555555555555';
const claudeSession2 = '99999999-8888-4777-8666-555555555555';

const HOOKS_DIR = 'runtime/continuity/adapters/claude-code/hooks';
const VALIDATOR = 'runtime/continuity/tools/validate-vs001a-executor-provenance.mjs';

function prepareHookFixture() {
  const root = createFixture();
  // A stubbed `claude` binary keeps the version capture deterministic.
  const binDir = join(root, 'stub-bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'claude'), '#!/bin/sh\necho "2.1.207 (Claude Code)"\n');
  chmodSync(join(binDir, 'claude'), 0o755);
  return { root, binDir };
}

function hookEnv(root, binDir, continuity = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: `${binDir}:${process.env.PATH}` };
  // The test runner itself may execute inside a Continuity-launched session;
  // hooks must only see the identity this test injects.
  delete env.CONTINUITY_ACTION;
  delete env.CONTINUITY_RUN_ID;
  delete env.CONTINUITY_SESSION_ID;
  delete env.CONTINUITY_WORKING_SET_ID;
  return { ...env, ...continuity };
}

function runHook(root, script, env, stdin) {
  return spawnSync(process.execPath, [join(root, HOOKS_DIR, script)], {
    cwd: root,
    env,
    input: JSON.stringify(stdin),
    encoding: 'utf8',
  });
}

function runValidator(root, criterion) {
  const args = [join(root, VALIDATOR), '--run-id', runId];
  if (criterion) args.push('--criterion', criterion);
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
}

const readRecord = (root, name) => JSON.parse(readFileSync(join(root, '.continuity', 'executor-sessions', name), 'utf8'));

test('hooks are inert for sessions without a Continuity identity', () => {
  const { root, binDir } = prepareHookFixture();
  const env = hookEnv(root, binDir);
  const start = runHook(root, 'session-start.mjs', env, { session_id: claudeSession1, source: 'startup', cwd: root });
  assert.equal(start.status, 0);
  assert.equal(start.stdout, '');
  const end = runHook(root, 'session-end.mjs', env, { session_id: claudeSession1, reason: 'other', cwd: root });
  assert.equal(end.status, 0);
  assert.equal(existsSync(join(root, '.continuity', 'executor-sessions')), false);
});

test('non-startup SessionStart events are recorded but never re-drive the lifecycle', () => {
  const { root, binDir } = prepareHookFixture();
  const env = hookEnv(root, binDir, {
    CONTINUITY_ACTION: 'start',
    CONTINUITY_RUN_ID: runId,
    CONTINUITY_SESSION_ID: session1,
    CONTINUITY_WORKING_SET_ID: workingSetId,
  });
  const result = runHook(root, 'session-start.mjs', env, { session_id: claudeSession1, source: 'compact', cwd: root });
  assert.equal(result.status, 0);
  assert.equal(existsSync(join(root, '.continuity', 'executor-sessions', `${session1}-start.json`)), false);
  assert.equal(existsSync(join(root, 'continuity', 'artifacts', 'sessions', `${session1}.json`)), false);
  const events = readFileSync(join(root, '.continuity', 'executor-sessions', `${session1}.ndjson`), 'utf8').trim().split('\n');
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0]).startup_source, 'compact');
});

test('two hook-driven sessions produce provenance that passes every VS-001A criterion', () => {
  const { root, binDir } = prepareHookFixture();
  selectWork(root, { workId, workingSetId });

  // --- Session 1: genuine startup drives the Continuity start command.
  const env1 = hookEnv(root, binDir, {
    CONTINUITY_ACTION: 'start',
    CONTINUITY_RUN_ID: runId,
    CONTINUITY_SESSION_ID: session1,
    CONTINUITY_WORKING_SET_ID: workingSetId,
  });
  const start1 = runHook(root, 'session-start.mjs', env1, {
    session_id: claudeSession1,
    source: 'startup',
    cwd: root,
    model: 'claude-fable-5',
    hook_event_name: 'SessionStart',
  });
  assert.equal(start1.status, 0, start1.stderr);
  const injected = JSON.parse(start1.stdout);
  assert.equal(injected.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(injected.hookSpecificOutput.additionalContext, /Continuity Claude Code Execution View/);
  assert.match(injected.hookSpecificOutput.additionalContext, new RegExp(runId));
  const record1 = readRecord(root, `${session1}-start.json`);
  assert.equal(record1.claude_code_version, '2.1.207 (Claude Code)');
  assert.equal(record1.execution_view.digest_match, true);

  // --- Session 1 work: keyed effect, verified Checkpoint, deliberate interrupt.
  const effect = recordFileEffect(root, { runId, sessionId: session1, key: effectKey, path: effectPath, content: effectContent });
  assert.equal(effect.deduplicated, false);
  checkpointRun(root, {
    runId,
    sessionId: session1,
    nextAction: 'Replay effect key vs001a-material-effect to prove deduplication, then validate and complete run-vs001a.',
  });
  interruptSession(root, { runId, sessionId: session1, reason: 'deliberate-first-session-end' });

  // Before the SessionEnd hook fires, criterion actual-first-session-end must fail.
  const premature = runValidator(root, 'actual-first-session-end');
  assert.equal(premature.status, 1);

  const end1 = runHook(root, 'session-end.mjs', env1, {
    session_id: claudeSession1,
    reason: 'prompt_input_exit',
    cwd: root,
    hook_event_name: 'SessionEnd',
  });
  assert.equal(end1.status, 0, end1.stderr);
  assert.equal(readRecord(root, `${session1}-end.json`).reason, 'prompt_input_exit');

  // --- Session 2: distinct genuine startup drives the Continuity resume command.
  const env2 = hookEnv(root, binDir, {
    CONTINUITY_ACTION: 'resume',
    CONTINUITY_RUN_ID: runId,
    CONTINUITY_SESSION_ID: session2,
  });
  const start2 = runHook(root, 'session-start.mjs', env2, {
    session_id: claudeSession2,
    source: 'startup',
    cwd: root,
    model: 'claude-fable-5',
    hook_event_name: 'SessionStart',
  });
  assert.equal(start2.status, 0, start2.stderr);
  const record2 = readRecord(root, `${session2}-start.json`);
  assert.equal(record2.continuity.action, 'resume');
  assert.match(record2.adapter_command.exact_next_action, /deduplication/);
  assert.match(JSON.parse(start2.stdout).hookSpecificOutput.additionalContext, new RegExp(session2));

  const replay = recordFileEffect(root, { runId, sessionId: session2, key: effectKey, path: effectPath, content: effectContent });
  assert.equal(replay.deduplicated, true);

  // --- Every VS-001A criterion passes, individually and as a whole.
  for (const criterion of [
    'actual-adapter-bootstrap',
    'actual-first-session-end',
    'actual-fresh-session-resume',
    'effect-deduplication-confirmation',
    null,
  ]) {
    const result = runValidator(root, criterion);
    assert.equal(result.status, 0, `${criterion ?? 'all'}: ${result.stderr}`);
  }

  // --- Tampering is detected: a transcript resume masquerading as Session 2.
  const record2Path = join(root, '.continuity', 'executor-sessions', `${session2}-start.json`);
  writeFileSync(record2Path, JSON.stringify({ ...record2, startup_source: 'resume' }, null, 2));
  const tampered = runValidator(root, 'actual-fresh-session-resume');
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /transcript resume|not a genuine fresh/);

  // --- Tampering is detected: Session 2 reusing Session 1's Claude Code process.
  writeFileSync(record2Path, JSON.stringify({ ...record2, claude_session_id: claudeSession1 }, null, 2));
  const samePid = runValidator(root, 'actual-fresh-session-resume');
  assert.equal(samePid.status, 1);
  assert.match(samePid.stderr, /not distinct|not a fresh process/);

  // --- A duplicate genuine startup for the same Continuity Session refuses to
  // re-run start, and the recorded conflict fails the bootstrap criterion.
  const duplicate = runHook(root, 'session-start.mjs', env1, { session_id: claudeSession2, source: 'startup', cwd: root });
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /already has a recorded startup/);
  const conflicted = runValidator(root, 'actual-adapter-bootstrap');
  assert.equal(conflicted.status, 1);
  assert.match(conflicted.stderr, /duplicate startup conflicts recorded/);
});
