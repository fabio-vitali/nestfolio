# B1 — CloudFront unified topology in `investor-web` (design)

**Status:** Proposed
**Date:** 2026-04-25
**Author:** fabio-vitali + Claude
**Type:** Implementation design (sub-plan B1 of the MFE charter migration roadmap).

## References

- Roadmap: [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md), §B1.
- Charter (invariants): [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md), §5 row 9a, §7 R6, §4 Pillar 5, §9 V1.
- V1 spike (validates WSS-through-CloudFront): same charter §9 V1; spike code under `tools/spikes/wss-cf-spike/`.
- A3 ship (per-BFF MFE buckets + SSM exports): [`memory/project_mfe_charter_migration.md`](../../../../.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_mfe_charter_migration.md).

## 1. Context

The MFE architecture charter (2026-04-24) establishes that the entire frontend system — shell, every MFE bundle, every BFF (HTTPS + WSS), and the CopilotKit bridge — is reachable on **one origin** via the single CloudFront distribution owned by `investor-web` (charter §5 row 9a). A3 (shipped 2026-04-25) provisioned the per-BFF MFE buckets and the SSM exports needed for CloudFront origin discovery. V1 (verified PASS 2026-04-24) proved that AppSync WSS subscriptions work through CloudFront with `CachingDisabled` + `AllViewerExceptHostHeader` + a viewer-request CF Function rewrite.

B1 is the wiring step: take A3's SSM exports + V1's transport configuration and grow `investor-web`'s CloudFront distribution to serve every BFF's GraphQL HTTPS endpoint, every BFF's AppSync WSS endpoint, and every MFE's S3 bucket — all SSM-discovered at deploy time.

This design treats B1 as **purely additive**: the existing default behavior (shell), the existing `/api/copilotkit*` behavior, every existing SSM export, and every Cognito wiring stays untouched. No frontend caller migrates in B1 (that's B3). No CSP tightening happens in B1 (that's after B3). No `BucketDeployment` for the shell is removed (that's B4).

## 2. Goals

1. Add 13 new CloudFront cache behaviors to the existing distribution, all origins SSM-discovered:
   - 5 × `/mfe/<key>/*` (one per BFF: investor, advisory, ledger, dashboard, onboarding)
   - 4 × `/graphql/<domain>` (one per Facade-bearing BFF: investor, advisory, ledger, dashboard)
   - 4 × `/realtime/<domain>` (same 4 BFFs, with viewer-request rewrite)
2. Survive cold-start deploy ordering (BFFs publishing SSM exports that `investor-web` consumes) without manual intervention beyond a single shell command.
3. Provide a clean rollback that requires neither a parallel distribution nor a DNS swing.
4. Stay within the V1-validated transport configuration. No experimental cache/origin policies.

## 3. Non-goals

- Migrating any frontend caller from direct AppSync URLs to relative `/graphql/<domain>` (B3).
- Tightening CSP `connect-src` to `'self'` (post-B3).
- Removing the shell `BucketDeployment` (B4).
- Restructuring `libs/frontend-deps` or moving the MFE catalog into a shared lib.
- Changing any BFF's stack (A3 already shipped the bucket + SSM exports; the only shared-lib change is one new SSM export on the Facade construct).

## 4. Architecture overview

`investor-web`'s CloudFront distribution grows behaviors by iterating a workspace-local catalog `MFE_CATALOG`. Each entry is `{key, subsystem, service, hasFacade}`. For Facade-bearing entries, three behaviors are added; for the onboarding entry, only the `/mfe/onboarding/*` behavior is added (CopilotKit traffic continues through the existing `/api/copilotkit*` behavior).

The 13 new behaviors are gated behind a CDK context flag `mfeBehaviors` (default `false`). On a fresh AWS account, Phase 2 of `deploy.sh` deploys `investor-web` without the flag (no B1 behaviors), Phase 3 deploys all BFFs (publishing `api/apiId`, `mfe/bucketName` etc.), Phase 4 re-deploys `investor-web` with `mfeBehaviors=true`. In steady state — when BFF SSM exports already exist — `deploy.sh` passes `mfeBehaviors=true` from Phase 2 onward; investor-web is deployed exactly once.

The single shared-lib change is in the `Facade` construct (`libs/cdk-constructs/src/core/facade.ts`): one new `StringParameter` exporting `api/apiId`. Existing `api/graphqlUrl` and `api/realtimeUrl` exports stay (B3 will use them). All 4 Facade-bearing BFFs pick up the new export automatically on their next synth.

## 5. Layer-ownership invariants honoured

- **Charter §5 row 9a** — investor-web owns the single CloudFront distribution; origins for all MFE buckets and BFF endpoints are SSM-discovered. ✓
- **Charter §5 row 9b** — each BFF owns its MFE bucket + bucket policy + `mfe/bucketName` SSM export. (A3, unchanged.)
- **Charter §7 R6** — the unified topology table (`/*`, `/mfe/<key>/*`, `/graphql/<domain>`, `/realtime/<domain>`, `/api/copilotkit*`) is fully realized.
- **Charter Pillar 1** — MFE catalog change is the only cross-stack coupling event. The catalog is local to investor-web; adding a new MFE means one edit to `MFE_CATALOG` plus a new BFF stack.
- **Charter Pillar 5** — same-origin everything. After B3 migrates Apollo callers, CSP `connect-src 'self'` will hold without exception. B1 itself does not touch CSP.

## 6. Components and files touched

### Modified files (4)

| File | Change |
|---|---|
| `libs/cdk-constructs/src/core/facade.ts` | Add `api/apiId` `StringParameter` (~5 lines). No existing exports change. |
| `services/investor/investor-web/src/service.stack.ts` | Add B1 wiring gated by `tryGetContext('mfeBehaviors') === 'true'`. Catalog-driven loop calls helpers in `b1-topology.ts`. |
| `services/investor/investor-web/test/unit/service.stack.test.ts` | New `describe` block for B1 topology — flag-off, flag-on, per-behavior assertions. |
| `infrastructure/scripts/deploy.sh` | Cold-start detection (`check_all_b1_params_exist`) + Phase 4 re-deploy of investor-web. |

### New files (4)

| File | Purpose |
|---|---|
| `services/investor/investor-web/src/mfe-catalog.ts` | Hardcoded `MFE_CATALOG` constant + type. Single source of truth for B1 + (later) deploy.sh. |
| `services/investor/investor-web/src/b1-topology.ts` | Pure helpers: `addMfeBucketBehavior`, `addGraphqlBehavior`, `addRealtimeBehavior`. Keeps `service.stack.ts` readable. |
| `services/investor/investor-web/src/cf-functions/realtime-rewrite.js` | Viewer-request CF Function rewriting `/realtime/<domain>` and `/graphql/<domain>` → `/graphql`. Lifted from V1 spike (`tools/spikes/wss-cf-spike/src/path-rewrite.fn.js`). |
| `services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts` | Unit-tests the rewrite function in isolation, mirroring `copilot-rewrite.test.ts`. |

### Untouched on purpose

- `apps/nestfolio-host/csp.txt` — current `connect-src` already admits `'self'` and the legacy AppSync hosts; B1 is purely additive. Tightening to `'self'`-only happens after B3.
- All BFF stacks — A3 already shipped the SSM exports + bucket-policy OAC scoping. The Facade's new `api/apiId` export propagates to BFFs automatically through the shared library, with no per-BFF code change.
- `libs/frontend-deps` — federation contract owner; out of B1 scope.
- The shell `BucketDeployment` in `investor-web` — that's B4's territory.

## 7. Data flow

### At synth (when `mfeBehaviors=true`)

For each `MFE_CATALOG` entry:

- **`/mfe/<key>/*`** (always added)
  - Origin: `Bucket.fromBucketName(SSM(/nestfolio/<prefix>-<service>/mfe/bucketName))`, OAC.
  - `cachePolicy`: `CachePolicy.CACHING_OPTIMIZED` (managed; static asset defaults).
  - `viewerProtocolPolicy`: `REDIRECT_TO_HTTPS`.
  - `allowedMethods`: `GET_HEAD`.
  - No CF Function attached.

- **`/graphql/<domain>`** (added only if `hasFacade`)
  - Origin: `HttpOrigin('${apiId}.appsync-api.${region}.amazonaws.com')`, `HTTPS_ONLY`.
  - `cachePolicy`: `CachePolicy.CACHING_DISABLED` (managed).
  - `originRequestPolicy`: `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER` (managed).
  - `allowedMethods`: `ALLOW_ALL` (POST is the GraphQL verb).
  - `viewerProtocolPolicy`: `HTTPS_ONLY`.
  - CF Function: shared `realtime-rewrite` on viewer-request — strips `/<domain>` so AppSync sees `/graphql`.

- **`/realtime/<domain>`** (added only if `hasFacade`)
  - Origin: `HttpOrigin('${apiId}.appsync-realtime-api.${region}.amazonaws.com')`, `HTTPS_ONLY`.
  - `cachePolicy`, `originRequestPolicy`, `allowedMethods`, `viewerProtocolPolicy`: identical to `/graphql/<domain>`.
  - CF Function: same shared `realtime-rewrite`.

`apiId` is read deploy-time via `StringParameter.valueForStringParameter(this, '/nestfolio/<prefix>-<service>/api/apiId')`, returning a CFN token. Hostnames are constructed by string interpolation against `Stack.region`. The V1 spike validated this exact construction.

### At runtime

Browser → CloudFront → (rewrite Fn for `/graphql/*` and `/realtime/*`) → AppSync. Cognito JWT in `Authorization` header on HTTPS, in `?header=<base64>` query-string param on the WSS handshake (browser-imposed; AppSync reads from query-string on WS open). V1 confirms this end-to-end against `investor-bff`.

### Shared resources

One CF Function (`realtime-rewrite`), reused by all 8 GraphQL+realtime behaviors. The two AWS-managed policies (`CACHING_DISABLED`, `ALL_VIEWER_EXCEPT_HOST_HEADER`) are referenced by name; nothing custom is created. No interaction with the existing `/api/copilotkit*` behavior or its (custom) policies.

## 8. Cold-start and steady-state deploy

### `deploy.sh` extension

A new helper `check_all_b1_params_exist` enumerates, for each catalog entry, the SSM parameters investor-web needs (`api/apiId` for Facade-bearing entries, `mfe/bucketName` for all). The catalog is read by deploy.sh through a tiny Node helper `tools/scripts/list-mfe-catalog.mjs` — same single-source-of-truth principle as the synth-time read.

Phase 2 deploy of investor-web becomes conditional:

```bash
if check_all_b1_params_exist; then
  MFE_BEHAVIORS=true   # steady state
else
  MFE_BEHAVIORS=false  # cold start
fi
deploy_service investor-web ... -c mfeBehaviors=$MFE_BEHAVIORS
```

A new Phase 4a (right before the existing hub-re-deploy Phase 4) re-deploys investor-web with `mfeBehaviors=true` if the cold-start path was taken at Phase 2.

### Idempotency

- Steady state: investor-web deploys once with `mfeBehaviors=true`. Phase 4a is skipped.
- Cold start: investor-web deploys twice (Phase 2 bootstrap, Phase 4a full). One extra `cdk deploy` on first-ever account setup.
- New BFF added later: catalog gains an entry → `check_all_b1_params_exist` returns false at Phase 2 → bootstrap path runs → BFFs deploy → Phase 4a re-runs investor-web. No manual operator step.

## 9. Error handling, rollback, failure modes

### Synth-time

- Catalog entry missing: that BFF's behaviors aren't wired. Caught in code review and by the B3 plan iterating the same catalog.
- `mfeBehaviors=true` passed but a BFF SSM export missing: synth succeeds; CFN deploy fails on the lookup. Recovery: rerun `deploy.sh` (cold-start ordering kicks in automatically).
- Type-level guard: `addGraphqlBehavior` and `addRealtimeBehavior` accept only entries with `hasFacade: true` — onboarding cannot accidentally get a `/graphql/*` behavior.

### Deploy-time

- CloudFront update partial-failure: CloudFormation auto-rollback restores prior distribution config. Default behavior + `/api/copilotkit*` are untouched throughout the update.
- Phase 4a failure: investor-web is left in Phase-2 state (no B1 behaviors). Operator re-runs `deploy.sh`. No partial state because each behavior is added in one CFN update.

### Runtime (post-deploy)

- One BFF's AppSync API down → only that domain's `/graphql/*` and `/realtime/*` 5xx; sibling MFEs unaffected (Pillar 4 per-route isolation).
- MFE bucket empty / object missing → CloudFront 403 (S3 OAC). The shell's existing 404 → `/index.html` rule is scoped to the default behavior only; we deliberately do **not** add an SPA-fallback errorResponse to MFE behaviors (those are static asset trees, not SPA roots).

### Rollback path

The flag's `false` default **is** the rollback. Three levels:

1. **In-flight deploy fails:** CFN auto-rollback. No operator action.
2. **Runtime issue discovered after deploy:** `deploy.sh ... -c mfeBehaviors=false` (single override). Investor-web re-deploys without B1 behaviors; CloudFront removes the 13 new behaviors in one CFN update. Default behavior + `/api/copilotkit*` stay live. Frontend code (still calling AppSync directly at this point) keeps working because csp.txt still admits `*.amazonaws.com`.
3. **Code revert:** `git revert` the B1 commit + `deploy.sh sandbox -c mfeBehaviors=false`. SSM exports from BFFs (`api/apiId`) survive — they're harmless when unused.

No parallel distribution, no DNS swing, no blue/green. The new behaviors are additive to a steady-state distribution and removable in one update.

## 10. Testing strategy

### Unit (CDK template assertions)

`services/investor/investor-web/test/unit/service.stack.test.ts` gains:

1. **Default-flag synth** (no `mfeBehaviors`): the `CacheBehaviors` array has exactly 1 entry (`/api/copilotkit*`); B1 behaviors absent. Default behavior (shell) unchanged.
2. **Full-topology synth** (`mfeBehaviors=true`): the `CacheBehaviors` array has 14 path-pattern entries — the existing `/api/copilotkit*` plus 13 new (5 × `/mfe/*`, 4 × `/graphql/*`, 4 × `/realtime/*`). The default behavior (`/*` → shell S3) is unchanged.
3. **Per-behavior origin assertions** — three tests, one per behavior class, asserting origin type/hostname pattern, allowed methods, cache + origin-request policies, viewer protocol, and (for HTTPS+WSS) the rewrite function association.
4. **Onboarding negative test:** with `mfeBehaviors=true`, `/graphql/onboarding` and `/realtime/onboarding` are not present (only `/mfe/onboarding/*` is).

`services/investor/investor-web/src/mfe-catalog.test.ts`: catalog has exactly 5 entries with the expected keys; exactly 4 entries have `hasFacade: true`.

`libs/cdk-constructs/test/core/facade.test.ts`: new assertion that `api/apiId` `StringParameter` is created with parameterName `/nestfolio/<prefix>-<service>/api/apiId` and stringValue equals `api.apiId`.

`services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts`: rewrite-function inputs/outputs:
- `/realtime/investor` → `/graphql`
- `/realtime/advisory/` → `/graphql`
- `/graphql/ledger` → `/graphql`
- `/api/copilotkit/foo` → unchanged
- `/` → unchanged
- `/mfe/investor/index.html` → unchanged

### Integration

None. B1 is pure CDK + CFN. The behavioural verification is C1 (Playwright e2e). V1 has already proven the WSS-through-CloudFront transport.

### Manual deploy verification (operator)

- `pnpm nx test investor-web` and `pnpm nx test cdk-constructs` pass.
- `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web` after Phase 3 of a fresh prefix — investor-web re-deploys cleanly with `mfeBehaviors=true`.
- `aws cloudfront get-distribution --id <id>` exposes 1 default cache behavior + 14 path-pattern cache behaviors and 15 origins (1 shell S3 + 1 copilotkit HTTP + 5 MFE S3 + 4 AppSync HTTPS + 4 AppSync WSS).
- `curl -i https://<dist>/mfe/investor/remoteEntry.json` → 200 (or 403 if bucket empty pre-B2 deploy; both confirm origin reachable).
- `curl -i -X POST https://<dist>/graphql/investor` with introspection → AppSync responds (auth-rejected likely; reachability confirms the rewrite).

## 11. Open questions

None. All three load-bearing decisions resolved during brainstorming:

- **Catalog source:** hardcoded inside `services/investor/investor-web/src/mfe-catalog.ts`. `libs/frontend-deps` stays the federation-contract owner per charter Pillar 2; it does not absorb the catalog.
- **Cold-start ordering:** Phase 4 re-deploy of investor-web, mirroring the existing hub re-deploy pattern in `deploy.sh`. Gated by a CDK context flag `mfeBehaviors` (default `false`).
- **Origin hostnames:** new `api/apiId` SSM export added to the `Facade` construct; investor-web composes hostnames as `<id>.appsync-api.<region>.amazonaws.com` and `<id>.appsync-realtime-api.<region>.amazonaws.com`. Existing `api/graphqlUrl` and `api/realtimeUrl` exports remain for B3.

## 12. What this design unblocks

- **B3** (Apollo per-MFE client refactor) — depends on B1 + A2.
- **B4** (shell deploy migration) — depends on A1 + A4, runs in parallel with B1.
- **C1** (Playwright e2e resume) — depends on all of Phase B.
- Final CSP tightening to `connect-src 'self'` — post-B3.
