# A3 — Per-BFF MFE bucket provisioning — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-25
**Type:** Sub-plan design under the MFE charter migration roadmap.
**References:**
- Charter: [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md) — §5 row 9b + §6 BFF charter + §7 R6
- Roadmap: [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) — A3
- Predecessor (A2 shipped): [`docs/superpowers/specs/2026-04-25-a2-frontend-deps-lib-design.md`](./2026-04-25-a2-frontend-deps-lib-design.md)

## 1. Problem

The MFE charter (§5 row 9b, §6 BFF charter) places ownership of each MFE's S3 hosting bucket on its BFF stack — a vertical-slice split where the team that owns the BFF also owns the bucket the MFE is served from. Today:

- Only `investor-web` provisions a bucket (the shell's `assetsBucket`); no per-MFE buckets exist.
- The legacy `BucketDeployment` in `investor-web` deploys the shell to that single bucket.
- No bucket policy grants CloudFront OAC access to anything per-domain.
- B1's CloudFront unification (charter §7 R6) needs to add `/mfe/<key>/*` behaviors with each BFF's bucket as origin — but those buckets do not exist yet.

A3 closes the gap by making each BFF stack the sole owner of its MFE's bucket, bucket policy, and the per-MFE SSM exports B1 will read at synth time. After A3 lands, B1 becomes a wiring-only change in `investor-web`.

## 2. Goals

- Each of the 5 BFFs (`investor-bff`, `advisory-bff`, `ledger-bff`, `dashboard-bff`, `onboarding-bff`) provisions one S3 bucket dedicated to its MFE bundle.
- Each bucket carries a bucket policy granting `cloudfront.amazonaws.com` `s3:GetObject`, scoped via `aws:SourceArn` to the existing `investor-web` distribution. Policy lands in A3, not B1.
- Per-BFF SSM exports stabilize: `mfe/bucketName` + `mfe/key` (new), `api/graphqlUrl` (already there), `api/realtimeUrl` (new, for the 4 BFFs that have AppSync).
- Single shared `MfeBucket` extension construct in `libs/cdk-constructs`; one synth-asserted unit test; reused by 5 BFFs.
- B1 unblocked: it can iterate the 5 MFE keys and SSM-resolve everything it needs at synth time.

## 3. Non-goals

- CloudFront origin/behavior wiring for `/mfe/<key>/*` and `/graphql/<domain>` and `/realtime/<domain>` (B1).
- Replacing `investor-web`'s existing `BucketDeployment` for the shell (B4).
- Per-app `deploy` Nx targets that `aws s3 sync` MFE bundles into these new buckets (deferred — sequenced after B1 because the deploy target needs the CloudFront invalidation step that B1 introduces).
- Migrating `onboarding-bff` to AppSync (orthogonal; see §4.5).
- Migrating `investor-web`'s shell `assetsBucket` from OAI to OAC (B1 may do this; A3 leaves it untouched).
- Versioning, lifecycle policies, replication on the new MFE buckets (out of scope; bundles are fully replaced on each deploy).

## 4. Decisions

### 4.1 New `MfeBucket` extension construct

**Location:** `libs/cdk-constructs/src/extensions/mfe-bucket.ts`. Re-exported from `extensions/index.ts`. Mirrors how `AgentRuntime`, `KnowledgeBase` live in `extensions/` but are owned (instantiated + wired) by service stacks.

**Props:**

```ts
export interface MfeBucketProps {
  /** URL key under `/mfe/<key>/*` (e.g. 'investor', 'advisory'). */
  readonly mfeKey: string;
}
```

**Construct responsibilities:**

1. Provision an `s3.Bucket` named via `naming.mfeBucketName(account, mfeKey)` (see §4.2). Same hardening as `investor-web`'s `assetsBucket`: `BucketEncryption.S3_MANAGED`, `BlockPublicAccess.BLOCK_ALL`, `RemovalPolicy.DESTROY` + `autoDeleteObjects: true` for non-prod, `RemovalPolicy.RETAIN` for `prefix === 'prod'`. No versioning.
2. Read `web/distributionId` from SSM at the canonical `investor-web`-subsystem-scoped path `/nestfolio/{prefix}-investor/web/distributionId` (provisioned by §4.4). Resolution is deploy-time (`StringParameter.valueForStringParameter`).
3. Add a bucket policy: `Allow s3:GetObject` with `Service: cloudfront.amazonaws.com` principal, `Resource: ${bucket.bucketArn}/*`, `Condition: { StringEquals: { 'AWS:SourceArn': arn:aws:cloudfront::{account}:distribution/{distId} } }`. Tokens flow through CDK without issue (CloudFormation resolves at deploy-time).
4. SSM-export two parameters at service-scoped paths via `naming.ssmServicePath(...)`:
   - `mfe/bucketName` → the bucket's name
   - `mfe/key` → the URL key (string literal supplied via props)

**Public surface:**

```ts
export class MfeBucket extends Construct {
  readonly bucket: IBucket;
  readonly mfeKey: string;
}
```

`bucket` is exposed so a future per-MFE deploy target (sequenced post-B1) can grant put permissions to a deploy role without re-resolving from SSM.

### 4.2 NamingService extension

Add one method to `libs/cdk-constructs/src/utils/naming-service.ts`:

```ts
/** MFE hosting S3 bucket name: "{account}-{prefix}-nestfolio-mfe-{mfeKey}" */
mfeBucketName(account: string, mfeKey: string): string {
  return `${account}-${this.prefix}-nestfolio-mfe-${mfeKey}`;
}
```

Mirrors the existing `kbBucketName` precedent. Account prefix gives global uniqueness across multiple deploys to the same account; lower-case ASCII for all 5 MFE keys is S3-name-safe.

### 4.3 Facade exports realtimeUrl

Modify `libs/cdk-constructs/src/core/facade.ts` to also SSM-publish `api/realtimeUrl` alongside the existing `api/graphqlUrl` export. Source: `(this.api.node.defaultChild as CfnGraphQLApi).attrRealtimeUrl` — the canonical CloudFormation attribute, not a `replace('appsync-api', 'appsync-realtime-api')` heuristic.

This change is BFF-scoped: only the 4 BFFs that instantiate Facade (`investor-bff`, `advisory-bff`, `ledger-bff`, `dashboard-bff`) gain the new export. `onboarding-bff` has no Facade and so emits no `api/*` exports.

### 4.4 investor-web exports distributionId

One additive SSM parameter in `services/investor/investor-web/src/service.stack.ts`:

```ts
new StringParameter(this, 'DistributionIdParam', {
  parameterName: this.naming.ssmParameterPath('web/distributionId'),
  stringValue: distribution.distributionId,
});
```

Path is subsystem-scoped (`/nestfolio/{prefix}-investor/web/distributionId`), parallel to the existing `web/distributionUrl`. `investor-web` stays exclusively the CloudFront owner; it now publishes the distribution id alongside the URL so downstream BFFs can construct the distribution ARN.

### 4.5 onboarding-bff exception

`onboarding-bff` has no Facade — its MFE talks to it through CopilotKit's `/api/copilotkit*` rewrite (charter §7 R6 row 5), not `/graphql/onboarding`. A3 handles this by:

- Onboarding-bff instantiates `MfeBucket` for the bucket + `mfe/bucketName` + `mfe/key` exports.
- It does **not** export `api/graphqlUrl` or `api/realtimeUrl` (because there is no Facade).
- B1's iteration over MFE keys will discover this asymmetry by absence: it reads `mfe/bucketName` for all 5 keys; only 4 keys yield `api/graphqlUrl`; the onboarding key is routed through the existing CopilotKit origin instead.

Charter §5 row 9b's wording (`{bucketName, graphqlUrl, realtimeUrl}` for "each BFF") is universal in tone but the charter §7 R6 already documents the CopilotKit exception. No charter amendment is needed; this design notes the asymmetry as a known and intended consequence.

### 4.6 BFF stack call sites

Each BFF stack adds one line. The `mfeKey` is **explicit** (not derived from the service name) — `dashboard-bff` lives in `services/investor/` but its key is `dashboard`, which directory-derivation would get wrong. Explicit beats clever:

```ts
// services/investor/investor-bff/src/service.stack.ts
new MfeBucket(this, 'MfeBucket', { mfeKey: 'investor' });

// services/advisory/advisory-bff/src/service.stack.ts
new MfeBucket(this, 'MfeBucket', { mfeKey: 'advisory' });

// services/ledger/ledger-bff/src/service.stack.ts
new MfeBucket(this, 'MfeBucket', { mfeKey: 'ledger' });

// services/investor/dashboard-bff/src/service.stack.ts
new MfeBucket(this, 'MfeBucket', { mfeKey: 'dashboard' });

// services/investor/onboarding-bff/src/service.stack.ts
new MfeBucket(this, 'MfeBucket', { mfeKey: 'onboarding' });
```

### 4.7 SSM path convention

| Param | Path | Scope |
|---|---|---|
| `mfe/bucketName` | `/nestfolio/{prefix}-{service}/mfe/bucketName` | service-scoped (BFF owns it) |
| `mfe/key` | `/nestfolio/{prefix}-{service}/mfe/key` | service-scoped |
| `api/graphqlUrl` | `/nestfolio/{prefix}-{service}/api/graphqlUrl` | service-scoped (existing) |
| `api/realtimeUrl` | `/nestfolio/{prefix}-{service}/api/realtimeUrl` | service-scoped (new in A3) |
| `web/distributionId` | `/nestfolio/{prefix}-investor/web/distributionId` | subsystem-scoped (investor-web owns it; new in A3) |

All paths use `naming.ssmServicePath(...)` or `naming.ssmParameterPath(...)` already defined on `NamingService`. No new path-building primitive.

### 4.8 Coexistence with existing investor-web assetsBucket

A3 leaves `investor-web`'s `assetsBucket` and its `BucketDeployment` untouched. The shell continues to be served from `/` against that bucket. B1 will reuse `assetsBucket` for the CloudFront default behavior; per-MFE buckets serve `/mfe/<key>/*`. B4 will delete the legacy `BucketDeployment` and replace it with an explicit `aws s3 sync` deploy target. None of this is A3's concern.

## 5. Architecture and data flow

### Synth-time

```
investor-web stack
  └─ StringParameter web/distributionId  ──┐
                                            │  (SSM, subsystem-scoped)
                                            │
                                            ▼
each <domain>-bff stack
  ├─ MfeBucket
  │    ├─ s3.Bucket (named via NamingService.mfeBucketName)
  │    ├─ BucketPolicy (CloudFront OAC, scoped via AWS:SourceArn)
  │    ├─ StringParameter mfe/bucketName    (service-scoped)
  │    └─ StringParameter mfe/key           (service-scoped)
  └─ Facade (4 of 5 BFFs)
       ├─ StringParameter api/graphqlUrl    (existing)
       └─ StringParameter api/realtimeUrl   (new)
```

### Deploy order

`investor-web` must be deployed before any BFF — the deploy script already does this today (every BFF Facade reads investor-web's user pool id from SSM at deploy-time). A3 introduces no new ordering coupling: BFFs that read `web/distributionId` have the same `valueForStringParameter` semantics as the existing user-pool-id read.

### Runtime

A3 is dormant at runtime. Buckets are empty; CloudFront does not yet route to them; the bucket policy grants access to a CF distribution that does not yet have these origins. B1 wires the origins; deploy targets (post-B1) populate the buckets.

## 6. Tests

### New: `libs/cdk-constructs/test/extensions/mfe-bucket.test.ts`

Synth a minimal stack containing a `MfeBucket`. Assertions (CDK template assertions):

- One `AWS::S3::Bucket`. `BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm === 'AES256'`. `PublicAccessBlockConfiguration` all four flags `true`. Bucket name matches a `Fn::Join` template containing `nestfolio-mfe-investor`.
- One `AWS::S3::BucketPolicy` with one `Statement`: `Effect: Allow`, `Action: s3:GetObject`, `Principal.Service: cloudfront.amazonaws.com`, `Condition.StringEquals['AWS:SourceArn']` matches `arn:aws:cloudfront::*:distribution/*` (Token is fine).
- Two `AWS::SSM::Parameter` resources whose `Name` ends in `mfe/bucketName` and `mfe/key`.
- For `prefix === 'prod'`: bucket has `DeletionPolicy: Retain`. For non-prod: `DeletionPolicy: Delete`.

### Updated: `libs/cdk-constructs/test/core/facade.test.ts`

Add one assertion: after Facade synthesis, an `AWS::SSM::Parameter` exists with `Name` ending in `api/realtimeUrl`. No other test changes required.

### Updated: any service-level synth tests that count SSM params

Search for service-level synth tests under `services/*/test/unit/service.stack.test.ts` that assert exact param counts. Update each to reflect 2 new BFF params (`mfe/bucketName`, `mfe/key`) plus 1 new Facade param (`api/realtimeUrl`) where applicable. (`onboarding-bff` only adds the 2 MfeBucket params — no Facade.) If no such count assertion exists, no change needed.

### Deploy verification

`cdk synth` must succeed for every BFF after the changes. Pre-commit hook covers this implicitly via the workspace lint/build affected target.

## 7. Risks

- **`valueForStringParameter` is deploy-time, not synth-time.** Bucket policy condition references a Token (the SSM-resolved distribution id). CDK supports this — the Token serializes into the CloudFormation template as `{ "Fn::Join": [...] }` and CFN resolves it at deploy. Verified by analogy: `onboarding-bff` already uses `valueForStringParameter` for the agent-runtime ARN inside a `StringParameter` definition, and `investor-web` consumes that ARN inside a `Fn.sub` template. Same pattern.
- **OAC vs OAI mismatch.** `investor-web` today uses OAI (legacy) for the shell `assetsBucket`. The new MFE buckets' policies grant `cloudfront.amazonaws.com` (OAC pattern). B1 will create the OAC (one per origin or one shared — B1's design call) and attach it; the bucket policy already accepts any request that originates from the configured distribution. Until B1, the buckets are unreachable but valid.
- **Bucket name collision.** S3 bucket names are global across AWS. Naming uses `{account}-{prefix}-nestfolio-mfe-{mfeKey}`; the same prefix cannot deploy twice into the same account, and sandbox-PR prefixes (`sandbox-pr-42`) yield distinct names.
- **`autoDeleteObjects` in non-prod.** Same risk profile as `investor-web`'s existing `assetsBucket`. Acceptable for dev; prod gets `RemovalPolicy.RETAIN` and no auto-delete.
- **Deploy ordering regression.** If a developer destroys `investor-web` before the BFFs, the BFFs synth still works (Token is opaque), but deploy fails with a missing-SSM-param error. Acceptable: deploy already requires `investor-web` first for the user-pool path; this is an additional symptom of an existing constraint, not a new one.

## 8. Migration and rollback

- **Forward:** deploy `investor-web` first (now publishes `web/distributionId`), then BFFs in any order. Empty buckets cost ~zero. No code/config changes required for downstream consumers — the SSM exports are additive.
- **Rollback:** `cdk destroy` of any BFF removes its bucket. `autoDeleteObjects: true` ensures empty objects in non-prod. Removing the `web/distributionId` export from `investor-web` only after all BFFs are destroyed (otherwise their next synth fails to resolve the SSM token).

## 9. Open items

None. Charter is decisive on the contract; the four design questions (policy timing, onboarding-bff exception, code shape, SSM path) were resolved up-front. The implementation plan can proceed against this design as written.

## 10. References

- `libs/cdk-constructs/src/utils/naming-service.ts` — `NamingService.kbBucketName` precedent for the naming convention.
- `libs/cdk-constructs/src/core/facade.ts:208–215` — existing `api/graphqlUrl` SSM export, where `api/realtimeUrl` will be added.
- `services/investor/investor-web/src/service.stack.ts:222–233` — existing SSM exports; `web/distributionId` slots in alongside.
- `services/investor/onboarding-bff/src/service.stack.ts:54–63` — `valueForStringParameter` pattern that A3 reuses for `web/distributionId` consumption.
- Charter §5 row 9b, §6 BFF charter, §7 R6 — contract A3 implements.
