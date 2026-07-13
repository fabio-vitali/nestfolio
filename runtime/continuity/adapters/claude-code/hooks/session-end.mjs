#!/usr/bin/env node
// Claude Code SessionEnd hook — VS-001A executor provenance.
//
// Records the real Claude Code session id, the termination reason, and the
// timestamp for Continuity-launched sessions. It never reads the transcript.
import { isoNow } from '../../../lib/utils.mjs';
import {
  appendSessionEvent,
  continuityEnv,
  readHookInput,
  resolveRoot,
  writeSessionRecord,
} from './hook-lib.mjs';

function main() {
  const input = readHookInput();
  const continuity = continuityEnv();
  if (!continuity) return 0;

  const root = resolveRoot(input);
  const record = {
    schema_version: 1,
    hook_event_name: 'SessionEnd',
    claude_session_id: input.session_id ?? null,
    reason: input.reason ?? null,
    timestamp: isoNow(),
    continuity,
    transcript_contents_inspected: false,
  };
  appendSessionEvent(root, continuity.session_id, record);
  // Last write wins: the final SessionEnd is the real termination; every
  // intermediate event stays in the per-session ndjson stream.
  writeSessionRecord(root, continuity.session_id, 'end', record);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`SessionEnd continuity hook error: ${error?.message ?? error}\n`);
  process.exitCode = 0;
}
