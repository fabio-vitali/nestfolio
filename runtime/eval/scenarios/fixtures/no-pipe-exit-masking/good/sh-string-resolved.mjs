// GOOD: resolve-then-run — the list is resolved via a captured invocation whose exit code is checked
// hard, then the consumer runs directly. No pipeline, nothing to mask.
const list = shOut(`node tools/affected-projects.mjs --base=origin/main --with-target=test-integration`);
if (list.status !== 0) throw new Error('resolver failed');
const projects = (list.stdout ?? '').split('\n').filter(Boolean);
const t = projects.length ? sh(`pnpm nx run-many -t test-integration -p ${projects.join(',')}`) : { status: 0 };
export default t;
