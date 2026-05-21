---
id: jest-worker-scratch-leak-on-force-exit
status: active
type: bug
rank: 2
notes: "Every test run leaks scratch dirs in repo root (jest_dx, empty 20-char-hex dirs, cdk.out<random>). Root cause: nx.json forceExit:true kills workers before cleanup. Third recurrence."
references: []
out_of_scope:
  - "Fix candidate (5): orphan-process pruning / nx daemon affinity check — addresses the independent 40-day-zombie angle, not forceExit."
  - "Fix candidate (4): postinstall cleanup script — defensive, does not address the source."
  - "nx-native-file-cache-*/ and node-compile-cache/ accumulation — Nx daemon / Node internals, unrelated to forceExit cleanup-skipping."
  - "Root-causing the 2026-04-08 zombie PID 48621 origin."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Jest worker scratch leak — `forceExit: true` skips cleanup

Surfaced 2026-05-15 (third recurrence). Each test run leaks ~5-15 directories in the repo root:

| Pattern | Source | Why leaked |
|---|---|---|
| `jest_dx/` | Jest haste-map cache (`jest-haste-map@30.2.0:2406`) | cacheDirectory falls back to a cwd-relative path under some condition (TBD — `os.tmpdir()` should be the default but isn't applied) |
| `cdk.out<8-rand>/` | `new App()` in `*.stack.test.ts` files | CDK auto-suffixes the outdir to avoid parallel-worker collisions; no explicit outdir set in tests |
| `[0-9a-f]{20}/` (empty) | `mkdtempSync` in a jest-internal worker | Worker killed before `finally`/cleanup runs |
| `nx-native-file-cache-<hex>/` | Nx native daemon cache | Each Nx invocation creates a new one; never garbage-collected |
| `node-compile-cache/` | Node.js experimental compile cache | Created at process start, never cleaned |

## Smoking gun

`nx.json` target defaults:

```json
"test": {
  ...
  "options": {
    "passWithNoTests": true,
    "forceExit": true
  }
}
```

`forceExit: true` calls `process.exit()` before pending timers / handles / `finally` blocks complete. Jest workers spawn `mkdtempSync` dirs and rely on cleanup in `afterAll` or process-exit handlers — `forceExit` skips them all.

## Stopgap (shipped 2026-05-15)

`.gitignore` updated to cover `cdk.out*/` (no-dot wildcard) + `jest_dx/`. Manual cleanup needed for `[0-9a-f]{20}/` empty dirs and `nx-native-file-cache-*/` accumulation.

## 2026-05-18 follow-up: orphan-process angle (independent of `forceExit`)

During `agent-pipeline-backlog-trap-impl` ship, the leak recurred at a much higher rate than `forceExit` alone explains. Process inspection found a **40-day zombie** `nx run-many -t test-integration --parallel=4` (PID 48621, etime `40-13:07:22` as of 2026-05-18 14:01 local) continuously spawning Jest workers. Each spawn dumps `cdk.out<rand>/`, `tmp-<pid>-<rand>/`, and pollutes `pnpm-lock.yaml` with `tmp-NNN` `importers:` entries (because pnpm-workspace globs `services/**` + `libs/*` + `tools/*` + `apps/*` but NOT root-level `tmp-*` — yet pnpm DOES still index them when it scans cwd for an `add` operation).

Net effect: `/backlog-next` postflight's `tree-clean` gate failed in a loop — `rm -rf tmp-*` + `git restore pnpm-lock.yaml` only succeeded when timed to outrace the next worker spawn.

**New fix candidate (5):** add a `pnpm prepare` / `prebuild` script that prunes orphan `nx`/`jest` processes older than ~1h before `nx run-many` proceeds. Or: an nx daemon affinity check that refuses to start a new `nx run-many` while a same-target run is already in flight on this host. Neither addresses the underlying `forceExit` design issue — they just stop the leak compounding indefinitely when a test run is left dangling.

**Investigation pointer**: search shell history or `ps -A -o lstart,pid,command` for the 2026-04-08 09:00-ish window when PID 48621 started. The terminal that launched it probably crashed or was force-quit without cleaning up the child.

## Real fix candidates (when promoted)

1. **Remove `forceExit: true` from nx.json**, then `nx run-many --target=test` to verify nothing hangs. If hangs surface, find the offending unclosed-handle (likely a Lambda powertools logger flush, an AWS SDK client, or a node-fetch keep-alive socket) and fix at source.
2. **Explicit `outdir` on `new App({ outdir })`** in all `*.stack.test.ts` files — point to a stable `cdk.out/` per test, no random suffix needed.
3. **`cacheDirectory` in `jest.preset.js`** — point at `<rootDir>/.nx/cache/jest` or `/tmp/nestfolio-jest-cache`.
4. **`postinstall` cleanup script** that runs `rm -rf jest_dx cdk.out* [0-9a-f]*/ nx-native-file-cache-* node-compile-cache` before pnpm install — defensive but doesn't address the source.

Prefer (1) — root-cause fix. If hangs are intractable, fall back to (2)+(3).

## Promotion (2026-05-21)

Promoted from parking at a boundary review — QUEUED was empty after the
`e2e-fixture-agentcore-synchronous-coupling` ship and the user picked this item
directly (ranked behind [[backlog-next-closing-phase-friction]], which makes the
postflight *gate* robust; this item fixes the *leak* at its source). Investigation
remains open-ended: removing `forceExit: true` may surface hanging unclosed
handles that scoping must run down.

## Related

- nx.json `targetDefaults.test`
- jest.preset.js
- All `services/*/src/service.stack.ts` test files (consumers of `new App()`)
