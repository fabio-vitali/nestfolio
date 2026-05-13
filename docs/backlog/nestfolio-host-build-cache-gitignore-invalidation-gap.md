---
id: nestfolio-host-build-cache-gitignore-invalidation-gap
status: shipped
rank: null
type: bug
references: []
out_of_scope:
  - "Un-gitignoring config.json (Option B) — would force committed runtime values; not adopted, A+E sufficient."
  - "Runtime shasum input on nf-build (Option C) — superseded by direct cache disablement."
  - "Moving config.json to a non-gitignored source location (Option D) — over-scope; not adopted."
  - "Investigating cdk-constructs:test 32s bundling (covered by integration-suite-lever-5-cdk-bundling)."
spec: null
plan: null
topic_memory: []
validation_gate: "Repro (`nx reset` → `build` → mutate `apps/nestfolio-host/public/assets/config.json` sentinel → `build` again): second build re-runs both `nf-build` and `build` (no `[local cache]`, no `X of Y cached` line), sentinel propagates to `dist/apps/nestfolio-host/browser/assets/config.json`. build2 ~20s vs prior cached-broken path ~5s (bounded cost as predicted in backlog Option A)."
notes: "Split out from host-runtime-config-json-regeneration-silently-optional after self-check showed the input-glob fix was ineffective due to .gitignore. SHIPPED 2026-05-13. Diagnosis required revising the backlog's Option E rejection: A alone was insufficient because `build.outputs` is the whole `dist/apps/{projectName}` folder, so `build` cache-restore overwrote nf-build's fresh writes. Applied both A (cache:false on nf-build) and E (cache:false on build) together. Fix: apps/nestfolio-host/project.json — `cache: false` on `nf-build` and `build` targets."
---

# `nestfolio-host:build` cache doesn't invalidate on `public/assets/config.json` changes

`apps/nestfolio-host/public/assets/config.json` is gitignored at `.gitignore:51`. Nx respects gitignore when hashing file-glob inputs, so neither the implicit `production`/`default` namedInputs nor an explicit `{projectRoot}/public/**/*` entry on `nf-build` invalidates the cache when only the gitignored config.json changes. Reproduction (confirmed 2026-05-13 during self-check of host-runtime-config-json-regeneration-silently-optional):

1. `pnpm nx reset && pnpm nx run nestfolio-host:build` — primes cache with current public/config.json.
2. Modify `apps/nestfolio-host/public/assets/config.json` (e.g., regenerate via `nx run nestfolio-host:config` after a BFF re-deploy that rotated an AppSync URL).
3. `pnpm nx run nestfolio-host:build` — Nx reports "1 out of 2 tasks cached"; `dist/apps/nestfolio-host/browser/assets/config.json` is restored from cache with the OLD URLs.
4. Direct `pnpm nx run nestfolio-host:nf-build` (bypassing the `build` dependency chain) DOES propagate the change to dist — so the gap is specifically in how the `build` target interacts with `nf-build`'s cache via `dependentTasksOutputFiles`.

The deploy pipeline invokes `nestfolio-host:build` indirectly through `investor-web:deploy-shell`, so this is the production code path. Bug 1 of the parent workstream (deploy.sh Phase 4c trigger) is now correct, but in the case it actually matters (BFF stack rotation changing an AppSync API ID), this cache-hit will silently serve the stale config.json to CloudFront.

## Candidate fix shapes

A. **`cache: false` on `nf-build`** — simplest, guaranteed correctness. Trade-off: every shell deploy rebuilds the whole bundle (~30s wall-clock). For a deploy operation that's negligible; for local `serve-static`-style workflows it may add friction.
B. **Un-gitignore `config.json` + treat it as committed** — current dev SSM-resolved values would land in git, which is fine if they're not secrets (they are CloudFront/AppSync hostnames and Cognito pool IDs — all public). Pros: standard Nx caching works correctly. Cons: PR churn whenever sandbox URLs rotate.
C. **`{"runtime": "shasum apps/nestfolio-host/public/assets/config.json"}` input on `nf-build`** — runs at hash-compute time so should bypass gitignore. Was tried during self-check but couldn't be validated within the 30s test budget (rebuild takes longer than the harness allows for the validation step). Needs proper async validation.
D. **Move generated config.json to a non-gitignored location** (e.g., `apps/nestfolio-host/src/runtime-config/config.json`) and reference it via a different mechanism. More invasive — touches the producer (`fetch-runtime-config.sh`), the consumer in the Angular bootstrap, and the assets glob.
E. **`cache: false` on `build`** — same as A but at a different layer; would only force the assertion to re-run, which doesn't actually fix the underlying nf-build cache hit. Reject.

Default proposal: A — drop cache on nf-build. Cost is bounded (a single ~30s rebuild per deploy) and the correctness guarantee is unconditional. Promote B if commit-churn from rotating URLs proves acceptable.
