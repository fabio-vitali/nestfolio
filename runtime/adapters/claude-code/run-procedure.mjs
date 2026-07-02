// runtime/adapters/claude-code/run-procedure.mjs — binds runProcedure to the Skill tool (injected map here).
export function makeRunProcedure({ procedures } = {}) {
  return async function runProcedure(name, args) {
    const proc = procedures?.[name];
    if (!proc) return { taskId: name, status: 'failed', summary: `unknown procedure: ${name}` };
    return await proc(args);
  };
}
