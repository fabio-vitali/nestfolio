// runtime/adapters/claude-code/execute.mjs — binds execute to the inline, visible worker.
// Re-freeze 2026-07-03: with NO runner this adapter PARKS the task (paused + a Task-shaped decision
// keyed `execute:<task.id>` — the WORKER spine's step key by construction; the EPIC spine parks the
// same decision under step key `member.<id>`, so the drive adapters translate a decision-id fulfil to
// the pending step's key via fulfil-key.mjs) instead of claiming done. The session performs the work
// and fulfils the park; replay then short-circuits with the real TaskResult.
export function makeExecute({ runner } = {}) {
  return async function execute(task) {
    if (runner) return await runner(task);
    return { taskId: task.id, status: 'paused', summary: `parked: ${task.id} awaits a session executor`,
      decision: { id: `execute:${task.id}`, question: `Perform task ${task.id}: ${task.prompt}`,
        options: [{ label: 'Fulfil with TaskResult', value: 'fulfil', recommended: true }],
        context: JSON.stringify({ scope: task.scope }) } };
  };
}
