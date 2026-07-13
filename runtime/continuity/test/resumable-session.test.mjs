import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import {
  completeRun,
  interruptSession,
  checkpointRun,
  recordFileEffect,
  recordLesson,
  resumeRun,
  selectWork,
  startRun,
  validateRun,
} from '../lib/workflow.mjs';
import { createFixture } from './test-fixture.mjs';

const workId = 'continuity-vs001-resumable-agent-work-session';
const workingSetId = `ws-${workId}`;

function prepare(root) {
  selectWork(root, { workId, workingSetId });
  startRun(root, { workingSetId, runId: 'run-vs001', sessionId: 'session-vs001-1' });
  recordFileEffect(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-1',
    key: 'vs001-material-effect',
    path: 'continuity/dogfood/vs001-effect.txt',
    content: 'VS-001 keyed effect completed exactly once.\n',
  });
  checkpointRun(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-1',
    nextAction: 'Resume in a fresh Session, verify the keyed effect is deduplicated, record learning, validate, and complete.',
  });
}

test('full bounded path resumes in a fresh Session without duplicate effects', () => {
  const root = createFixture();
  prepare(root);

  assert.throws(
    () => resumeRun(root, { runId: 'run-vs001', sessionId: 'session-conflict' }),
    (error) => error.code === 'LEASE_CONFLICT',
  );

  interruptSession(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-1',
    reason: 'simulated-unexpected-Claude-Code-session-termination',
  });

  const stalePath = join(root, 'runtime/continuity/stale-probe.txt');
  appendFileSync(stalePath, 'drift\n');
  assert.throws(
    () => resumeRun(root, { runId: 'run-vs001', sessionId: 'session-stale' }),
    (error) => error.code === 'STALE_RUN',
  );
  rmSync(stalePath);

  const resumed = resumeRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' });
  assert.match(resumed.exact_next_action, /fresh Session/);
  assert.equal(resumed.session.transcript_dependency, false);

  const marker = join(root, 'continuity/dogfood/vs001-effect.txt');
  const beforeMtime = statSync(marker).mtimeMs;
  const replay = recordFileEffect(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-2',
    key: 'vs001-material-effect',
    path: 'continuity/dogfood/vs001-effect.txt',
    content: 'VS-001 keyed effect completed exactly once.\n',
  });
  assert.equal(replay.deduplicated, true);
  assert.equal(statSync(marker).mtimeMs, beforeMtime);

  assert.throws(
    () => completeRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' }),
    (error) => error.code === 'COMPLETION_GATE_BLOCKED',
  );

  const safe = recordLesson(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-2',
    observation: 'Fresh-session resume is reliable only when the exact next action is checkpointed.',
    lesson: 'Keep exact-next-action validation as a mandatory checkpoint property.',
  });
  assert.equal(safe.lesson.status, 'candidate');
  assert.equal(safe.lesson.promotion.status, 'not_promoted');

  const unsafe = recordLesson(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-2',
    observation: 'One validation failure was observed.',
    lesson: 'Automatically mint a blocking Guard after any single validation failure.',
    unsafe: true,
  });
  assert.equal(unsafe.lesson.status, 'rejected');
  assert.equal(unsafe.lesson.promotion.target_changes.length, 0);

  const validation = validateRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' });
  assert.equal(validation.all_passed, true);
  assert.equal(validation.evidence_refs.length, 4);

  const completed = completeRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' });
  assert.equal(completed.run.status, 'completed');
  assert.equal(completed.work_item.status, 'completed');
  assert.equal(completed.working_set.status, 'completed');
  assert.equal(completed.backlog.status, 'shipped');

  const store = createStore(root);
  store.deleteDerivedIndex();
  assert.equal(store.readArtifact('runs', 'run-vs001').status, 'completed');
  const index = store.rebuildIndex();
  assert.equal(index.artifacts.runs.some((entry) => entry.id === 'run-vs001' && entry.status === 'completed'), true);

  const effects = store.readOperational('run-vs001', 'effects');
  assert.equal(effects.effects.filter((effect) => effect.key === 'vs001-material-effect').length, 1);
});

test('failed validation blocks completion and produces no passing Evidence for that criterion', () => {
  const root = createFixture();
  prepare(root);
  interruptSession(root, { runId: 'run-vs001', sessionId: 'session-vs001-1' });
  resumeRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' });
  recordLesson(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-2',
    observation: 'candidate',
    lesson: 'candidate',
  });
  recordLesson(root, {
    runId: 'run-vs001',
    sessionId: 'session-vs001-2',
    observation: 'unsafe',
    lesson: 'unsafe',
    unsafe: true,
  });
  writeFileSync(join(root, 'continuity/dogfood/vs001-effect.txt'), 'corrupted content\n');
  const validation = validateRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' });
  assert.equal(validation.all_passed, false);
  assert.equal(validation.validation_results.some((result) => result.status === 'failed'), true);
  assert.throws(
    () => completeRun(root, { runId: 'run-vs001', sessionId: 'session-vs001-2' }),
    (error) => error.code === 'COMPLETION_GATE_BLOCKED',
  );
});
