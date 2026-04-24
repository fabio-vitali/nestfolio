# MFE Charter Migration Roadmap

**Status:** Proposed
**Date:** 2026-04-24
**References:**
- Charter: [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](../specs/2026-04-24-mfe-architecture-charter.md)
- V1 spike plan: [`docs/superpowers/plans/2026-04-24-wss-cloudfront-spike.md`](./2026-04-24-wss-cloudfront-spike.md)

## Purpose

This document sequences the work of migrating the current codebase to conform to the MFE architecture charter. It is **not itself an implementation plan** — each enumerated sub-plan below is a separate brainstorm → plan → execution cycle. Sequencing + dependencies are the only things this document commits to.

## Prerequisite — V1 spike resolved

The unified CloudFront topology (charter §7 R6) depends on the V1 result.

- **V1 PASS:** proceed with the charter as written.
- **V1 FAIL:** amend §7 R6 (one direct-WSS exception row) + relax Pillar 5 CSP wording, then proceed.

Either way, every sub-plan below is unblocked after V1 is recorded in the charter §9.

## Scope

The eight sub-plans below together implement the charter. They are grouped into three phases by dependency.

## Phase A — Independent prep (parallelizable)

Each item is designable and implementable independently of the others. All four complete before Phase B.

### A1 — CSP single-source of truth

- **Scope:** extract `apps/nestfolio-host/csp.txt` as canonical; wire meta-tag injection in the shell's `index.html` build step + `investor-web`'s CDK `ResponseHeadersPolicy` to read it.
- **Brainstorming questions:** how does the shell template inject the CSP value (build-time substitution or runtime)? does the `sha256-<hash>` for the federation-runtime inline script need to be in the file today, or only after B2?
- **Depends on:** nothing.
- **Charter sections realized:** §5 row 8, Pillar 5.
- **Rough size:** small (1-2 days).

### A2 — `@nestfolio/frontend-deps` lib extraction

- **Scope:** new workspace lib exporting the shared singleton declaration; every app's `federation.config.js` requires this lib so the singleton surface is single-sourced (shell ⊇ MFE rule becomes mechanical).
- **Brainstorming questions:** lib path? signature of the export (object vs function)? opt-in overlay mechanism for app-specific additions (if any)? versioning policy.
- **Depends on:** nothing.
- **Charter sections realized:** §5 row 7, Pillar 2.
- **Rough size:** small (1 day).

### A3 — Per-BFF MFE bucket provisioning

- **Scope:** each BFF stack provisions an S3 bucket hosting that BFF's MFE bundle + bucket policy granting CloudFront OAC read + SSM exports of `{bucketName, graphqlUrl, realtimeUrl}`. Buckets exist but are not yet wired into the CloudFront distribution (that's B1).
- **Brainstorming questions:** bucket naming convention (matches `NamingService`?); OAC shared across BFFs or one per BFF? bucket retention / versioning policy? how is the existing `BucketDeployment` in `investor-web` coexisted with during the migration window?
- **Depends on:** nothing (buckets can exist without CloudFront referencing them).
- **Charter sections realized:** §5 row 9b, §6 BFF charter.
- **Rough size:** medium — design once, repeat per BFF (one plan covering all 5 BFFs is reasonable).

### A4 — Runtime config producer + auth factory injection (bundled)

- **Scope:** new `scripts/fetch-runtime-config.sh` + Nx `config` target on the shell + refactor `provideAuth()` to use an `AUTH_CONFIG` DI token backed by a factory that reads `getRuntimeConfig().auth` (Pillar 3 bootstrap discipline).
- **Brainstorming questions:** where does the factory live (`libs/shell/auth`)? how do we handle local `nx serve` when SSM is unreachable (fail hard vs fallback)? what happens to `environment.ts` resource literals that other code still reads?
- **Depends on:** nothing (uses existing SSM paths per `NamingService`).
- **Charter sections realized:** §5 row 5, §8, Pillar 3.
- **Rough size:** medium (2-3 days).

## Phase B — Wire up the unified topology

All four items require V1 resolved **and** the relevant Phase A items complete.

### B1 — CloudFront unified topology in `investor-web`

- **Scope:** `investor-web`'s CDK stack adds per-domain behaviors/origins: `/graphql/<domain>` (AppSync HTTPS), `/realtime/<domain>` (AppSync WSS + CF Function path rewrite), `/mfe/<key>/*` (each BFF's MFE bucket). Origins discovered via SSM at synth time.
- **Brainstorming questions:** how does `investor-web` know which BFFs to iterate — a hardcoded list, a workspace-level manifest, or an SSM-indexed discovery? catalog-change cadence (per charter this is the only cross-stack coupling point)? how are the existing direct-AppSync callers migrated without breakage?
- **Depends on:** V1 PASS (or FAIL amendment applied); A3 complete.
- **Charter sections realized:** §5 row 9a, §7 R6, Pillar 5.
- **Rough size:** large (3-5 days) — touches shared production infra.

### B2 — Federation mechanical fixes + per-app configs using `frontend-deps`

- **Scope:** the mechanical Native Federation fixes from the 2026-04-23 render-restoration spec (`es-module-shims` in polyfills, `includeSecondaries` on npm packages with subpaths, explicit `sharedMappings` subpath entries) + every app's `federation.config.js` now requires `@nestfolio/frontend-deps`. Per-app build-time `index.html` assertion optional here or deferred.
- **Brainstorming questions:** include the `assert-shell-html.mjs` build-time guard now or later? which apps first (shell alone, or shell + one MFE as a proof)?
- **Depends on:** A2.
- **Charter sections realized:** Pillar 2 invariants made mechanical.
- **Rough size:** medium (2-4 days; scales with app count).

### B3 — Apollo per-MFE client refactor

- **Scope:** every MFE instantiates its Apollo client via a shared factory in `@nestfolio/shell/graphql`, passing its `<domain>` literal. Clients use relative `/graphql/<domain>` + `/realtime/<domain>` URLs — no absolute AppSync URLs anywhere in MFE code.
- **Brainstorming questions:** factory signature (`createApolloClient({domain, authToken})`)? error link + auth link composition? subscription link lazy-loaded only for MFEs that subscribe?
- **Depends on:** B1 (unified topology deployed so relative paths resolve), A2 (frontend-deps includes Apollo).
- **Charter sections realized:** §5 row 11, §7 R6 Apollo-topology sentence, Pillar 2.
- **Rough size:** medium (2-3 days).

### B4 — Shell deploy migration

- **Scope:** delete the `BucketDeployment` construct from `investor-web` (the one added in commit `cb53a711`); add an explicit `deploy-shell` Nx target on `investor-web` that `aws s3 sync`'s the shell bundle + invalidates `/*` minus `/mfe/*`.
- **Brainstorming questions:** target location (`investor-web/project.json` target vs standalone script)? integration with `infrastructure/scripts/deploy.sh`? rollout order against B1 (shell bucket must exist before deploy target runs)?
- **Depends on:** A1 (CSP file finalized), A4 (`config.json` generator runs before deploy).
- **Charter sections realized:** §5 row 9a, §6 `investor-web` charter.
- **Rough size:** small (1-2 days).

## Phase C — Cleanup & verification

### C1 — Resume the paused Playwright plan

- **Scope:** unpause `docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md`; run Task 0 probe against the deployed CloudFront URL; validate all 5 MFE routes render. This is the behavioural gate the charter implementation graduates against.
- **Depends on:** all of Phase B complete.
- **Charter sections realized:** §3 implied behavioural guarantee.
- **Rough size:** existing plan — already scoped.

### C2 — Legacy debt itemization + removal

- **Scope:** enumerate and delete `environment.ts` resource literals, the dead `libs/cdk-constructs/src/extensions/runtime-config.ts` if still present, any orphaned federation-config patterns, any direct AppSync URL references in frontend code. Update memory to reflect the new state.
- **Depends on:** Phase B complete.
- **Charter sections realized:** Pillar 3 (no env literals) + §10 (legacy debt enumerated).
- **Rough size:** small (1-2 days).

## Recommended execution rhythm

After V1 is resolved and recorded in the charter §9:

1. **Four brainstorming sessions** — one per Phase A sub-plan. Each produces a plan at `docs/superpowers/plans/YYYY-MM-DD-<a-n>-<topic>.md`. These can run in any order (parallel-safe if multiple collaborators; sequential otherwise).
2. **Execute all four Phase A plans.** Each lands to `main` independently. Nothing is deploy-coupled at this stage.
3. **Four brainstorming sessions** — one per Phase B sub-plan. Each produces a plan. Watch dependencies: B3 needs B1 + A2; B4 needs A1 + A4.
4. **Execute Phase B plans** in dependency order. B1 first (it's a prerequisite for B3); B2 and B4 can overlap with B1 if care is taken.
5. **Phase C** — single brainstorming + plan covering both C1 and C2; execute.

## Immediate next step after V1

Clear context, start a fresh brainstorming session for **A1 (CSP single-source)** — smallest, zero dependencies, good warm-up for the migration rhythm. Prompt to paste after `/clear`:

```
Brainstorm and plan A1 from docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md: CSP single-source of truth. Charter invariants to honour: docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md Pillar 5 + §5 row 8. Use the superpowers:brainstorming skill, then superpowers:writing-plans.
```

## What this roadmap does NOT cover

- Actual implementation of any sub-plan (each gets its own plan file).
- Prioritisation between Phase A items — they are independent; pick whichever is most pressing or most convenient first.
- The WSS spike itself (its plan already exists; this roadmap treats it as a prerequisite).
- Any backend work outside the frontend charter (domain logic, event topology, etc.).
