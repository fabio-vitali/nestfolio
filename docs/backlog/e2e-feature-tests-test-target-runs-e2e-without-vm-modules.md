---
id: e2e-feature-tests-test-target-runs-e2e-without-vm-modules
status: queued
rank: 3
type: bug
notes: "`nx run-many -t test` picks up apps/e2e-feature-tests:test which runs all e2e files via @nx/jest:jest without --experimental-vm-modules, so every dynamic import fails."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `e2e-feature-tests:test` target is the wrong shape — fails the whole-workspace `test` run

**Failing target:** `pnpm nx run-many -t test` → `e2e-feature-tests:test`.

`apps/e2e-feature-tests/project.json` defines two targets that share the same Jest config:

```jsonc
"test-e2e-features": { /* nx:run-commands, sets NODE_OPTIONS=--experimental-vm-modules */ }
"test":              { /* @nx/jest:jest, no NODE_OPTIONS — testPathPattern: "/test/" */ }
```

The `test` target has no env override, so `nx run-many -t test` collects every `*.e2e.test.ts` under `apps/e2e-feature-tests/src/**` (the substring `test` matches the filename) and runs them through `@nx/jest:jest`. Every file then crashes on the first dynamic SSM/AWS import:

```
TypeError: A dynamic import callback was invoked without --experimental-vm-modules
  at apps/e2e-feature-tests/src/.../ssm.ts:27
```

This is not a single failing test — it's the target running against the wrong file set.

**Resolution path (no patch / no workaround):** decide what `nx run-many -t test` should mean for this app. Two clean options:

1. **Drop the `test` target.** This app only owns e2e scenarios; `test-e2e-features` is the single entry point. `nx run-many -t test` then naturally skips it.
2. **Make `test` a no-op explicitly.** Use `nx:noop` (or set `passWithNoTests` against a pattern that matches nothing) — useful only if some workspace-wide tooling expects every project to expose `test`.

The current shape — same Jest config, same files, missing env — is the worst of both.

Surfaced 2026-05-11 during full-system test sweep.
