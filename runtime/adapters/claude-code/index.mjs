// runtime/adapters/claude-code/index.mjs — assemble the Capabilities object for the Claude Code host.
import { makeJournal } from '../../engine/lib/journal.mjs';
import { makeAsk } from './ask.mjs';
import { makeFanOut } from './fan-out.mjs';
import { makeExecute } from './execute.mjs';
import { makeOnTrigger } from './on-trigger.mjs';
import { makeRunProcedure } from './run-procedure.mjs';
export function makeClaudeCodeCapabilities({ interactive, root, runner, runTask, procedures } = {}) {
  return {
    execute: makeExecute({ runner }),
    fanOut: makeFanOut({ runTask }),
    ask: makeAsk({ interactive }),
    onTrigger: makeOnTrigger({}),
    runProcedure: makeRunProcedure({ procedures }),
    journal: makeJournal(root ? { root } : {}),
  };
}
