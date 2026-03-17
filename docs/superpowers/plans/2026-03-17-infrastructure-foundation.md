# Infrastructure Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add infrastructure foundations needed by all Advisory Agent Topology plans: schedule config in pipeline-defaults.json, a reusable `KnowledgeBase` CDK construct, an `AdapterSchedule` CDK construct, and the S3 bucket naming convention.

**Architecture:** Two new CDK constructs are added to `libs/cdk-constructs`: (1) `KnowledgeBase` wraps Bedrock Knowledge Base + S3 bucket + Data Source into a single construct with a `triggerSync()` helper method, and (2) `AdapterSchedule` wraps EventBridge Scheduler to invoke a Lambda on a configurable cadence, reading `schedule.enabled` and `schedule.rate` from the resolved pipeline config. The `pipeline-defaults.json` gains a `schedule` field per tier (sandbox: disabled, staging: 24h, production: 6h). The `ResolvedPipelineConfig` type is extended to include the optional `schedule` field.

**Tech Stack:** TypeScript, AWS CDK, Bedrock Agent SDK (`@aws-cdk/aws-bedrockcdk-alpha` / L1 CfnKnowledgeBase), EventBridge Scheduler, S3, Jest, `aws-cdk-lib/assertions`

**Spec:** `docs/superpowers/specs/2026-03-17-advisory-agent-topology-design.md`

**Plan sequence:** This is Plan 2 of 5. No dependencies on other plans.

---

## File Structure

### Files to CREATE

| File | Responsibility |
|---|---|
| `libs/cdk-constructs/src/knowledge-base.ts` | CDK construct: S3 bucket + Bedrock KB + Data Source + `triggerSync()` |
| `libs/cdk-constructs/src/adapter-schedule.ts` | CDK construct: EventBridge Scheduler schedule targeting a Lambda |
| `libs/cdk-constructs/test/knowledge-base.test.ts` | CDK assertion tests for KnowledgeBase construct |
| `libs/cdk-constructs/test/adapter-schedule.test.ts` | CDK assertion tests for AdapterSchedule construct |

### Files to MODIFY

| File | Change |
|---|---|
| `infrastructure/pipeline-defaults.json` | Add `schedule` field to each tier |
| `libs/cdk-constructs/src/resolve-pipeline-config.ts` | Add `schedule` to `ResolvedPipelineConfig` and `TierDefaults` |
| `libs/cdk-constructs/src/index.ts` | Export new constructs |
| `libs/cdk-constructs/src/naming-service.ts` | Add `kbBucketName(kbName)` method |

---

## Chunk 1: Configuration + CDK Constructs

### Task 1: Add `schedule` field to pipeline-defaults.json

**Files:**
- Modify: `infrastructure/pipeline-defaults.json`

- [ ] **Step 1: Add schedule config to all three tiers**

Edit `infrastructure/pipeline-defaults.json` to add the `schedule` field:

```json
{
  "$schema": "./pipeline-defaults-schema.json",
  "sandbox": {
    "observability": false,
    "logRetention": 7,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": [],
    "schedule": { "enabled": false, "rate": "rate(24 hours)" }
  },
  "staging": {
    "observability": true,
    "logRetention": 30,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": [],
    "schedule": { "enabled": true, "rate": "rate(24 hours)" }
  },
  "production": {
    "observability": true,
    "logRetention": 90,
    "protectedResources": true,
    "parallelDeploy": true,
    "alarmActions": [],
    "schedule": { "enabled": true, "rate": "rate(6 hours)" }
  }
}
```

- [ ] **Step 2: Run existing resolve-pipeline-config tests to verify no regression**

```bash
npx nx test cdk-constructs -- --testPathPattern=resolve-pipeline-config
```

Expected: PASS (existing tests still pass; `schedule` is passthrough via `mergeConfigs`).

---

### Task 2: Update resolve-pipeline-config types

**Files:**
- Modify: `libs/cdk-constructs/src/resolve-pipeline-config.ts`

- [ ] **Step 1: Add `ScheduleConfig` type and extend `ResolvedPipelineConfig`**

Add above the `ResolvedPipelineConfig` interface:

```ts
export interface ScheduleConfig {
  enabled: boolean;
  rate: string;
}
```

Add to `ResolvedPipelineConfig`:

```ts
export interface ResolvedPipelineConfig {
  service: string;
  subsystem: string;
  deploymentPhase: 1 | 2 | 3;
  dependencies: string[];
  observability: boolean;
  parallelDeploy: boolean;
  logRetention: number;
  protectedResources: boolean;
  alarmActions: string[];
  account?: string;
  region?: string;
  environment?: string;
  prefix: string;
  schedule?: ScheduleConfig;
}
```

- [ ] **Step 2: Extend `TierDefaults` to include `schedule`**

Update the `TierDefaults` type to include `schedule`:

```ts
type TierDefaults = Partial<
  Pick<
    ResolvedPipelineConfig,
    'observability' | 'parallelDeploy' | 'logRetention' | 'protectedResources' | 'alarmActions' | 'account' | 'region' | 'environment' | 'schedule'
  >
>;
```

- [ ] **Step 3: Run resolve-pipeline-config tests**

```bash
npx nx test cdk-constructs -- --testPathPattern=resolve-pipeline-config
```

Expected: PASS — the `schedule` field is picked up automatically by `mergeConfigs` because it iterates over `Object.entries(tierDefaults)`.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/pipeline-defaults.json libs/cdk-constructs/src/resolve-pipeline-config.ts
git commit -m "feat(cdk-constructs): add schedule config to pipeline-defaults and ResolvedPipelineConfig

Add ScheduleConfig type (enabled + rate) to the pipeline config system.
Tier defaults: sandbox disabled, staging 24h, production 6h.
Per-service overrides via pipeline.json are supported automatically.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `kbBucketName()` to NamingService

**Files:**
- Modify: `libs/cdk-constructs/src/naming-service.ts`

- [ ] **Step 1: Write test for kbBucketName**

Add a test to `libs/cdk-constructs/test/naming-service.test.ts`:

```ts
it('generates KB bucket name with account, prefix, and KB name', () => {
  const naming = new NamingService({ prefix: 'dev', subsystem: 'advisory', service: 'advisory-ctrl' });
  expect(naming.kbBucketName('regulatory', '123456789012')).toBe('123456789012-dev-nestfolio-kb-regulatory');
});
```

- [ ] **Step 2: Run test (verify fail)**

```bash
npx nx test cdk-constructs -- --testPathPattern=naming-service
```

Expected: FAIL — `kbBucketName` is not a function.

- [ ] **Step 3: Implement kbBucketName in NamingService**

Add to `libs/cdk-constructs/src/naming-service.ts`, inside the `NamingService` class:

```ts
/** Knowledge Base S3 bucket name: "{account}-{prefix}-nestfolio-kb-{kbName}" */
kbBucketName(kbName: string, account: string): string {
  return `${account}-${this.prefix}-nestfolio-kb-${kbName}`;
}
```

- [ ] **Step 4: Run test (verify pass)**

```bash
npx nx test cdk-constructs -- --testPathPattern=naming-service
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/naming-service.ts libs/cdk-constructs/test/naming-service.test.ts
git commit -m "feat(cdk-constructs): add kbBucketName() to NamingService

Convention: {account}-{prefix}-nestfolio-kb-{name}
Used by KnowledgeBase construct for S3 bucket naming.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create KnowledgeBase CDK construct — tests first

**Files:**
- Create: `libs/cdk-constructs/test/knowledge-base.test.ts`

- [ ] **Step 1: Write CDK assertion tests for KnowledgeBase**

```ts
// libs/cdk-constructs/test/knowledge-base.test.ts
import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { KnowledgeBase } from '../src/knowledge-base';

describe('KnowledgeBase construct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    new KnowledgeBase(stack, 'TestKB', {
      kbName: 'regulatory',
      description: 'Regulatory & Compliance KB',
      embeddingModelId: 'amazon.titan-embed-text-v2:0',
    });
    template = Template.fromStack(stack);
  });

  it('creates an S3 bucket with block public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('creates an S3 bucket with versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('creates exactly 1 S3 bucket', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('creates a Bedrock Knowledge Base', () => {
    template.hasResourceProperties('AWS::Bedrock::KnowledgeBase', {
      Name: Match.stringLikeRegexp('regulatory'),
      Description: 'Regulatory & Compliance KB',
      KnowledgeBaseConfiguration: {
        Type: 'VECTOR',
        VectorKnowledgeBaseConfiguration: {
          EmbeddingModelArn: Match.stringLikeRegexp('amazon\\.titan-embed-text-v2'),
        },
      },
      StorageConfiguration: {
        Type: 'OPENSEARCH_SERVERLESS',
      },
    });
  });

  it('creates a Bedrock Data Source pointing to the S3 bucket', () => {
    template.hasResourceProperties('AWS::Bedrock::DataSource', {
      DataSourceConfiguration: {
        Type: 'S3',
        S3Configuration: {
          BucketArn: Match.anyValue(),
        },
      },
    });
  });

  it('creates an IAM role for the Knowledge Base', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: Match.objectLike({
              Service: 'bedrock.amazonaws.com',
            }),
          }),
        ]),
      }),
    });
  });
});
```

- [ ] **Step 2: Run test (verify fail)**

```bash
npx nx test cdk-constructs -- --testPathPattern=knowledge-base
```

Expected: FAIL — `../src/knowledge-base` does not exist.

---

### Task 5: Implement KnowledgeBase CDK construct

**Files:**
- Create: `libs/cdk-constructs/src/knowledge-base.ts`

- [ ] **Step 1: Implement the KnowledgeBase construct**

```ts
// libs/cdk-constructs/src/knowledge-base.ts
import { Construct } from 'constructs';
import { RemovalPolicy, Stack, Arn, ArnFormat } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';

export interface KnowledgeBaseProps {
  /** Short name for the KB (e.g. 'regulatory', 'market', 'fund') */
  readonly kbName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Bedrock embedding model ID (default: 'amazon.titan-embed-text-v2:0') */
  readonly embeddingModelId?: string;
  /** Override bucket name (default: auto-generated from naming convention) */
  readonly bucketName?: string;
  /** Removal policy (default: RETAIN) */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * KnowledgeBase construct — creates an S3 bucket, Bedrock Knowledge Base
 * with built-in vector store, and a Data Source pointing to the bucket.
 *
 * Usage in a service stack:
 * ```ts
 * const kb = new KnowledgeBase(this, 'RegulatoryKB', {
 *   kbName: 'regulatory',
 *   description: 'Regulatory & Compliance documents',
 * });
 * // kb.bucket, kb.knowledgeBaseId, kb.dataSourceId
 * ```
 */
export class KnowledgeBase extends Construct {
  readonly bucket: Bucket;
  readonly knowledgeBaseId: string;
  readonly dataSourceId: string;
  readonly knowledgeBaseArn: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const embeddingModelId = props.embeddingModelId ?? 'amazon.titan-embed-text-v2:0';
    const stack = Stack.of(this);

    // ── S3 Bucket ──────────────────────────────────────────────────────────
    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: props.bucketName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
    });

    // ── IAM Role for Bedrock KB ────────────────────────────────────────────
    const kbRole = new Role(this, 'KBRole', {
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com'),
    });

    // Grant Bedrock read access to S3 bucket
    this.bucket.grantRead(kbRole);

    // Grant Bedrock access to the embedding model
    const embeddingModelArn = Arn.format({
      partition: 'aws',
      service: 'bedrock',
      region: '*',
      account: '',
      resource: 'foundation-model',
      resourceName: embeddingModelId,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    kbRole.addToPolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [embeddingModelArn],
    }));

    // ── Bedrock Knowledge Base (L1 — CfnKnowledgeBase) ─────────────────────
    const cfnKb = new CfnKnowledgeBase(this, 'KB', {
      name: `${id}-${props.kbName}`,
      description: props.description,
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
        },
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: `arn:aws:aoss:${stack.region}:${stack.account}:collection/*`,
          fieldMapping: {
            metadataField: 'metadata',
            textField: 'text',
            vectorField: 'vector',
          },
          vectorIndexName: `${props.kbName}-index`,
        },
      },
    });

    this.knowledgeBaseId = cfnKb.attrKnowledgeBaseId;
    this.knowledgeBaseArn = cfnKb.attrKnowledgeBaseArn;

    // ── Bedrock Data Source ─────────────────────────────────────────────────
    const cfnDataSource = new CfnDataSource(this, 'DataSource', {
      knowledgeBaseId: this.knowledgeBaseId,
      name: `${props.kbName}-s3-source`,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: this.bucket.bucketArn,
        },
      },
    });

    this.dataSourceId = cfnDataSource.attrDataSourceId;
  }

  /**
   * Triggers a Bedrock KB data source sync (StartIngestionJob).
   * Returns the IAM policy statement needed to call the API.
   * Attach this to the Lambda that writes to the S3 bucket.
   */
  triggerSyncPolicy(): PolicyStatement {
    return new PolicyStatement({
      actions: ['bedrock:StartIngestionJob'],
      resources: [this.knowledgeBaseArn],
    });
  }
}
```

- [ ] **Step 2: Run test (verify pass)**

```bash
npx nx test cdk-constructs -- --testPathPattern=knowledge-base
```

Expected: PASS — all 6 assertions green.

**Note:** If the `CfnKnowledgeBase` / `CfnDataSource` L1 constructs differ in the installed CDK version, check `aws-cdk-lib/aws-bedrock` types and adjust property names accordingly. The test uses `hasResourceProperties` which matches CloudFormation resource types, so the assertions are stable.

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/src/knowledge-base.ts libs/cdk-constructs/test/knowledge-base.test.ts
git commit -m "feat(cdk-constructs): add KnowledgeBase construct

S3 bucket + Bedrock KB (built-in vector store) + Data Source.
Exposes bucket, knowledgeBaseId, dataSourceId, triggerSyncPolicy().

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Create AdapterSchedule CDK construct — tests first

**Files:**
- Create: `libs/cdk-constructs/test/adapter-schedule.test.ts`

- [ ] **Step 1: Write CDK assertion tests for AdapterSchedule**

```ts
// libs/cdk-constructs/test/adapter-schedule.test.ts
import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { AdapterSchedule } from '../src/adapter-schedule';

describe('AdapterSchedule construct', () => {
  describe('with enabled schedule', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
      });

      new AdapterSchedule(stack, 'TestSchedule', {
        target: fn,
        scheduleExpression: 'rate(6 hours)',
        enabled: true,
      });

      template = Template.fromStack(stack);
    });

    it('creates an EventBridge Scheduler schedule', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'rate(6 hours)',
        State: 'ENABLED',
      });
    });

    it('targets the Lambda function', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        Target: Match.objectLike({
          Arn: Match.anyValue(),
        }),
      });
    });

    it('uses FLEXIBLE time window of 15 minutes', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        FlexibleTimeWindow: {
          Mode: 'FLEXIBLE',
          MaximumWindowInMinutes: 15,
        },
      });
    });

    it('creates an IAM role for the scheduler', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                Service: 'scheduler.amazonaws.com',
              }),
            }),
          ]),
        }),
      });
    });
  });

  describe('with disabled schedule (sandbox)', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
      });

      new AdapterSchedule(stack, 'TestSchedule', {
        target: fn,
        scheduleExpression: 'rate(24 hours)',
        enabled: false,
      });

      template = Template.fromStack(stack);
    });

    it('creates schedule in DISABLED state', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'rate(24 hours)',
        State: 'DISABLED',
      });
    });
  });

  describe('with retry configuration', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
      });

      new AdapterSchedule(stack, 'TestSchedule', {
        target: fn,
        scheduleExpression: 'rate(6 hours)',
        enabled: true,
        maxRetryAttempts: 2,
        maxEventAge: Duration.minutes(30),
      });

      template = Template.fromStack(stack);
    });

    it('sets retry policy on the target', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        Target: Match.objectLike({
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 1800,
          },
        }),
      });
    });
  });
});
```

- [ ] **Step 2: Run test (verify fail)**

```bash
npx nx test cdk-constructs -- --testPathPattern=adapter-schedule
```

Expected: FAIL — `../src/adapter-schedule` does not exist.

---

### Task 7: Implement AdapterSchedule CDK construct

**Files:**
- Create: `libs/cdk-constructs/src/adapter-schedule.ts`

- [ ] **Step 1: Implement the AdapterSchedule construct**

```ts
// libs/cdk-constructs/src/adapter-schedule.ts
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';

export interface AdapterScheduleProps {
  /** Lambda function to invoke on schedule */
  readonly target: IFunction;
  /** Schedule expression (e.g. 'rate(6 hours)', 'rate(24 hours)') */
  readonly scheduleExpression: string;
  /** Whether the schedule is enabled (false = DISABLED state, zero cost) */
  readonly enabled: boolean;
  /** Maximum retry attempts for failed invocations (default: 1) */
  readonly maxRetryAttempts?: number;
  /** Maximum event age before discarding (default: 1 hour) */
  readonly maxEventAge?: Duration;
  /** Flexible time window in minutes (default: 15) */
  readonly flexibleWindowMinutes?: number;
}

/**
 * AdapterSchedule construct — creates an EventBridge Scheduler schedule
 * that invokes a Lambda function on a configurable cadence.
 *
 * Usage in an adapter service stack:
 * ```ts
 * const config = resolvePipelineConfig(this, 'yahoo-finance-adpt');
 * const scheduleConfig = config.schedule ?? { enabled: false, rate: 'rate(24 hours)' };
 *
 * new AdapterSchedule(this, 'FetchSchedule', {
 *   target: fetchLambda,
 *   scheduleExpression: scheduleConfig.rate,
 *   enabled: scheduleConfig.enabled,
 * });
 * ```
 */
export class AdapterSchedule extends Construct {
  readonly schedule: CfnSchedule;

  constructor(scope: Construct, id: string, props: AdapterScheduleProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const flexibleWindow = props.flexibleWindowMinutes ?? 15;
    const maxRetry = props.maxRetryAttempts ?? 1;
    const maxAge = props.maxEventAge ?? Duration.hours(1);

    // IAM role for EventBridge Scheduler to invoke the Lambda
    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });

    schedulerRole.addToPolicy(new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [props.target.functionArn],
    }));

    this.schedule = new CfnSchedule(this, 'Schedule', {
      scheduleExpression: props.scheduleExpression,
      scheduleExpressionTimezone: 'UTC',
      state: props.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: {
        mode: 'FLEXIBLE',
        maximumWindowInMinutes: flexibleWindow,
      },
      target: {
        arn: props.target.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: {
          maximumRetryAttempts: maxRetry,
          maximumEventAgeInSeconds: maxAge.toSeconds(),
        },
      },
    });
  }
}
```

- [ ] **Step 2: Run test (verify pass)**

```bash
npx nx test cdk-constructs -- --testPathPattern=adapter-schedule
```

Expected: PASS — all 5 assertions green.

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/src/adapter-schedule.ts libs/cdk-constructs/test/adapter-schedule.test.ts
git commit -m "feat(cdk-constructs): add AdapterSchedule construct

EventBridge Scheduler wrapping a Lambda target.
Supports enabled/disabled state, retry policy, flexible time window.
Reads schedule config from resolvePipelineConfig in service stacks.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Chunk 2: Barrel exports + integration test

### Task 8: Update barrel exports

**Files:**
- Modify: `libs/cdk-constructs/src/index.ts`

- [ ] **Step 1: Add exports for new constructs**

Add to `libs/cdk-constructs/src/index.ts`:

```ts
export { KnowledgeBase, KnowledgeBaseProps } from './knowledge-base';
export { AdapterSchedule, AdapterScheduleProps } from './adapter-schedule';
```

Also update the `resolvePipelineConfig` export line to include `ScheduleConfig`:

```ts
export { resolvePipelineConfig, ResolvedPipelineConfig, ScheduleConfig, inferServiceMetadata, discoverSubsystem, loadTierDefaults, mergeConfigs, HARDCODED_FALLBACKS } from './resolve-pipeline-config';
```

- [ ] **Step 2: Verify barrel compiles**

```bash
npx nx build cdk-constructs
```

Expected: BUILD SUCCESS.

---

### Task 9: Integration test — both constructs together

**Files:**
- Create test case in `libs/cdk-constructs/test/knowledge-base.test.ts` (append)

- [ ] **Step 1: Add integration test verifying both constructs in one stack**

Append to `libs/cdk-constructs/test/knowledge-base.test.ts`:

```ts
describe('KnowledgeBase + AdapterSchedule integration', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const kb = new KnowledgeBase(stack, 'MarketKB', {
      kbName: 'market',
      description: 'Market Intelligence KB',
    });

    const fn = new Function(stack, 'FetchFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    // Grant the fetch Lambda permission to trigger KB sync
    fn.addToRolePolicy(kb.triggerSyncPolicy());

    new AdapterSchedule(stack, 'FetchSchedule', {
      target: fn,
      scheduleExpression: 'rate(6 hours)',
      enabled: true,
    });

    template = Template.fromStack(stack);
  });

  it('creates both an S3 bucket and a Scheduler schedule', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
  });

  it('creates a Bedrock Knowledge Base', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
  });

  it('grants StartIngestionJob to the fetch Lambda', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:StartIngestionJob',
          }),
        ]),
      }),
    });
  });
});
```

Add the necessary imports at the top of the file:

```ts
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { AdapterSchedule } from '../src/adapter-schedule';
```

- [ ] **Step 2: Run integration test**

```bash
npx nx test cdk-constructs -- --testPathPattern=knowledge-base
```

Expected: PASS — all tests green (unit + integration).

---

### Task 10: Final verification + commit

- [ ] **Step 1: Run full cdk-constructs test suite**

```bash
npx nx test cdk-constructs
```

Expected: PASS — all existing tests + new tests pass.

- [ ] **Step 2: Commit barrel + integration test**

```bash
git add libs/cdk-constructs/src/index.ts libs/cdk-constructs/test/knowledge-base.test.ts
git commit -m "feat(cdk-constructs): export KnowledgeBase + AdapterSchedule from barrel

Add integration test verifying both constructs work together.
Exports ScheduleConfig from resolve-pipeline-config.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Run full workspace lint (optional sanity check)**

```bash
npx nx run-many -t lint --projects=cdk-constructs
```

Expected: PASS.
