---
id: handlers-dir-leak-at-repo-root
status: parking
type: bug
notes: "Empty handlers/ dir leaks at repo root from some CDK synth/test path (egress.test.ts uses os.tmpdir() correctly; the leaker is unknown). Gitignored 2026-05-18; investigate when /backlog-next or CDK tests are next touched."
references:
  - libs/cdk-constructs/src/core/egress.ts
  - libs/cdk-constructs/src/core/ingress.ts
  - libs/cdk-constructs/test/core/egress.test.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Empty `handlers/` dir leaks at repo root

Surfaced 2026-05-18 during the root-clutter investigation that produced [[backlog-next-closing-phase-friction]] § A.2. While sweeping the 302 hex socket-dir leaks, an additional empty `handlers/` dir was found at repo root with mtime `2026-05-18 13:18` — earlier in the same day's `agent-pipeline-backlog-trap` ship cycle.

## Evidence

- `libs/cdk-constructs/src/egress.ts:55` defaults the bundling entry to `join(serviceDir, 'handlers', 'event-publisher.ts')`.
- `libs/cdk-constructs/src/ingress.ts:56` defaults to `join(serviceDir, 'handlers', 'event-listener.ts')`.
- `libs/cdk-constructs/test/core/egress.test.ts:13` correctly sets `handlersDir = path.join(os.tmpdir(), 'handlers')` and `mkdirSync(handlersDir, ...)`. So the egress unit test is NOT the leaker.
- Some OTHER code path is invoking `Egress`/`Ingress` (or a downstream `NodejsFunction`-style bundler) with `serviceDir` defaulting to `process.cwd()` and triggering `mkdir handlers/` at repo root.
- Repro window: anything that runs CDK synth or `aws-cdk-lib`'s `NodejsFunction` bundling logic in a process whose cwd is the repo root.

## Hypothesis

Most likely culprits, in order:

1. A test/script under `tools/`, `scripts/`, or `infrastructure/` invokes `ServiceStack` without passing `serviceDir` (then defaults to `process.cwd()`).
2. A `cdk synth` run for documentation generation (`generate-c4-diagrams` skill, `audit-*` skills) instantiates stacks against repo-root cwd and falls through to the default path.
3. A jest-run integration test (NOT the egress unit test) constructs a real `Egress`/`Ingress` without overriding `entry` and without overriding `serviceDir`.

## Cheapest next step (when promoted)

```
grep -rn "new Egress\|new Ingress" --include='*.ts' . | grep -v 'test/\|\.spec\.\|node_modules'
```

…and for each call site, check whether `serviceDir` is passed. If not, find the parent `ServiceStack` and verify its `serviceDir` resolves to a writable temp area, not cwd.

Alternative: make `Egress`/`Ingress` validate that `entry` exists at construct-time (not at synth-time) and throw a useful error rather than silently `mkdir`-ing the dir.

## Why parking

- Cosmetic only — empty dir, gitignored now (`.gitignore` entry added 2026-05-18 alongside the A.2 fix).
- No correctness impact: the actual handler files used at deploy-time are under each service's `src/handlers/` (verified by inspection).
- Investigation cost is bounded (single grep + a couple of construct call-sites) but not justified until the next time `Egress`/`Ingress` API or CDK test harness is touched.

Promote when: `cdk-constructs` is next refactored, OR if `handlers/` reappears after a clean checkout (would indicate the leaker is a CI step, which would warrant priority).

## Related

- [[backlog-next-closing-phase-friction]] § A.2 — surfaced during the same root-clutter sweep.
