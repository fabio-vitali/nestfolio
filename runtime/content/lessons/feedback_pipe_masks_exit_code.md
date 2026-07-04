---
name: pipe-masks-exit-code
description: A backgrounded/piped gate command's reported exit is the LAST pipe
  stage's, not the real command's — capture the true exit or you'll trust a
  false green.
metadata:
  node_type: memory
  type: feedback
  originSessionId: dc7d0812-7617-44fb-963b-c2f1d382dc20
mints:
  - check: no-pipe-exit-masking
    ratified: 2026-07-04T17:21:00.389Z
    status: active
---

When running a gate/validation command (tests, lint, build) through a pipe — e.g. `cmd | tee log | tail` — the shell's (and the background-task wrapper's) exit code is the LAST stage's (`tail`, always 0), NOT `cmd`'s. A failing `nx run-many -t test-integration ... | tee | tail` reported "exit code 0" while nx had actually FAILED with many test failures — I nearly proceeded to ship on that false green.

**Why:** false "exit 0" on a real failure is the most dangerous validation outcome — it silently passes a broken gate (sibling of [[feedback-worktree-symlink-masks-test-failures]] and [[feedback-flake-means-broken]]).

**How to apply:** for any gating command, capture the REAL exit code: `cmd > log 2>&1; echo "RC=$?" >> log` (then READ the RC from the log — don't trust the background-task notification's exit), or `set -o pipefail`, or check `${PIPESTATUS[0]}` IN the same shell (note: the harness's "Shell cwd was reset" wrapper can also swallow a trailing `${PIPESTATUS[0]}` echo, so prefer redirect-then-grep). Always confirm the gate's own summary line ("Successfully ran" / "N failed") in the output, never the wrapper's exit alone.
