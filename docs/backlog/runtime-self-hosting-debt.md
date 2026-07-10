---
id: runtime-self-hosting-debt
status: active
type: epic
notes: "Theme epic (minted 2026-07-10 by backlog-themes from runtime-operationalization-leftovers). Root cause: the runtime/ engine does not yet hold its own code/registry to the standards it enforces on the rest of the repo — it is an untyped .mjs island, has a ring-2 project-binding escape, and its registry lacks the self-safety meta-checks it would demand elsewhere. 4 core members."
done_when: "Each member resolved or dropped: the runtime engine holds itself to the bar it enforces — its logic is type-checked (or the .mjs/.ts hybrid consciously kept with a recorded rationale), its ring-2 seam binds host primitives only (KNOWN_ESCAPES → 0), and the registry gains the two self-safety meta-checks (every active [invariant] check returns 0 on a clean tree; every test file is covered by an nx test target). All members shipped or dropped."
scope: "Internal-quality debt in runtime/ where the engine does not yet apply an invariant it enforces on the rest of the repo: (a) runtime-typescript-port — 90 untyped .mjs logic files get no compile-time check (the poster-child ruleIdMatchesFilename arity crash); (b) from-deploy-gate-runner-ring2-project-bindings — ring-2 deploy-gate-runner imports two project-specific modules (KNOWN_ESCAPES-allowlisted), relocate to ring 3 / inject and shrink the allowlist to zero; (c) runtime-invariant-safety-metacheck — mechanize 'every active [invariant] check returns 0 on a clean tree' (a dirty invariant bricks every commit); (d) nx-orphan-test-file-metacheck — mechanize 'every *.test.mjs/.test.ts is covered by an nx test target' (an unowned test file silently never runs)."
out_of_scope:
  - "Gate-baseline / diff-aware attribution semantics (runtime-gate-baseline-debt — a distinct root cause: what a gate attributes to an item, not whether the runtime's own code meets its bar)."
  - "Judgment/audit-tier feature maturation (runtime-judgment-tier-maturation — extending the audit surface, not self-hosting the engine)."
references: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime self-hosting debt (the engine doesn't dogfood its own standards)

Minted by `/backlog-themes` (2026-07-10) from the `runtime-operationalization-leftovers` bucket. The
runtime is the live enforcement + work-driver for the whole repo, yet four deferred findings share one
root cause: **the runtime holds the repo to invariants it does not (yet) apply to its own code and
registry.** A single "make the runtime self-hosting" push drains all four.

**Members (4, core):**

- `runtime-typescript-port` — 90 `.mjs` logic files get **no** compile-time type-checking (types only
  at the zod seams). The `ruleIdMatchesFilename` zero-arg crash fixed in `runtime-make-it-fire` is the
  poster child of the bug class `tsc` would flag. Node-24 zero-build ⇒ full-TS is *consistency*, not
  divergence (the rest of the repo is already TS).
- `from-deploy-gate-runner-ring2-project-bindings` — ring-2 `deploy-gate-runner.mjs` imports two
  project-specific modules from outside `runtime/`; ring 2 should bind host primitives only. Currently
  `KNOWN_ESCAPES`-allowlisted in `import-boundary.test.mjs`. Relocate to ring 3 / inject, then shrink
  the allowlist to zero for a total guard.
- `runtime-invariant-safety-metacheck` — an `[invariant]` check that isn't clean on a clean tree bricks
  **every** commit. `meta-check.mjs` validates registry integrity (schemas/ids/module-existence) but
  never runs the evaluators; mint a meta-check that asserts every active invariant returns zero findings
  on a clean tree.
- `nx-orphan-test-file-metacheck` — a `*.test.mjs`/`*.test.ts` matched by no nx `test` target is
  invisible to `nx affected`/CI and never runs (the `tools/check-*.test.mjs` gap). Mint a deterministic
  meta-check that flags any test file covered by no project's `test` target.

**Disposition:** durable root-cause bucket (`status: parking`). Promote to a delivery epic when the
runtime's self-hosting is the active workstream; ships when all four members are terminal.
