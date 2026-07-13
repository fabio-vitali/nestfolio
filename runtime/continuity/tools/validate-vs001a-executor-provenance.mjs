#!/usr/bin/env node
// VS-001A executor-provenance validator.
//
// Proves, from repository-local records only, that the Run was driven by two
// genuine Claude Code Sessions: hook-recorded startup/end provenance under
// .continuity/executor-sessions/ cross-checked against canonical Continuity
// artifacts and the operational effect/audit state.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]]);
  return pairs;
}, []));
const runId = args['run-id'];
if (!runId) throw new Error('--run-id is required');
const criterion = args.criterion ?? null;
const session1 = args['session-1'] ?? 'session-vs001a-1';
const session2 = args['session-2'] ?? 'session-vs001a-2';
const effectKey = args['effect-key'] ?? 'vs001a-material-effect';

const root = process.cwd();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readArtifact = (kind, id) => JSON.parse(readFileSync(join(root, 'continuity', 'artifacts', kind, `${id}.json`), 'utf8'));
const readOperational = (name) => JSON.parse(readFileSync(join(root, '.continuity', 'runs', runId, `${name}.json`), 'utf8'));
const executorDir = join(root, '.continuity', 'executor-sessions');
const readRecord = (sessionId, suffix) => JSON.parse(readFileSync(join(executorDir, `${sessionId}-${suffix}.json`), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function readSessionEvents(sessionId) {
  const path = join(executorDir, `${sessionId}.ndjson`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function assertStartRecord(check, record, sessionId, run) {
  check(record.hook_event_name === 'SessionStart', `${sessionId}: start record is not a SessionStart record`);
  check(UUID_RE.test(record.claude_session_id ?? ''), `${sessionId}: claude_session_id is not a real Claude Code session id`);
  check(record.startup_source === 'startup', `${sessionId}: startup source is '${record.startup_source}', not a genuine fresh 'startup'`);
  check(typeof record.claude_code_version === 'string' && record.claude_code_version.length > 0, `${sessionId}: Claude Code version was not recorded`);
  check('model' in record, `${sessionId}: model was not recorded`);
  check(typeof record.cwd === 'string' && record.cwd.length > 0, `${sessionId}: cwd was not recorded`);
  check(isIso(record.timestamp), `${sessionId}: timestamp was not recorded`);
  const identity = run.repository_fingerprint_at_start.identity;
  check(record.git_revision?.head === identity.head, `${sessionId}: recorded Git revision does not match the Run's repository identity`);
  if (identity.mode === 'git') {
    check(/^[0-9a-f]{40}$/.test(record.git_revision?.head ?? ''), `${sessionId}: Git revision is not a full 40-hex commit`);
  }
  check(record.transcript_contents_inspected === false, `${sessionId}: hook did not attest transcript non-inspection`);
  const conflicts = existsSync(executorDir)
    ? readdirSync(executorDir).filter((name) => name.startsWith(`${sessionId}-start-conflict`))
    : [];
  check(conflicts.length === 0, `${sessionId}: duplicate startup conflicts recorded: ${conflicts.join(', ')}`);
}

function assertExecutionView(check, record, sessionId, run, expectedAction) {
  check(record.continuity?.action === expectedAction, `${sessionId}: hook ran '${record.continuity?.action}', expected '${expectedAction}'`);
  check(record.continuity?.run_id === runId && record.continuity?.session_id === sessionId, `${sessionId}: hook record carries the wrong Continuity identity`);
  check(record.adapter_command?.ok === true, `${sessionId}: adapter ${expectedAction} command did not succeed`);
  check(record.context_injected === true, `${sessionId}: execution view was not injected into Claude Code context`);
  const expectedPath = `.continuity/derived/execution-views/${runId}-${sessionId}.md`;
  check(record.execution_view?.path === expectedPath, `${sessionId}: execution view path is not the adapter-produced view`);
  check(record.execution_view?.digest_match === true, `${sessionId}: hook-recomputed view digest did not match the adapter digest`);
  const ref = (run.execution_view_refs ?? []).find((entry) => entry.session_id === sessionId);
  check(ref && ref.sha256 === record.execution_view?.sha256, `${sessionId}: recorded view digest does not match the Run's execution_view_refs`);
  const viewFile = join(root, expectedPath);
  check(existsSync(viewFile) && sha256(readFileSync(viewFile)) === record.execution_view?.sha256, `${sessionId}: on-disk execution view is missing or diverged from the recorded digest`);
}

const CHECKS = {
  'session-1-genuine-startup': (check) => {
    const run = readArtifact('runs', runId);
    assertStartRecord(check, readRecord(session1, 'start'), session1, run);
  },
  'session-1-received-start-view': (check) => {
    const run = readArtifact('runs', runId);
    assertExecutionView(check, readRecord(session1, 'start'), session1, run, 'start');
  },
  'session-1-ended-after-checkpoint-and-handoff': (check) => {
    const run = readArtifact('runs', runId);
    const start = readRecord(session1, 'start');
    const end = readRecord(session1, 'end');
    check(end.hook_event_name === 'SessionEnd', `${session1}: end record is not a SessionEnd record`);
    check(end.claude_session_id === start.claude_session_id, `${session1}: end record belongs to a different Claude Code session`);
    check(typeof end.reason === 'string' && end.reason.length > 0, `${session1}: termination reason was not recorded`);
    check(isIso(end.timestamp), `${session1}: end timestamp was not recorded`);
    const canonical = readArtifact('sessions', session1);
    check(canonical.status === 'interrupted', `${session1}: canonical Session is '${canonical.status}', expected deliberate 'interrupted'`);
    const checkpoint = run.checkpoint_refs
      .map((ref) => readArtifact('checkpoints', ref.id))
      .find((cp) => cp.session_id === session1 && cp.status === 'verified' && !cp.final);
    check(Boolean(checkpoint), `${session1}: no verified intermediate Checkpoint captured by Session 1`);
    const handoff = readArtifact('handoffs', `${runId}-${session1}`);
    check(handoff.status === 'published' && handoff.transcript_dependency === false, `${session1}: no published transcript-independent Handoff`);
    if (checkpoint) {
      check(handoff.checkpoint_ref?.id === checkpoint.id, `${session1}: Handoff does not reference Session 1's verified Checkpoint`);
      check(end.timestamp >= checkpoint.captured_at, `${session1}: Claude Code session ended before the verified Checkpoint`);
    }
    check(end.timestamp >= handoff.updated_at, `${session1}: Claude Code session ended before the Handoff was published`);
  },
  'session-2-distinct-genuine-startup': (check) => {
    const run = readArtifact('runs', runId);
    const r1 = readRecord(session1, 'start');
    const r2 = readRecord(session2, 'start');
    assertStartRecord(check, r2, session2, run);
    check(r2.claude_session_id !== r1.claude_session_id, `${session2}: Claude Code session id is not distinct from Session 1's`);
    check(r2.timestamp >= r1.timestamp, `${session2}: started before Session 1`);
  },
  'session-2-resumed-repository-state': (check) => {
    const run = readArtifact('runs', runId);
    const r1 = readRecord(session1, 'start');
    const r2 = readRecord(session2, 'start');
    assertExecutionView(check, r2, session2, run, 'resume');
    check(typeof r2.adapter_command?.exact_next_action === 'string' && r2.adapter_command.exact_next_action.length > 0, `${session2}: resume did not surface the checkpointed exact next action`);
    const canonical = readArtifact('sessions', session2);
    check(Boolean(canonical.resumed_from_checkpoint_ref?.id), `${session2}: canonical Session did not resume from a verified Checkpoint`);
    check(canonical.prior_session_ref === session1, `${session2}: canonical Session does not chain to Session 1`);
    const head = readOperational('head');
    check(head.last_resume_validation?.passed === true, `${session2}: resume freshness validation did not pass`);
    check(r2.git_revision?.head === r1.git_revision?.head, `${session2}: repository revision diverged between the two Sessions`);
  },
  'session-2-no-transcript-resume': (check) => {
    const r1 = readRecord(session1, 'start');
    const r2 = readRecord(session2, 'start');
    check(r2.startup_source === 'startup', `${session2}: Claude Code source is '${r2.startup_source}' — a transcript resume, not a fresh startup`);
    check(r2.claude_session_id !== r1.claude_session_id, `${session2}: same Claude Code session id as Session 1 — not a fresh process`);
    const resumeEvents = readSessionEvents(session2).filter((event) => event.hook_event_name === 'SessionStart' && event.startup_source === 'resume');
    check(resumeEvents.length === 0, `${session2}: a Claude Code transcript resume event was recorded`);
    check(r2.transcript_contents_inspected === false, `${session2}: hook did not attest transcript non-inspection`);
    const canonical = readArtifact('sessions', session2);
    check(canonical.transcript_dependency === false, `${session2}: canonical Session declares a transcript dependency`);
  },
  'effect-key-deduplicated': (check) => {
    const effects = readOperational('effects');
    const completed = effects.effects.filter((effect) => effect.key === effectKey && effect.status === 'completed');
    check(completed.length === 1, `expected exactly one completed effect for ${effectKey}, found ${completed.length}`);
    check(completed[0]?.session_id === session1, `effect ${effectKey} was not completed by Session 1`);
    const auditPath = join(root, '.continuity', 'audit.ndjson');
    const dedupEntries = readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      .filter((entry) => entry.command === 'continuity effect'
        && entry.run_id === runId
        && entry.session_id === session2
        && entry.target === `effect/${effectKey}`
        && entry.result === 'deduplicated');
    check(dedupEntries.length >= 1, `no deduplicated replay of ${effectKey} by ${session2} found in the audit log`);
    const effectFile = join(root, completed[0]?.path ?? '');
    check(completed[0] && existsSync(effectFile) && sha256(readFileSync(effectFile)) === completed[0].after_sha256, `effect ${effectKey} is no longer observable with its recorded digest`);
  },
};

const CRITERIA = {
  'actual-adapter-bootstrap': ['session-1-genuine-startup', 'session-1-received-start-view'],
  'actual-first-session-end': ['session-1-ended-after-checkpoint-and-handoff'],
  'actual-fresh-session-resume': ['session-2-distinct-genuine-startup', 'session-2-resumed-repository-state', 'session-2-no-transcript-resume'],
  'effect-deduplication-confirmation': ['effect-key-deduplicated'],
};

if (criterion && !CRITERIA[criterion]) {
  console.error(`Unknown criterion: ${criterion}. Known: ${Object.keys(CRITERIA).join(', ')}`);
  process.exit(1);
}
const checkIds = criterion ? CRITERIA[criterion] : Object.keys(CHECKS);
const results = [];
for (const id of checkIds) {
  const failures = [];
  const check = (passed, message) => {
    if (!passed) failures.push(message);
  };
  try {
    CHECKS[id](check);
  } catch (error) {
    failures.push(`${id}: ${error.message}`);
  }
  results.push({ id, passed: failures.length === 0, failures });
}

const failed = results.filter((result) => !result.passed);
if (failed.length) {
  console.error(failed.flatMap((result) => result.failures.length ? result.failures : [`${result.id} failed`]).join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ run_id: runId, criterion: criterion ?? 'all', checks: results.map((result) => result.id) }, null, 2));
