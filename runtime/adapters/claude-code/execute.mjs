// runtime/adapters/claude-code/execute.mjs — binds execute to the inline, visible worker.
export function makeExecute({ runner } = {}) {
  const run = runner ?? (async (t) => ({ taskId: t.id, status: 'done', summary: `executed ${t.id}` }));
  return async function execute(task) { return await run(task); };
}
