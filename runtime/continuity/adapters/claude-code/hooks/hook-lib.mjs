import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIdentity, isoNow, writeJsonAtomic } from '../../../lib/utils.mjs';

// Executor-provenance records live in the operational store, outside every
// Scope fingerprint path, so hook writes can never make a Run stale.
export const EXECUTOR_SESSIONS_DIR = '.continuity/executor-sessions';

export function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

// Hooks are inert unless the session was launched with an explicit Continuity
// identity; ordinary Claude Code sessions in this repository are untouched.
export function continuityEnv(env = process.env) {
  const action = env.CONTINUITY_ACTION;
  const runId = env.CONTINUITY_RUN_ID;
  const sessionId = env.CONTINUITY_SESSION_ID;
  if (!action || !runId || !sessionId) return null;
  return {
    action,
    run_id: runId,
    session_id: sessionId,
    working_set_id: env.CONTINUITY_WORKING_SET_ID ?? null,
  };
}

export function resolveRoot(input, env = process.env) {
  return env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
}

export function claudeCodeVersion() {
  try {
    return execFileSync('claude', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function gitRevision(root) {
  const identity = gitIdentity(root);
  return { mode: identity.mode, head: identity.head, branch: identity.branch };
}

export function sessionRecordPath(root, continuitySessionId, suffix) {
  return join(root, EXECUTOR_SESSIONS_DIR, `${continuitySessionId}-${suffix}.json`);
}

export function appendSessionEvent(root, continuitySessionId, event) {
  const dir = join(root, EXECUTOR_SESSIONS_DIR);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${continuitySessionId}.ndjson`), `${JSON.stringify({ ...event, at: isoNow() })}\n`);
}

export function writeSessionRecord(root, continuitySessionId, suffix, record) {
  const path = sessionRecordPath(root, continuitySessionId, suffix);
  writeJsonAtomic(path, record);
  return path;
}
