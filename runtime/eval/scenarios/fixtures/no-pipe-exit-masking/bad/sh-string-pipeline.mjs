// BAD: a JS-composed gate command embedding a shell pipeline — /bin/sh does not propagate stage
// failures, so a resolver crash upstream is masked by the last stage's exit 0 (the deploy-gate-runner
// false-green class). (Do not name the guard keywords here — the predicate's escape is text-based.)
const t = sh(`node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, - | xargs -r -I{} pnpm nx run-many -t test-integration -p {}`);
export default t;
