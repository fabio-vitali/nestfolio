#!/usr/bin/env node
// Claude Code SessionStart hook — VS-001A executor provenance.
//
// For sessions launched with CONTINUITY_ACTION=start|resume this hook records
// the real Claude Code session provenance, invokes the existing Continuity
// adapter command, and injects the adapter-produced execution view into the
// session context. It never reads the Claude Code transcript.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoNow, sha256 } from '../../../lib/utils.mjs';
import {
  appendSessionEvent,
  claudeCodeVersion,
  continuityEnv,
  gitRevision,
  readHookInput,
  resolveRoot,
  sessionRecordPath,
  writeSessionRecord,
} from './hook-lib.mjs';

const CLI_PATH = 'runtime/continuity/adapters/claude-code/cli.mjs';

function adapterArgs(continuity) {
  if (continuity.action === 'start') {
    if (!continuity.working_set_id) return { error: 'CONTINUITY_ACTION=start requires CONTINUITY_WORKING_SET_ID' };
    return {
      args: [
        CLI_PATH, 'start',
        '--working-set-id', continuity.working_set_id,
        '--run-id', continuity.run_id,
        '--session-id', continuity.session_id,
      ],
    };
  }
  if (continuity.action === 'resume') {
    return {
      args: [
        CLI_PATH, 'resume',
        '--run-id', continuity.run_id,
        '--session-id', continuity.session_id,
      ],
    };
  }
  return { error: `Unknown CONTINUITY_ACTION: ${continuity.action}` };
}

function main() {
  const input = readHookInput();
  const continuity = continuityEnv();
  if (!continuity) return 0;

  const root = resolveRoot(input);
  const record = {
    schema_version: 1,
    hook_event_name: 'SessionStart',
    claude_session_id: input.session_id ?? null,
    startup_source: input.source ?? null,
    model: input.model ?? null,
    cwd: input.cwd ?? null,
    timestamp: isoNow(),
    claude_code_version: claudeCodeVersion(),
    git_revision: gitRevision(root),
    continuity,
    transcript_contents_inspected: false,
  };
  appendSessionEvent(root, continuity.session_id, record);

  // Only a genuine fresh startup drives the Continuity lifecycle; in-session
  // re-fires (resume/clear/compact) are recorded above but never re-invoke it.
  if (input.source !== 'startup') return 0;

  if (existsSync(sessionRecordPath(root, continuity.session_id, 'start'))) {
    const suffix = `start-conflict-${isoNow().replaceAll(':', '').replaceAll('.', '')}`;
    writeSessionRecord(root, continuity.session_id, suffix, { ...record, conflict: 'duplicate-startup-for-continuity-session' });
    process.stderr.write(`Continuity session ${continuity.session_id} already has a recorded startup; refusing to re-run ${continuity.action}.\n`);
    return 2;
  }

  const invocation = adapterArgs(continuity);
  if (invocation.error) {
    writeSessionRecord(root, continuity.session_id, 'start', { ...record, adapter_command: { ok: false, error: invocation.error } });
    process.stderr.write(`${invocation.error}\n`);
    return 2;
  }

  const proc = spawnSync(process.execPath, [...invocation.args, '--root', root], { cwd: root, encoding: 'utf8' });
  let payload = null;
  try {
    payload = JSON.parse(proc.stdout);
  } catch {}
  if (proc.status !== 0 || !payload?.ok) {
    writeSessionRecord(root, continuity.session_id, 'start', {
      ...record,
      adapter_command: { action: continuity.action, ok: false, exit_code: proc.status, error: payload?.error ?? { message: (proc.stderr || proc.stdout || 'adapter command failed').slice(0, 2000) } },
    });
    process.stderr.write(`Continuity ${continuity.action} failed for ${continuity.run_id}/${continuity.session_id}: ${payload?.error?.code ?? proc.status}\n`);
    return 2;
  }

  const view = payload.result.execution_view;
  const viewContent = readFileSync(join(root, view.path), 'utf8');
  const recomputed = sha256(viewContent);
  writeSessionRecord(root, continuity.session_id, 'start', {
    ...record,
    adapter_command: { action: continuity.action, ok: true, exact_next_action: payload.result.exact_next_action ?? null },
    execution_view: { path: view.path, sha256: view.sha256, recomputed_sha256: recomputed, digest_match: recomputed === view.sha256 },
    context_injected: true,
  });
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Continuity ${continuity.action} succeeded for Run ${continuity.run_id}, Session ${continuity.session_id}. Adapter-produced execution view (${view.path}, sha256 ${view.sha256}):\n\n${viewContent}`,
    },
  }));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`SessionStart continuity hook error: ${error?.message ?? error}\n`);
  process.exitCode = 2;
}
