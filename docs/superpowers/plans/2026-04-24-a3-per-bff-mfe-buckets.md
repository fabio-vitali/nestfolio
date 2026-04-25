# A3 — Per-BFF MFE bucket provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each of the 5 BFFs (`investor-bff`, `advisory-bff`, `ledger-bff`, `dashboard-bff`, `onboarding-bff`) provisions its own MFE S3 bucket with a CloudFront-OAC bucket policy and SSM exports, all driven by a shared `MfeBucket` construct.

**Architecture:** New `MfeBucket` extension construct in `libs/cdk-constructs/src/extensions/mfe-bucket.ts` provisions the bucket, reads `web/distributionId` from SSM (newly exported by `investor-web`), grants CloudFront `s3:GetObject` scoped via `aws:SourceArn`, and SSM-exports `mfe/bucketName` + `mfe/key` at service-scoped paths. `Facade` is extended to also SSM-export `api/realtimeUrl` from `CfnGraphQLApi.attrRealtimeUrl`. `NamingService` gains an `mfeBucketName(account, mfeKey)` helper mirroring the existing `kbBucketName` precedent. Each BFF stack adds one line.

**Tech Stack:** AWS CDK v2 (TypeScript), `aws-cdk-lib/aws-s3` + `aws-cdk-lib/aws-iam` + `aws-cdk-lib/aws-ssm` + `aws-cdk-lib/aws-appsync`, Jest with `aws-cdk-lib/assertions` (`Template`, `Match`), pnpm Nx workspace.

**Spec:** `docs/superpowers/specs/2026-04-25-a3-per-bff-mfe-buckets-design.md`

**Charter sections realized:** §5 row 9b, §6 BFF charter, §7 R6 `/mfe/<key>/*` row.

---

## File map

**Create:**
- `libs/cdk-constructs/src/extensions/mfe-bucket.ts` — `MfeBucket` construct
- `libs/cdk-constructs/test/extensions/mfe-bucket.test.ts` — unit tests for `MfeBucket`

**Modify:**
- `libs/cdk-constructs/src/utils/naming-service.ts` — add `mfeBucketName(account, mfeKey)`
- `libs/cdk-constructs/test/utils/naming-service.test.ts` — assert new method
- `libs/cdk-constructs/src/extensions/index.ts` — re-export `MfeBucket`
- `libs/cdk-constructs/src/core/facade.ts` — also SSM-export `api/realtimeUrl`
- `libs/cdk-constructs/test/core/facade.test.ts` — assert new SSM export
- `services/investor/investor-web/src/service.stack.ts` — also SSM-export `web/distributionId`
- `services/investor/investor-web/test/unit/service.stack.test.ts` — assert new SSM export
- `services/investor/investor-bff/src/service.stack.ts` — instantiate `MfeBucket({ mfeKey: 'investor' })`
- `services/advisory/advisory-bff/src/service.stack.ts` — instantiate `MfeBucket({ mfeKey: 'advisory' })`
- `services/ledger/ledger-bff/src/service.stack.ts` — instantiate `MfeBucket({ mfeKey: 'ledger' })`
- `services/investor/dashboard-bff/src/service.stack.ts` — instantiate `MfeBucket({ mfeKey: 'dashboard' })`
- `services/investor/onboarding-bff/src/service.stack.ts` — instantiate `MfeBucket({ mfeKey: 'onboarding' })`
- `services/investor/investor-web/CLAUDE.md` — note `web/distributionId` export
- `services/investor/investor-bff/CLAUDE.md` — note MFE bucket + `mfe/*` exports
- `services/advisory/advisory-bff/CLAUDE.md` — same
- `services/ledger/ledger-bff/CLAUDE.md` — same
- `services/investor/dashboard-bff/CLAUDE.md` — same
- `services/investor/onboarding-bff/CLAUDE.md` — same
- `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_mfe_charter_migration.md` — append A3 ship entry

---

## Task 1: NamingService — `mfeBucketName(account, mfeKey)`

**Files:**
- Modify: `libs/cdk-constructs/src/utils/naming-service.ts`
- Test: `libs/cdk-constructs/test/utils/naming-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe('NamingService', () => { ... })` block in `libs/cdk-constructs/test/utils/naming-service.test.ts`, just after the existing `kbBucketName` test (line 77):

```typescript
  it('generates MFE bucket name with account, prefix, and MFE key', () => {
    const naming = new NamingService({ prefix: 'dev', subsystem: 'investor', service: 'investor-bff' });
    expect(naming.mfeBucketName('123456789012', 'investor')).toBe('123456789012-dev-nestfolio-mfe-investor');
  });

  it('generates MFE bucket name for sandbox prefix', () => {
    const naming = new NamingService({ prefix: 'sandbox-pr-42', subsystem: 'advisory', service: 'advisory-bff' });
    expect(naming.mfeBucketName('123456789012', 'advisory')).toBe('123456789012-sandbox-pr-42-nestfolio-mfe-advisory');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=naming-service`
Expected: FAIL — `naming.mfeBucketName is not a function`.

- [ ] **Step 3: Add the method**

In `libs/cdk-constructs/src/utils/naming-service.ts`, add this method to the `NamingService` class immediately after the existing `kbBucketName` method (around line 85):

```typescript
  /** MFE hosting S3 bucket name: "{account}-{prefix}-nestfolio-mfe-{mfeKey}" */
  mfeBucketName(account: string, mfeKey: string): string {
    return `${account}-${this.prefix}-nestfolio-mfe-${mfeKey}`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=naming-service`
Expected: PASS — both new assertions green; existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/naming-service.ts libs/cdk-constructs/test/utils/naming-service.test.ts
git commit -m "feat(a3-per-bff-mfe-buckets): add NamingService.mfeBucketName helper

Mirrors the kbBucketName precedent. Used by the upcoming MfeBucket
construct to name per-MFE hosting buckets globally-uniquely as
\"{account}-{prefix}-nestfolio-mfe-{mfeKey}\".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: MfeBucket extension construct

**Files:**
- Create: `libs/cdk-constructs/src/extensions/mfe-bucket.ts`
- Create: `libs/cdk-constructs/test/extensions/mfe-bucket.test.ts`
- Modify: `libs/cdk-constructs/src/extensions/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/cdk-constructs/test/extensions/mfe-bucket.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ServiceStack } from '../../src/core/service-stack';
import { MfeBucket } from '../../src/extensions/mfe-bucket';

function synthMfeBucket(opts: { prefix?: string; mfeKey?: string } = {}): Template {
  const app = new App();
  const stack = new ServiceStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    prefix: opts.prefix ?? 'dev',
    subsystem: 'investor',
    service: 'investor-bff',
    observability: false,
  });
  new MfeBucket(stack, 'MfeBucket', { mfeKey: opts.mfeKey ?? 'investor' });
  return Template.fromStack(stack);
}

describe('MfeBucket construct', () => {
  it('creates exactly 1 S3 bucket', () => {
    const template = synthMfeBucket();
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('creates an S3 bucket with S3-managed encryption and all-public-access blocked', () => {
    const template = synthMfeBucket();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('names the bucket per NamingService.mfeBucketName', () => {
    const template = synthMfeBucket({ prefix: 'dev', mfeKey: 'advisory' });
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: '123456789012-dev-nestfolio-mfe-advisory',
    });
  });

  it('uses RemovalPolicy DESTROY in non-prod', () => {
    const template = synthMfeBucket({ prefix: 'dev' });
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  it('uses RemovalPolicy RETAIN in prod', () => {
    const template = synthMfeBucket({ prefix: 'prod' });
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('grants CloudFront OAC s3:GetObject scoped via AWS:SourceArn', () => {
    const template = synthMfeBucket();
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 's3:GetObject',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Condition: {
              StringEquals: {
                'AWS:SourceArn': Match.anyValue(),
              },
            },
          }),
        ]),
      }),
    });
  });

  it('exports mfe/bucketName SSM parameter at service-scoped path', () => {
    const template = synthMfeBucket();
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/dev-investor-bff/mfe/bucketName',
    });
  });

  it('exports mfe/key SSM parameter at service-scoped path with the literal key', () => {
    const template = synthMfeBucket({ mfeKey: 'dashboard' });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: Match.stringLikeRegexp('/mfe/key$'),
      Value: 'dashboard',
    });
  });

  it('exposes bucket and mfeKey on the construct instance', () => {
    const app = new App();
    const stack = new ServiceStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      prefix: 'dev',
      subsystem: 'investor',
      service: 'investor-bff',
      observability: false,
    });
    const mfeBucket = new MfeBucket(stack, 'MfeBucket', { mfeKey: 'investor' });
    expect(mfeBucket.mfeKey).toBe('investor');
    expect(mfeBucket.bucket).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=mfe-bucket`
Expected: FAIL — module `../../src/extensions/mfe-bucket` does not exist.

- [ ] **Step 3: Create the construct**

Create `libs/cdk-constructs/src/extensions/mfe-bucket.ts`:

```typescript
import { Construct } from 'constructs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess, IBucket } from 'aws-cdk-lib/aws-s3';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServiceStack } from '../core/service-stack';

export interface MfeBucketProps {
  /** URL key under `/mfe/<key>/*` (e.g. 'investor', 'advisory'). */
  readonly mfeKey: string;
}

/**
 * Per-MFE S3 bucket owned by a BFF stack.
 *
 * Provisions:
 * - An S3 bucket named via NamingService.mfeBucketName(account, mfeKey).
 * - A bucket policy granting cloudfront.amazonaws.com s3:GetObject, scoped via
 *   AWS:SourceArn to the investor-web CloudFront distribution (id resolved from
 *   SSM at deploy-time).
 * - SSM exports `mfe/bucketName` and `mfe/key` at service-scoped paths so the
 *   investor-web CloudFront stack (B1) can discover origins per BFF.
 *
 * Charter §5 row 9b, §6 BFF charter, §7 R6.
 */
export class MfeBucket extends Construct {
  readonly bucket: IBucket;
  readonly mfeKey: string;

  constructor(scope: Construct, id: string, props: MfeBucketProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { naming, prefix } = serviceStack;
    const account = Stack.of(this).account;
    this.mfeKey = props.mfeKey;

    const isProd = prefix === 'prod';

    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: naming.mfeBucketName(account, props.mfeKey),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // CloudFront OAC bucket policy. The distribution lives in investor-web
    // (charter §5 row 9a). Its id is exported to SSM by investor-web at the
    // canonical subsystem-scoped path.
    const distributionId = StringParameter.valueForStringParameter(
      this, `/nestfolio/${prefix}-investor/web/distributionId`,
    );
    const distributionArn = `arn:aws:cloudfront::${account}:distribution/${distributionId}`;

    this.bucket.addToResourcePolicy(new PolicyStatement({
      principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
      actions: ['s3:GetObject'],
      resources: [`${this.bucket.bucketArn}/*`],
      conditions: {
        StringEquals: { 'AWS:SourceArn': distributionArn },
      },
    }));

    new StringParameter(this, 'BucketNameParam', {
      parameterName: naming.ssmServicePath('mfe/bucketName'),
      stringValue: this.bucket.bucketName,
      description: `MFE S3 bucket for ${props.mfeKey}`,
    });

    new StringParameter(this, 'KeyParam', {
      parameterName: naming.ssmServicePath('mfe/key'),
      stringValue: props.mfeKey,
      description: `MFE URL key for ${naming.service}`,
    });
  }
}
```

- [ ] **Step 4: Re-export from extensions index**

In `libs/cdk-constructs/src/extensions/index.ts`, add the export at the end of the file:

```typescript
export { MfeBucket, MfeBucketProps } from './mfe-bucket';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=mfe-bucket`
Expected: PASS — all 8 assertions green.

- [ ] **Step 6: Run all cdk-constructs tests to confirm no regression**

Run: `pnpm nx test cdk-constructs`
Expected: PASS — full suite green.

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/extensions/mfe-bucket.ts \
        libs/cdk-constructs/src/extensions/index.ts \
        libs/cdk-constructs/test/extensions/mfe-bucket.test.ts
git commit -m "feat(a3-per-bff-mfe-buckets): add MfeBucket extension construct

Provisions per-MFE S3 bucket + CloudFront-OAC bucket policy + SSM exports
mfe/bucketName + mfe/key at service-scoped paths. Reads investor-web's
web/distributionId from SSM at deploy-time to scope the OAC policy.

Charter §5 row 9b, §6 BFF charter, §7 R6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Facade — also SSM-export `api/realtimeUrl`

**Files:**
- Modify: `libs/cdk-constructs/src/core/facade.ts`
- Test: `libs/cdk-constructs/test/core/facade.test.ts`

- [ ] **Step 1: Write the failing test**

In `libs/cdk-constructs/test/core/facade.test.ts`, immediately after the existing `it('creates SSM parameter when API exists', ...)` test (around line 161), add:

```typescript
  it('creates an SSM parameter for api/realtimeUrl', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-test-svc/api/realtimeUrl',
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=facade`
Expected: FAIL — no SSM::Parameter with `Name: /nestfolio/test-test-svc/api/realtimeUrl` exists.

- [ ] **Step 3: Update Facade to also export realtimeUrl**

In `libs/cdk-constructs/src/core/facade.ts`:

(a) Add the `CfnGraphQLApi` import to the existing `aws-cdk-lib/aws-appsync` import block at the top of the file (around lines 4–14):

```typescript
import {
  GraphqlApi,
  SchemaFile,
  AuthorizationType,
  MappingTemplate,
  AppsyncFunction,
  Code,
  FunctionRuntime,
  Resolver,
  BaseDataSource,
  CfnGraphQLApi,
} from 'aws-cdk-lib/aws-appsync';
```

(b) Replace the existing SSM-export block (lines 209–215) with:

```typescript
    // Store API URLs in SSM
    if (this.api) {
      new StringParameter(this, 'ApiUrlParam', {
        parameterName: naming.ssmServicePath('api/graphqlUrl'),
        stringValue: this.api.graphqlUrl,
        description: `AppSync GraphQL URL for ${id}`,
      });
      const cfnApi = this.api.node.defaultChild as CfnGraphQLApi;
      new StringParameter(this, 'ApiRealtimeUrlParam', {
        parameterName: naming.ssmServicePath('api/realtimeUrl'),
        stringValue: cfnApi.attrRealtimeUrl,
        description: `AppSync realtime (WSS) URL for ${id}`,
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=facade`
Expected: PASS — both the existing `api/graphqlUrl` test and the new `api/realtimeUrl` test green.

- [ ] **Step 5: Run all cdk-constructs tests to confirm no regression**

Run: `pnpm nx test cdk-constructs`
Expected: PASS — full suite green.

- [ ] **Step 6: Commit**

```bash
git add libs/cdk-constructs/src/core/facade.ts libs/cdk-constructs/test/core/facade.test.ts
git commit -m "feat(a3-per-bff-mfe-buckets): Facade exports api/realtimeUrl SSM param

Sourced from CfnGraphQLApi.attrRealtimeUrl (canonical CloudFormation
attribute). Pairs with the existing api/graphqlUrl export so B1's
CloudFront stack can discover both origins per BFF at synth-time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: investor-web — also SSM-export `web/distributionId`

**Files:**
- Modify: `services/investor/investor-web/src/service.stack.ts`
- Test: `services/investor/investor-web/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write the failing test**

In `services/investor/investor-web/test/unit/service.stack.test.ts`, find the top-level `describe` block. Inside the existing block (after the last existing `it(...)`), add:

```typescript
  it('exports web/distributionId SSM parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-investor/web/distributionId',
    });
  });
```

Note: this assumes the existing test file already defines a `template` variable in scope from a `beforeAll`/`beforeEach`. Open the file first and confirm — if not, mirror the existing test setup pattern that other `it` blocks use.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-web`
Expected: FAIL — no `AWS::SSM::Parameter` with name `/nestfolio/test-investor/web/distributionId`.

- [ ] **Step 3: Add the SSM parameter**

In `services/investor/investor-web/src/service.stack.ts`, find the SSM-export block at the bottom of the constructor (around lines 222–233). After the existing `DistributionUrlParam` block, append:

```typescript
    new StringParameter(this, 'DistributionIdParam', {
      parameterName: this.naming.ssmParameterPath('web/distributionId'),
      stringValue: distribution.distributionId,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test investor-web`
Expected: PASS — new assertion green; existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts \
        services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "feat(a3-per-bff-mfe-buckets): investor-web exports web/distributionId

Subsystem-scoped at /nestfolio/{prefix}-investor/web/distributionId,
parallel to the existing web/distributionUrl. Consumed by each BFF's
MfeBucket construct to scope the CloudFront-OAC bucket policy via
AWS:SourceArn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire MfeBucket into all 5 BFF stacks

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`
- Modify: `services/ledger/ledger-bff/src/service.stack.ts`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts`
- Modify: `services/investor/onboarding-bff/src/service.stack.ts`

This task is mechanical — one line per stack. No new tests are added; the construct's behaviour is already covered by Task 2's unit tests. Synth verification is done in Task 6.

- [ ] **Step 1: investor-bff**

In `services/investor/investor-bff/src/service.stack.ts`:

(a) Update the `@nestfolio/cdk-constructs` import line (the existing `import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';`) and add a separate import line for `MfeBucket` from extensions:

```typescript
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
```

(b) Inside the constructor, immediately before the final `this.addObservability({ ingress, egress });` call, add:

```typescript
    new MfeBucket(this, 'MfeBucket', { mfeKey: 'investor' });
```

- [ ] **Step 2: advisory-bff**

In `services/advisory/advisory-bff/src/service.stack.ts`:

(a) Add to the imports:

```typescript
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
```

(b) Inside the constructor, immediately before the final `this.addObservability({ ingress, egress });` call, add:

```typescript
    new MfeBucket(this, 'MfeBucket', { mfeKey: 'advisory' });
```

- [ ] **Step 3: ledger-bff**

In `services/ledger/ledger-bff/src/service.stack.ts`:

(a) The file already imports from `@nestfolio/cdk-constructs/extensions` (`getDomainAccounts`, `resolveBusArn`). Add `MfeBucket` to that existing import:

```typescript
import { getDomainAccounts, resolveBusArn, MfeBucket } from '@nestfolio/cdk-constructs/extensions';
```

(b) Inside the constructor, immediately before the final `this.addObservability({ ingress, extraLambdas: [resolver] });` call, add:

```typescript
    new MfeBucket(this, 'MfeBucket', { mfeKey: 'ledger' });
```

- [ ] **Step 4: dashboard-bff**

In `services/investor/dashboard-bff/src/service.stack.ts`:

(a) Add a new import line:

```typescript
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
```

(b) Inside the constructor, immediately before the final `this.addObservability({ ingress });` call, add:

```typescript
    new MfeBucket(this, 'MfeBucket', { mfeKey: 'dashboard' });
```

- [ ] **Step 5: onboarding-bff**

In `services/investor/onboarding-bff/src/service.stack.ts`:

(a) The file already imports `AgentRuntime, KnowledgeBase` from `@nestfolio/cdk-constructs/extensions`. Extend that import:

```typescript
import { AgentRuntime, KnowledgeBase, MfeBucket } from '@nestfolio/cdk-constructs/extensions';
```

(b) Inside the constructor, after the `Egress` instantiation (just after the closing `});` of `new Egress(...)` around line 25) and before the model-IDs block, add:

```typescript
    new MfeBucket(this, 'MfeBucket', { mfeKey: 'onboarding' });
```

- [ ] **Step 6: Run unit tests for all five BFFs**

Run: `pnpm nx run-many --target=test --projects=investor-bff,advisory-bff,ledger-bff,dashboard-bff,onboarding-bff`
Expected: PASS for all five. (Existing stack tests use `hasResourceProperties` not exact resource counts, so adding new resources should not break them.)

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts \
        services/advisory/advisory-bff/src/service.stack.ts \
        services/ledger/ledger-bff/src/service.stack.ts \
        services/investor/dashboard-bff/src/service.stack.ts \
        services/investor/onboarding-bff/src/service.stack.ts
git commit -m "feat(a3-per-bff-mfe-buckets): wire MfeBucket into 5 BFF stacks

investor-bff (mfeKey=investor), advisory-bff (advisory), ledger-bff
(ledger), dashboard-bff (dashboard), onboarding-bff (onboarding). Each
BFF now owns its MFE's S3 bucket + OAC bucket policy + mfe/* SSM exports.
Buckets exist but are not yet wired into CloudFront — that is B1.

Charter §6 BFF charter (vertical-slice ownership).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: cdk synth verification

**Files:** none modified — verification only.

This catches any token-resolution or wiring issue that the unit-test stacks did not surface (real `cdk synth` exercises path-alias resolution, real CDK app context, real cross-stack SSM token serialization).

- [ ] **Step 1: Verify each BFF synthesises**

Run from the workspace root:

```bash
pnpm nx run-many --target=synth --projects=investor-bff,advisory-bff,ledger-bff,dashboard-bff,onboarding-bff,investor-web --configuration=sandbox
```

If a `synth` target does not exist on every BFF, fall back to per-service `cdk synth` invocations using the deploy script:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,advisory-bff,ledger-bff,dashboard-bff,onboarding-bff,investor-web --synth-only
```

(Confirm `--synth-only` exists in the script; if not, use `cdk synth` with `ts-node -r ./tools/register-paths.js` per the memory note on path-alias resolution.)

Expected: synth succeeds for every project. No new errors.

- [ ] **Step 2: Spot-check the synthesised templates**

For one BFF (e.g. `investor-bff`), inspect the synthesised CloudFormation template and confirm:

- One `AWS::S3::Bucket` resource with `BucketName` containing `nestfolio-mfe-investor`.
- One `AWS::S3::BucketPolicy` referencing that bucket with a `Condition.StringEquals['AWS:SourceArn']` token.
- Two new `AWS::SSM::Parameter` resources at paths ending `mfe/bucketName` and `mfe/key`.
- One new `AWS::SSM::Parameter` at path ending `api/realtimeUrl`.

Use whatever inspection tooling matches the workspace; `jq` over `cdk.out/*.template.json` works.

- [ ] **Step 3: No commit**

This task is verification only; nothing to commit. Move on.

---

## Task 7: Update service CLAUDE.md cards

**Files:**
- Modify: `services/investor/investor-web/CLAUDE.md`
- Modify: `services/investor/investor-bff/CLAUDE.md`
- Modify: `services/advisory/advisory-bff/CLAUDE.md`
- Modify: `services/ledger/ledger-bff/CLAUDE.md`
- Modify: `services/investor/dashboard-bff/CLAUDE.md`
- Modify: `services/investor/onboarding-bff/CLAUDE.md`

Service cards are the per-service summary loaded into context when work touches that service. Each card needs an entry for the new MFE bucket and SSM exports.

- [ ] **Step 1: investor-web**

In `services/investor/investor-web/CLAUDE.md`, find the section `## SSM Parameters Published` and append a line so it reads:

```
## SSM Parameters Published
- auth/userPoolId
- auth/userPoolClientId
- web/distributionUrl
- web/distributionId
```

- [ ] **Step 2: investor-bff**

In `services/investor/investor-bff/CLAUDE.md`, add a new section just before `## Tests`:

```
## MFE Hosting
- MfeBucket (mfeKey=investor): S3 bucket "{account}-{prefix}-nestfolio-mfe-investor"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key
```

- [ ] **Step 3: advisory-bff**

In `services/advisory/advisory-bff/CLAUDE.md`, add the same `## MFE Hosting` + `## SSM Parameters Published` block (with `mfeKey=advisory` and bucket name `{account}-{prefix}-nestfolio-mfe-advisory`) just before the existing `## Tests` section.

- [ ] **Step 4: ledger-bff**

In `services/ledger/ledger-bff/CLAUDE.md`, add the same block (with `mfeKey=ledger`) just before `## Tests`.

- [ ] **Step 5: dashboard-bff**

In `services/investor/dashboard-bff/CLAUDE.md`, add the same block (with `mfeKey=dashboard`) just before `## Tests`.

- [ ] **Step 6: onboarding-bff**

In `services/investor/onboarding-bff/CLAUDE.md`, add a slightly different block — onboarding-bff has no Facade so there is no `api/*` export. Add just before `## Tests`:

```
## MFE Hosting
- MfeBucket (mfeKey=onboarding): S3 bucket "{account}-{prefix}-nestfolio-mfe-onboarding"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key
  - No api/graphqlUrl or api/realtimeUrl: this MFE talks to onboarding-bff via the CopilotKit /api/copilotkit* bridge (charter §7 R6 row 5), not /graphql/onboarding

## SSM Parameters Published
- mfe/bucketName
- mfe/key
- agent/runtimeUrl (existing)
```

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-web/CLAUDE.md \
        services/investor/investor-bff/CLAUDE.md \
        services/advisory/advisory-bff/CLAUDE.md \
        services/ledger/ledger-bff/CLAUDE.md \
        services/investor/dashboard-bff/CLAUDE.md \
        services/investor/onboarding-bff/CLAUDE.md
git commit -m "docs(a3-per-bff-mfe-buckets): regenerate service cards for MFE bucket ownership

Each BFF service card now lists the MfeBucket construct and the new mfe/*
SSM exports. investor-web's card lists the new web/distributionId export.
onboarding-bff's card calls out the no-Facade asymmetry: it exports
mfe/bucketName + mfe/key only and is routed through CopilotKit, not
/graphql/onboarding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update memory — A3 ship entry

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_mfe_charter_migration.md`
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` (one-line ship summary under "Recently Completed Work")

- [ ] **Step 1: Append to project_mfe_charter_migration.md**

Open `memory/project_mfe_charter_migration.md` and append a new "A3 — SHIPPED 2026-04-25" entry under the running "Roadmap progress" or equivalent section (mirror the layout of the A1 + A2 entries already present). Include:

- Branch name (whatever was used to ship — likely `feat/a3-per-bff-mfe-buckets`).
- One-line scope: "Each BFF stack provisions its MFE's S3 bucket + CloudFront-OAC bucket policy + SSM exports of mfe/bucketName, mfe/key, api/realtimeUrl. investor-web also exports web/distributionId."
- Three call-outs:
  1. New extension construct `MfeBucket` in libs/cdk-constructs.
  2. NamingService gains `mfeBucketName(account, mfeKey)` mirroring `kbBucketName`.
  3. onboarding-bff has no AppSync — exports `mfe/*` only (charter §7 R6 row 5 routes it through CopilotKit).
- Note that B1 (CloudFront unification) is now unblocked.

- [ ] **Step 2: Update MEMORY.md "Recently Completed Work" section**

In `memory/MEMORY.md`, prepend (above the existing A2 ship entry) a one-line summary:

```markdown
- **A3 — Per-BFF MFE bucket provisioning** — SHIPPED 2026-04-25 on branch `feat/a3-per-bff-mfe-buckets`: new `MfeBucket` construct in `libs/cdk-constructs/extensions` provisions per-MFE S3 bucket + CloudFront-OAC bucket policy + SSM exports (`mfe/bucketName`, `mfe/key`); Facade now exports `api/realtimeUrl`; investor-web exports `web/distributionId`. All 5 BFFs wired. Buckets dormant until B1 wires CloudFront origins. Third ship in the MFE charter migration roadmap. See `project_mfe_charter_migration.md`.
```

- [ ] **Step 3: No commit (memory files are not in the repo)**

Memory files live outside the repo. They are persisted automatically by the harness — no `git add` needed.

---

## Self-review checklist

- [ ] All spec sections mapped to tasks: §4.1 MfeBucket (Task 2), §4.2 NamingService (Task 1), §4.3 Facade realtimeUrl (Task 3), §4.4 investor-web distributionId (Task 4), §4.5 onboarding exception (Task 5 step 5 + Task 7 step 6), §4.6 BFF call sites (Task 5), §4.7 SSM paths (Tasks 1–4), §4.8 coexistence (no code change — investor-web's existing assetsBucket is left untouched in Task 4).
- [ ] No placeholders, no "fill in" steps. Every code block is the literal content to write.
- [ ] Type names and method signatures consistent across tasks: `MfeBucketProps.mfeKey` (Task 2) → used consistently in Task 5; `naming.mfeBucketName(account, mfeKey)` (Task 1) → called in Task 2; `naming.ssmServicePath('mfe/bucketName')` and `naming.ssmServicePath('mfe/key')` and `naming.ssmServicePath('api/realtimeUrl')` and `naming.ssmParameterPath('web/distributionId')` are all consistent with the existing NamingService API.
- [ ] Each task ends with a commit (Tasks 1–5, 7). Task 6 is verification-only; Task 8 is memory-only.
- [ ] TDD discipline: Tasks 1, 2, 3, 4 follow write-failing-test → run → implement → run → commit. Task 5 is mechanical wiring covered by Task 2's tests + Task 6's synth. Task 7 is documentation. Task 8 is memory.
