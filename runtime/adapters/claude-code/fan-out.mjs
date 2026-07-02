// runtime/adapters/claude-code/fan-out.mjs — binds fanOut to parallel subagents. Returns SUMMARIES
// ONLY — the sub-agent transcript is discarded at the boundary (the Tier-2 scar; a transcript is a
// seam violation). fanOut is for BREADTH; the decision-bearing worker runs under execute.
export function makeFanOut({ runTask } = {}) {
  const run = runTask ?? (async (t) => ({ taskId: t.id, status: 'done', summary: `ran ${t.id}` }));
  return async function fanOut(tasks) {
    const results = await Promise.all(tasks.map((t) => run(t)));
    return results.map((r) => ({ taskId: r.taskId, status: r.status, summary: r.summary }));   // strip the rest
  };
}
