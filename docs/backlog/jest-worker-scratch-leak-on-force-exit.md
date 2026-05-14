---
id: jest-worker-scratch-leak-on-force-exit
status: parking
type: bug
notes: "Every test run leaks scratch dirs in repo root (jest_dx, empty 20-char-hex dirs, cdk.out<random>). Root cause: nx.json forceExit:true kills workers before cleanup. Third recurrence."
references: []
out_of_scope: []
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

## Real fix candidates (when promoted)

1. **Remove `forceExit: true` from nx.json**, then `nx run-many --target=test` to verify nothing hangs. If hangs surface, find the offending unclosed-handle (likely a Lambda powertools logger flush, an AWS SDK client, or a node-fetch keep-alive socket) and fix at source.
2. **Explicit `outdir` on `new App({ outdir })`** in all `*.stack.test.ts` files — point to a stable `cdk.out/` per test, no random suffix needed.
3. **`cacheDirectory` in `jest.preset.js`** — point at `<rootDir>/.nx/cache/jest` or `/tmp/nestfolio-jest-cache`.
4. **`postinstall` cleanup script** that runs `rm -rf jest_dx cdk.out* [0-9a-f]*/ nx-native-file-cache-* node-compile-cache` before pnpm install — defensive but doesn't address the source.

Prefer (1) — root-cause fix. If hangs are intractable, fall back to (2)+(3).

## Why parking, not queued

- Not blocking any e2e or integration suite.
- `.gitignore` now hides the worst offenders from `git status`.
- Investigation is open-ended (need to identify which unclosed handle requires `forceExit`).

## Related

- nx.json `targetDefaults.test`
- jest.preset.js
- All `services/*/src/service.stack.ts` test files (consumers of `new App()`)
