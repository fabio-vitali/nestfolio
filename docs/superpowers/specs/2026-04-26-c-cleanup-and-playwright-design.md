# Phase C — Cleanup & Playwright Smoke Gate

**Status:** Proposed
**Date:** 2026-04-26
**Owner:** fabio-vitali + Claude
**Type:** Design (combined C1 + C2 of the MFE charter migration roadmap)

## References

- Roadmap: [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) §§Phase C
- Charter: [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md) Pillar 3, Pillar 5, §7 R6, §10
- Paused Playwright plan: [`docs/superpowers/plans/2026-04-22-playwright-e2e-ui.md`](../plans/2026-04-22-playwright-e2e-ui.md)
- Predecessor (informational): [`docs/superpowers/specs/2026-04-23-shell-render-restoration-design.md`](./2026-04-23-shell-render-restoration-design.md)

## 1. Context

Phase A (A1–A4) and Phase B (B1–B4) of the MFE charter migration are merged on `main` as of 2026-04-26:

- A1 — CSP single source (`csp.txt`)
- A2 — `@nestfolio/frontend-deps` lib
- A3 — per-BFF MFE buckets
- A4 — runtime-config producer + auth factory injection
- B1 — CloudFront unified topology in `investor-web`
- B2 — federation mechanical fixes (`es-module-shims`, assert-shell-html gate, frontend-deps singleton-surface expansion)
- B3 — Apollo per-MFE clients (`createApolloClient` factory + `provideMfeGraphql`)
- B4 — shell deploy migration (`deploy-shell` Nx target + Phase 4b in `deploy.sh`)

Phase C is the closing pair: a behavioural gate (does the deployed shell actually render the 5 MFE routes?) plus the legacy-debt cleanup the charter §10 explicitly enumerated as "obsoleted by this charter."

This document combines both items into one spec because the surface area is small, the dependencies are inverted (debt removal rides on top of the same charter invariants the smoke gate exercises), and the charter graduation criterion is unitary: charter implementation is "done" when the deployed shell renders + no charter-violating artifact remains in source.

## 2. Problem

Two distinct problems collected under one phase:

### 2.1 No behavioural verification has ever passed

`memory/project_shell_render_broken.md` records that the shell `/login` page has never rendered in any browser on any commit of `main` since 2026-03-08. Every Phase A/B item shipped passing unit tests + CDK synth tests; none of them was exercised end-to-end through a real CloudFront → S3 → Angular bootstrap → federation runtime → MFE module-load chain. Phase B's shipped status is a *static* claim. The charter §3 "implied behavioural guarantee" — that an MFE actually renders when its route is requested — has not been verified.

The paused Playwright plan (`2026-04-22-playwright-e2e-ui.md`) was the original vehicle for this verification. Its Phase 0 + Phase 1 spikes shipped; Phase 2–10 (the full new-investor happy-path harness) is a 10-day undertaking we do not need before charter graduation. We need a thin gate, not a full e2e suite.

### 2.2 Charter-violating artifacts remain in source

The charter §10 lists "all current code that violates a pillar" as legacy debt to be enumerated and removed. Concrete inventory after Phase B (verified by static search 2026-04-26):

| # | Artifact | Location | Charter clause violated |
|---|---|---|---|
| 1 | Dead CDK extension `RuntimeConfig` (3.6 KB, no real importers) | `libs/cdk-constructs/src/extensions/runtime-config.ts` + re-export in `extensions/index.ts:12` | §10 names it explicitly |
| 2 | Per-MFE inline CSP `<meta>` tags (5 files) | `apps/{dashboard,investor,advisory,ledger,onboarding}-mfe/src/index.html` | Pillar 5 + §5 row 8 (shell owns CSP exclusively) |
| 3 | Service-worker AppSync URL caching | `apps/nestfolio-host/ngsw-config.json` `dataGroups[0]` | Pillar 3 (no resource literals); §7 R6 (BFFs reached via `/graphql/<domain>`) |
| 4 | `csp.txt` `connect-src` admits `*.amazonaws.com`, `*.appsync-api.*`, `wss://*.appsync-realtime-api.*` | `apps/nestfolio-host/csp.txt` | §7 R6 promises `connect-src 'self'` post-B1+B3 |
| 5 | Memory describing Phase B as in-flight, shell-render-broken as open, Playwright as BLOCKED | `memory/project_{mfe_charter_migration,shell_render_broken,playwright_e2e_ui}.md` | Out-of-date with main |

Items 1–4 have zero runtime importers in app source — verified by `grep -r appsync-api apps/` (only matches: ngsw-config.json + the 5 MFE inline CSPs + the host CSP — no code-level references). Their persistence on `main` is purely accumulated debt, removable as a single PR.

`environment.ts` was already deleted by A4 on `main` (only present in worktrees) — no work needed.

## 3. Goals and non-goals

### Goals

**G1.** Prove the deployed shell renders all 5 MFE routes (`/investor`, `/advisory`, `/ledger`, `/dashboard`, `/onboarding`) on CloudFront — the charter §3 behavioural gate.

**G2.** Remove every charter-violating artifact enumerated in §2.2 from `main`, in one PR.

**G3.** Add a build-time guard preventing the regrowth of AppSync/amazonaws.com URL literals in app source.

**G4.** Update memory so future sessions read main's actual state, not its 2026-04-22 state.

### Non-goals

- **Full Playwright e2e harness (Phase 2–10).** Deferred to a separate plan that resumes the paused `2026-04-22-playwright-e2e-ui.md`. C1 delivers a smoke probe, not a journey suite. The smoke probe is throwaway by design — when the full harness lands, the smoke probe is removed (it becomes the harness's own boot-time check).
- **CSP `connect-src 'self'` (no Cognito).** Amplify v6 calls Cognito directly from the browser; routing Cognito through CloudFront is out of charter scope. The pragmatic landing point is `'self' + cognito-idp + cognito-identity`. Future plan may revisit if Amplify is replaced.
- **Service-worker caching strategy redesign.** §2.2 item 3 is a deletion, not a redesign. SW caching for the GraphQL plane gets its own future spec if/when offline becomes a product requirement.
- **CI integration of the smoke probe.** Smoke runs ad-hoc post-deploy in this phase. CI wiring is part of the deferred Playwright resumption (Phase 9 of the paused plan already covers it).
- **Per-route deep behavioural assertions.** "Renders" means: HTTP 200 from CF, `<app-root>` element produces non-empty subtree within 10 s, no `console.error`, no failed network requests on charter paths (`/graphql/*`, `/mfe/*`, `/realtime/*`). Domain UI correctness is for the journey suite.

## 4. Design

### 4.1 C1 — CloudFront smoke probe

**Location:** `tools/probes/cf-smoke.mjs` (Node 20 script, plain `.mjs`, no Nx project).

**Invocation:** `pnpm cf-smoke --prefix=dev` → wired as a root-level npm script in `package.json` for ergonomics; alternative `node tools/probes/cf-smoke.mjs --prefix=dev` always works.

**Dependencies:** `playwright-core` (lighter than the full `playwright` distribution; downloads only the chromium-headless-shell binary). Added as a workspace devDependency.

**Algorithm:**
1. Resolve CF URL: read SSM `/nestfolio/<prefix>-investor/web/distributionUrl` via `aws ssm get-parameter` (matches A4's producer pattern; reuses Leapp credentials).
2. Launch chromium-headless-shell.
3. For each route in `['/investor', '/advisory', '/ledger', '/dashboard', '/onboarding']`:
   - `page.on('console')` → collect error-level entries.
   - `page.on('requestfailed')` → collect failures with URL matching `/(graphql|mfe|realtime)/`.
   - `page.goto(<cfUrl> + route, { waitUntil: 'networkidle', timeout: 15000 })`.
   - Assert HTTP status 200 (or 304).
   - Assert `await page.locator('app-root *').count() > 0` within 10 s of `domcontentloaded` — i.e., Angular has bootstrapped and rendered *something* into the host element.
   - Assert collected console errors length is 0.
   - Assert collected charter-path request failures length is 0.
4. If any route fails, print structured per-route report (route, status, console errors, request failures) and exit 1. Otherwise exit 0 with a green summary.

**Auth handling:** the probe runs unauthenticated. The 5 MFE routes redirect to `/login` when unauthenticated; this is itself a render path that must succeed. The probe asserts: from each MFE URL, *something* (either the MFE shell or the redirected `/login` page) renders without error. This is sufficient for the §3 behavioural gate. Authenticated route verification belongs to the deferred Playwright Phase 2–10.

**Why throwaway:** the future Playwright harness (Phase 3 of the paused plan) creates `apps/nestfolio-e2e/` with its own boot-time smoke. At that point `cf-smoke.mjs` becomes redundant and is deleted. C1 explicitly does NOT scaffold the Nx app — that's Phase 3 of the resumption plan.

### 4.2 C2 — Legacy debt deletions

Five edits, each a separate commit on the same branch for `git bisect` traceability:

**Edit 1 — Delete dead `runtime-config` CDK extension.**
- Delete `libs/cdk-constructs/src/extensions/runtime-config.ts`.
- Edit `libs/cdk-constructs/src/extensions/index.ts:12` to remove the `export { RuntimeConfig, RuntimeConfigProps, RuntimeConfigSsmPaths }` re-export.
- Verification: `pnpm nx run cdk-constructs:test` green; `pnpm nx run cdk-constructs:build` green; `git grep -E 'RuntimeConfig\\b' libs services apps` returns 0 hits.

**Edit 2 — Delete per-MFE index.html CSP `<meta>` tags.**
- For each of `apps/{dashboard,investor,advisory,ledger,onboarding}-mfe/src/index.html`: remove the `<meta http-equiv="Content-Security-Policy">` line (and any leading whitespace-only line).
- These files are never loaded standalone in production — they exist only as Angular CLI build inputs producing `dist/<mfe>/index.html` which the federation runtime never serves at the document level. The shell's CSP (delivered via `csp.txt`-driven CloudFront `ResponseHeadersPolicy`) is the only enforced CSP at runtime.
- Verification: shell + 5 MFE `nf-build` Nx targets green (assert-shell-html still asserts the shell's inline CSP via `csp.txt` substitution).

**Edit 3 — Delete `ngsw-config.json` `dataGroups[0]`.**
- Edit `apps/nestfolio-host/ngsw-config.json` to remove the entire `dataGroups` array (it had only one entry, the AppSync `api` group). Result: file has only `assetGroups`.
- The service worker no longer attempts any GraphQL caching. Apollo's normalized cache (in-memory) handles client-side caching for the lifetime of the page; charter does not commit to offline support.
- Verification: shell `nf-build` green; deployed CloudFront still serves `/ngsw-worker.js` correctly (smoke probe catches regressions).

**Edit 4 — Shrink `csp.txt` `connect-src`.**
- Edit `apps/nestfolio-host/csp.txt`. Replace:
  ```
  connect-src 'self' https://*.amazonaws.com https://*.appsync-api.*.amazonaws.com wss://*.appsync-realtime-api.*.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com;
  ```
  with:
  ```
  connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://cognito-identity.us-east-1.amazonaws.com;
  ```
- The `'self'` covers `/graphql/<domain>`, `/realtime/<domain>`, `/mfe/<key>/*`, `/api/copilotkit*` since they are all CloudFront paths on the same origin (B1 unified topology).
- Cognito IdP + Identity remain because Amplify v6 client SDK calls `https://cognito-idp.us-east-1.amazonaws.com` directly during signIn / token refresh (verified by static analysis of `@aws-amplify/auth@6.x` source). Removing them would break authentication.
- Verification: A1's `prepare-index` Nx target re-substitutes `{{CSP}}` in `index.html.tmpl`; A1's `synth` target (which has `csp.txt` in inputs) re-runs `cdk synth` for `investor-web`; both produce the new shrunk CSP. Smoke probe (C1) catches any auth-flow regression.

**Edit 5 — Add negative-grep gate.**
- New file `tools/check-no-appsync-literals.mjs`: scans `apps/**/*.{ts,html,json,js}` and `libs/{shell,frontend-deps,ui}/**/*.{ts,html,json,js}` for the regex `(appsync-api|appsync-realtime-api|\.amazonaws\.com)`. Excludes `node_modules`, `dist`, `cdk.out`, `.worktrees`. Exit 1 with a structured per-file report if any match.
- New Nx target on the workspace root (or on a dedicated `tools` project): `check-no-appsync-literals`. Wired as `dependsOn` of the workspace `lint` runs of `nestfolio-host` + 5 MFEs.
- Sibling test: `tools/check-no-appsync-literals.test.mjs` (node:test). Creates a tmpdir, salts with a salted file containing `appsync-api.us-east-1.amazonaws.com`, asserts the script exits 1 with the salted file in the report. Then writes a clean tmpdir, asserts exit 0.
- Verification: gate passes on `main` after Edits 1–4 land.

### 4.3 Memory updates

Three files in `~/.claude/projects/.../memory/`:

**`project_shell_render_broken.md`** — append a "Resolution" section dated 2026-04-26: Phase B (B1 unified topology + B2 federation mechanical fixes + B3 Apollo per-MFE + B4 shell deploy migration) collectively unblocked the deployed-CF render. The smoke probe (C1) verifies on `dev`. The five layered issues from 2026-04-22 are addressed by: (a) B2 `es-module-shims` polyfill, (b) B2 `sharedMappings` subpath entries, (c) B2 `includeSecondaries` on subpath packages, (d) B2 `url` polyfill in `frontend-deps`, (e) A1 CSP single-source + B3 + C2 Edit 4 final shrink.

**`project_mfe_charter_migration.md`** — update Phase B status: B4 SHIPPED (was "not started"). Add Phase C section: C1 smoke probe + C2 cleanup shipped 2026-04-26 on branch `feat/c-cleanup-and-playwright`. Charter graduation status: graduated.

**`project_playwright_e2e_ui.md`** — change Status from BLOCKED to "Phase 0 + Phase 1 done; smoke gate (cf-smoke.mjs) provides charter graduation; full Phase 2–10 deferred — start a fresh brainstorming session when the e2e harness becomes a product priority."

### 4.4 Execution order (one branch, one PR)

Branch `feat/c-cleanup-and-playwright`. Commits in order:

1. `chore(c2): remove dead RuntimeConfig CDK extension`
2. `chore(c2): remove per-MFE index.html CSP meta tags`
3. `chore(c2): remove ngsw-config AppSync dataGroup`
4. `chore(c2): shrink csp.txt connect-src to self+Cognito`
5. `feat(c2): add check-no-appsync-literals build-time gate`
6. `feat(c1): add tools/probes/cf-smoke.mjs CloudFront smoke probe`
7. `chore: update memory for charter graduation`

After commits 1–5: full local gates (`pnpm nx run-many -t build,test,lint`) must be green. After commits 1–6: deploy to `dev` with `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev`, then run `pnpm cf-smoke --prefix=dev`. Smoke green ⇒ open PR. Smoke red ⇒ `git bisect` over commits 1–5; the offending commit gets a fix-up; PR opens after green smoke.

## 5. Components

| Component | Purpose | Depends on | Consumed by |
|---|---|---|---|
| `tools/probes/cf-smoke.mjs` | Behavioural gate against deployed CF | `playwright-core`, `aws-cli`, SSM `/nestfolio/<prefix>-investor/web/distributionUrl` | Operator (manual) post-deploy |
| `tools/check-no-appsync-literals.mjs` | Build-time guard preventing AppSync URL literal regrowth | none | `lint` Nx target chain |
| `tools/check-no-appsync-literals.test.mjs` | Verifies the gate flags regressions | `node:test` | `pnpm nx test` |

No new application-runtime components. No new libs.

## 6. Data flow

```
Operator
  │
  ▼
pnpm cf-smoke --prefix=dev
  │
  ├── aws ssm get-parameter --name /nestfolio/dev-investor/web/distributionUrl ──▶  cfUrl
  │
  ▼
playwright-core launches chromium-headless-shell
  │
  ▼
For route in [/investor, /advisory, /ledger, /dashboard, /onboarding]:
  │
  ▼
page.goto(cfUrl + route)
  │
  ▼
Assertions:
  - HTTP 200/304
  - <app-root> non-empty within 10s
  - no console.error
  - no requestfailed on /graphql/* | /mfe/* | /realtime/*
  │
  ▼
Per-route summary → exit 0 (all green) or exit 1 (any red, structured report)
```

The CDK synthesis flow is unchanged from A1 — `csp.txt` change in C2 Edit 4 propagates to both the inline `<meta>` (via `prepare-index`) and the CloudFront `ResponseHeadersPolicy` (via `cdk synth`'s `readFileSync` of the same file).

## 7. Error handling

**Smoke probe failures** are structured exits: route-level breakdown printed to stdout, exit 1. No retries — flake-resistance is the journey suite's job, not the smoke gate's.

**SSM fetch failure** (no Leapp creds, parameter missing) → fail-fast with a remediation message: "Run `eval $(leapp session start ...)` and ensure prefix `<prefix>` was deployed via `infrastructure/scripts/deploy.sh`." Same shape as A4's `fetch-runtime-config.sh` errors.

**Negative-grep gate failure** prints the offending file + line + match. No auto-fix. Developers see a clear "you cannot ship this" boundary.

**Memory updates** are not gated; if they fail (path issue), the deletions still ship and memory is fixed in a follow-up commit. Not on the critical path.

## 8. Testing

**Unit:**
- `tools/check-no-appsync-literals.test.mjs` (node:test) — salt + clean cases.

**Integration:**
- The smoke probe IS the integration test. Pass/fail post-deploy gates the PR.

**No new tests for deletions** — the existing test suites (`shell`, `nestfolio-host`, `cdk-constructs`, `investor-web`, 5 MFE projects) already exercise the surface that the deleted code formerly touched. Their continued green is the regression bar.

**Manual verification checklist** (executed by the operator before opening the PR):

- [ ] `pnpm nx run-many -t build` green for shell + 5 MFEs (assert-shell-html OK each)
- [ ] `pnpm nx run-many -t test` green for `nestfolio-host`, `shell`, `frontend-deps`, `cdk-constructs`, `investor-web`
- [ ] `pnpm nx run cdk-constructs:lint` green
- [ ] `pnpm nx run nestfolio-host:lint` green (includes new `check-no-appsync-literals` gate)
- [ ] `pnpm nx run investor-web:synth --prefix=dev` green; synthesized CSP matches `csp.txt`
- [ ] `git grep -E 'RuntimeConfig\b' libs/cdk-constructs services apps` returns 0 hits
- [ ] `git grep -E 'appsync-(api|realtime-api)|\\.amazonaws\\.com' apps libs/{shell,frontend-deps,ui}` returns 0 hits (excluding `csp.txt` Cognito lines and `ngsw-config.json` if anything else was kept)
- [ ] `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web` green (or full deploy if other services drifted)
- [ ] `pnpm cf-smoke --prefix=dev` green for all 5 routes

## 9. Out-of-scope follow-ups (logged here, not done)

- Full Playwright Phase 2–10 resumption — separate brainstorming session, separate plan.
- Cognito-through-CloudFront — would let CSP `connect-src 'self'` hold strictly. Future spec.
- Service-worker GraphQL caching (offline mode) — future spec if product requires.
- `apps/nestfolio-host/src/index.html` regenerated artifact: should it be `.gitignore`d (since it's emitted from `index.html.tmpl + csp.txt`)? Currently checked-in. Investigate in a future polishing pass.

## 10. Acceptance criteria

The phase is "done" when:

1. All 7 commits from §4.4 land on `main` via PR merge.
2. `pnpm cf-smoke --prefix=dev` passes for 5 routes against the dev CloudFront URL — recorded in the PR description.
3. `git grep -E 'RuntimeConfig\\b' libs/cdk-constructs services apps` returns 0 hits.
4. The negative-grep gate is wired into the lint dependency chain and fires on a synthetic regression test.
5. Memory updates reflect the new state (Phase C shipped, Playwright smoke gate present, shell-render-broken resolved).
