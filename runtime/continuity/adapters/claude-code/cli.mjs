#!/usr/bin/env node
import { resolve } from 'node:path';
import { asErrorPayload } from '../../lib/errors.mjs';
import { parseArgs, requireArgs } from '../../lib/utils.mjs';
import {
  checkpointRun,
  completeRun,
  inspectRun,
  interruptSession,
  rebuildDerivedIndex,
  recordFileEffect,
  recordLesson,
  resumeRun,
  selectWork,
  startRun,
  validateRun,
} from '../../lib/workflow.mjs';

const { command, args } = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? process.cwd());

async function main() {
  switch (command) {
    case 'select':
      requireArgs(args, ['work_id']);
      return selectWork(root, { workId: args.work_id, workingSetId: args.working_set_id });
    case 'start':
      requireArgs(args, ['working_set_id']);
      return startRun(root, { workingSetId: args.working_set_id, sessionId: args.session_id, runId: args.run_id });
    case 'effect':
      requireArgs(args, ['run_id', 'session_id', 'key', 'path', 'content']);
      return recordFileEffect(root, {
        runId: args.run_id,
        sessionId: args.session_id,
        key: args.key,
        path: args.path,
        content: args.content,
      });
    case 'checkpoint':
      requireArgs(args, ['run_id', 'session_id', 'next_action']);
      return checkpointRun(root, {
        runId: args.run_id,
        sessionId: args.session_id,
        nextAction: args.next_action,
        final: Boolean(args.final),
      });
    case 'interrupt':
      requireArgs(args, ['run_id', 'session_id']);
      return interruptSession(root, { runId: args.run_id, sessionId: args.session_id, reason: args.reason });
    case 'resume':
      requireArgs(args, ['run_id', 'session_id']);
      return resumeRun(root, { runId: args.run_id, sessionId: args.session_id, readOnly: Boolean(args.read_only) });
    case 'validate':
      requireArgs(args, ['run_id', 'session_id']);
      return validateRun(root, { runId: args.run_id, sessionId: args.session_id });
    case 'lesson':
      requireArgs(args, ['run_id', 'session_id', 'observation', 'lesson']);
      return recordLesson(root, {
        runId: args.run_id,
        sessionId: args.session_id,
        observation: args.observation,
        lesson: args.lesson,
        unsafe: Boolean(args.unsafe),
      });
    case 'complete':
      requireArgs(args, ['run_id', 'session_id']);
      return completeRun(root, { runId: args.run_id, sessionId: args.session_id });
    case 'inspect':
      requireArgs(args, ['run_id']);
      return inspectRun(root, { runId: args.run_id });
    case 'rebuild-index':
      return rebuildDerivedIndex(root);
    default:
      throw new Error(`Unknown command: ${command ?? '<missing>'}`);
  }
}

try {
  const result = await main();
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(asErrorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
