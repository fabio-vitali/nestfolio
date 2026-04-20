# Integration Test Mock Resilience — Implementation Plan

> **SUPERSEDED (2026-04-20):** The agent-runtime mocking sections of this plan
> describe a URL-based design (`resolveAgentRuntimeUrl()` + `invokeRemoteRuntime()`,
> SSM defaults to the literal `'DISABLED'`, in-process fallback) that was replaced
> by the AgentCore data-plane transport landed on `main` (commits ef83923e → c83d0d46).
> The current shape is `resolveAgentRuntimeTarget()` + `dispatchAgentInvocation()`
> with the `AgentInvocation = { tenantId, decisionId, upstreamOutputs }` envelope.
> SSM polarity is inverted: each service's `AgentRuntimeUrlParam` defaults to the
> deployed AgentCore runtime ARN, ingress Lambdas are granted
> `bedrock-agentcore:InvokeAgentRuntime`, and integration tests read the canonical
> SSM ARN as `restoreTo` before overriding to a mock Function URL. There is no
> in-process fallback — misconfiguration throws. See
> `.claude/skills/create-integration-test/SKILL.md` Pattern E for the canonical
> setup and
> `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`
> as the reference test. The OrphanReaper / StateResetFixture / crash-safe
> SsmOverrideFixture sections remain accurate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make integration tests crash-safe and prevent accidental real API calls (Bedrock, Alpaca) by fixing stale state, adding crash-safe SSM overrides, cleaning orphaned resources, and adding mock agent runtimes to 5 Bedrock services.

**Architecture:** Three new fixtures in `libs/integration-testing` (StateResetFixture, OrphanReaper, crash-safe SsmOverrideFixture) + a shared `resolveAgentRuntimeUrl()` helper in `libs/agent-orchestrator` + per-service mock Lambda handlers and SSM wiring for 5 Bedrock services.

**Tech Stack:** AWS SDK (DynamoDB, Lambda, IAM, SQS, EventBridge, SSM), Jest, esbuild

**Spec:** `docs/superpowers/specs/2026-04-16-integration-test-mock-resilience-design.md`

---

## File Map

### Shared libraries (new/modified)
- **Create:** `libs/integration-testing/src/fixtures/state-reset.fixture.ts` — clears stale global-key DDB items
- **Create:** `libs/integration-testing/test/fixtures/state-reset.fixture.test.ts` — unit test (mocked DDB)
- **Create:** `libs/integration-testing/src/fixtures/orphan-reaper.ts` — deletes old `integ-*` AWS resources
- **Create:** `libs/integration-testing/test/fixtures/orphan-reaper.test.ts` — unit test (mocked AWS clients)
- **Modify:** `libs/integration-testing/src/fixtures/ssm-override.fixture.ts` — crash-safe `.backup` param
- **Create:** `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts` — unit test (mocked SSM)
- **Modify:** `libs/integration-testing/src/index.ts` — export new fixtures
- **Create:** `libs/agent-orchestrator/src/resolve-runtime-url.ts` — shared SSM-based URL resolution (no application-level cache)
- **Create:** `libs/agent-orchestrator/test/resolve-runtime-url.test.ts` — unit test (mocked fetch)
- **Modify:** `libs/agent-orchestrator/src/index.ts` — export new helper

### Per-service (5 Bedrock services)
For each of advisory-ctrl, investor-profile-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl:
- **Modify:** `src/service.stack.ts` — add SSM param for agent runtime URL
- **Modify:** `src/agent-service.ts` or `src/services/decision-lifecycle.service.ts` — add URL resolution
- **Create:** `test/mocks/mock-agent-runtime.ts`
- **Create:** `test/mocks/.gitignore` — exclude `*.zip` and `dist/`
- **Modify:** `test/integration/*.integration.test.ts` — add MockApiFixture + SsmOverrideFixture

### Test fixes (2 services with stale state)
- **Modify:** `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`
- **Modify:** `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

### Task 1: Create StateResetFixture

**Files:**
- Create: `libs/integration-testing/src/fixtures/state-reset.fixture.ts`
- Test: `libs/integration-testing/test/fixtures/state-reset.fixture.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// libs/integration-testing/test/fixtures/state-reset.fixture.test.ts
import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { StateResetFixture } from '../../src/fixtures/state-reset.fixture';

// Mock the DynamoDB client — no DDB Local dependency
jest.mock('@aws-sdk/client-dynamodb');
const mockSend = jest.fn();
(DynamoDBClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const mockSsm = { tableName: jest.fn().mockResolvedValue('dev-broker-alpaca-adpt') };
const mockCtx = { region: 'us-east-1', ssm: mockSsm } as any;

describe('StateResetFixture', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSsm.tableName.mockClear();
  });

  it('should query by pk and delete all returned items', async () => {
    // Query returns two items
    mockSend.mockResolvedValueOnce({
      Items: [
        marshall({ pk: 'CircuitBreaker#alpaca', sk: 'CircuitBreaker', state: 'OPEN' }),
        marshall({ pk: 'CircuitBreaker#alpaca', sk: 'History#1', closedAt: '2026-01-01' }),
      ],
    });
    // Two DeleteItem calls
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const fixture = new StateResetFixture(mockCtx);
    await fixture.reset([{ table: 'broker-alpaca-adpt', pk: 'CircuitBreaker#alpaca' }]);

    expect(mockSsm.tableName).toHaveBeenCalledWith('broker-alpaca-adpt');
    expect(mockSend).toHaveBeenCalledTimes(3); // 1 Query + 2 Delete
    expect(mockSend.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(mockSend.mock.calls[1][0]).toBeInstanceOf(DeleteItemCommand);
    expect(mockSend.mock.calls[2][0]).toBeInstanceOf(DeleteItemCommand);
  });

  it('should not throw when pk has no items', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const fixture = new StateResetFixture(mockCtx);
    await expect(fixture.reset([{ table: 'broker-alpaca-adpt', pk: 'DoesNotExist#123' }]))
      .resolves.not.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1); // Query only, no deletes
  });

  it('should log warning and continue on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    const fixture = new StateResetFixture(mockCtx);
    await expect(fixture.reset([{ table: 'broker-alpaca-adpt', pk: 'Fail#1' }]))
      .resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('StateResetFixture'), expect.any(Error));
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test integration-testing -- --testPathPattern=state-reset`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StateResetFixture**

```typescript
// libs/integration-testing/src/fixtures/state-reset.fixture.ts
import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { TestContext } from '@nestfolio/test-support';

export class StateResetFixture {
  private readonly client: DynamoDBClient;
  private readonly ctx: TestContext;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
  }

  async reset(entries: Array<{ table: string; pk: string }>): Promise<void> {
    for (const { table, pk } of entries) {
      try {
        const tableName = await this.ctx.ssm.tableName(table);
        const result = await this.client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': pk }),
        }));

        for (const item of result.Items ?? []) {
          const { pk: itemPk, sk } = unmarshall(item);
          await this.client.send(new DeleteItemCommand({
            TableName: tableName,
            Key: marshall({ pk: itemPk, sk }),
          }));
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`StateResetFixture: failed to reset pk=${pk} in ${table}`, err);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test integration-testing -- --testPathPattern=state-reset`
Expected: PASS

- [ ] **Step 5: Export from index**

Add to `libs/integration-testing/src/index.ts`:
```typescript
export { StateResetFixture } from './fixtures/state-reset.fixture';
```

- [ ] **Step 6: Commit**

```bash
git add libs/integration-testing/src/fixtures/state-reset.fixture.ts libs/integration-testing/test/fixtures/state-reset.fixture.test.ts libs/integration-testing/src/index.ts
git commit -m "feat(integration-testing): add StateResetFixture for clearing stale global-key DDB items"
```

---

### Task 2: Enhance SsmOverrideFixture with crash-safe backup

**Files:**
- Modify: `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`
- Test: `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { SsmOverrideFixture } from '../../src/fixtures/ssm-override.fixture';

// Mock the SSM client — no real AWS credentials needed for unit tests
jest.mock('@aws-sdk/client-ssm');
const mockSend = jest.fn();
(SSMClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const PARAM = '/test/ssm-override-fixture/baseUrl';
const BACKUP = `${PARAM}.backup`;
const REAL_VALUE = 'https://real-api.example.com';
const MOCK_VALUE = 'https://mock-lambda.lambda-url.us-east-1.on.aws';

const mockCleanup = { register: jest.fn() };
const mockCtx = { region: 'us-east-1', cleanup: mockCleanup } as any;

describe('SsmOverrideFixture crash-safe backup', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCleanup.register.mockReset();
  });

  it('should create .backup on first override and restore on cleanup', async () => {
    // paramExists(.backup) → not found
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    // GetParameter(main) → real value
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(.backup) → ok
    mockSend.mockResolvedValueOnce({});
    // PutParameter(main with mock) → ok
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({ paramName: PARAM, testValue: MOCK_VALUE, waitMs: 0 });

    // Verify: checked .backup, read main, wrote .backup, wrote main with mock
    expect(mockSend).toHaveBeenCalledTimes(4);
    expect(mockSend.mock.calls[2][0]).toBeInstanceOf(PutParameterCommand);
    expect(mockSend.mock.calls[3][0]).toBeInstanceOf(PutParameterCommand);
    expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));

    // Simulate cleanup (restore)
    mockSend.mockReset();
    // GetParameter(.backup) → real value
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(main with real value) → ok
    mockSend.mockResolvedValueOnce({});
    // DeleteParameter(.backup) → ok
    mockSend.mockResolvedValueOnce({});

    await fixture.restore();
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[2][0]).toBeInstanceOf(DeleteParameterCommand);
  });

  it('should recover from crashed run (stale .backup exists)', async () => {
    // paramExists(.backup) → found (previous crash left it)
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(main with mock) → ok (skips writing .backup since it already exists)
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({ paramName: PARAM, testValue: MOCK_VALUE, waitMs: 0 });

    // Should NOT have read main or written .backup — it preserved the existing .backup
    expect(mockSend).toHaveBeenCalledTimes(2);

    // Restore — should put back the real value from .backup
    mockSend.mockReset();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    await fixture.restore();
    expect(mockSend.mock.calls[1][0]).toBeInstanceOf(PutParameterCommand);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test integration-testing -- --testPathPattern=ssm-override`
Expected: FAIL — old implementation lacks backup logic

- [ ] **Step 3: Implement crash-safe SsmOverrideFixture**

Replace `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`:

```typescript
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import type { TestContext } from '@nestfolio/test-support';

/**
 * Each instance handles exactly one SSM parameter override.
 * To override multiple params, create a separate SsmOverrideFixture per param.
 */
export class SsmOverrideFixture {
  private readonly client: SSMClient;
  private readonly ctx: TestContext;
  private paramName?: string;
  private backupParamName?: string;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new SSMClient({ region: ctx.region });
  }

  async override(params: {
    paramName: string;
    testValue: string;
    waitMs?: number;
  }): Promise<void> {
    this.paramName = params.paramName;
    this.backupParamName = `${params.paramName}.backup`;

    // Check if .backup exists (crash recovery)
    const backupExists = await this.paramExists(this.backupParamName);

    if (!backupExists) {
      // First override — save current value to .backup
      const current = await this.client.send(new GetParameterCommand({
        Name: params.paramName,
      }));
      const originalValue = current.Parameter?.Value;
      if (originalValue) {
        await this.client.send(new PutParameterCommand({
          Name: this.backupParamName,
          Value: originalValue,
          Type: 'String',
          Overwrite: true,
        }));
      }
    }
    // If backupExists: previous run crashed. .backup already has the real value. Don't overwrite it.

    // Overwrite with test value
    await this.client.send(new PutParameterCommand({
      Name: params.paramName,
      Value: params.testValue,
      Type: 'String',
      Overwrite: true,
    }));

    // Wait for parameterStoreTtl expiry
    const waitMs = params.waitMs ?? 6_000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Register cleanup
    this.ctx.cleanup.register('SsmOverrideFixture', () => this.restore());
  }

  async restore(): Promise<void> {
    if (!this.paramName || !this.backupParamName) return;
    try {
      const backup = await this.client.send(new GetParameterCommand({
        Name: this.backupParamName,
      }));
      const originalValue = backup.Parameter?.Value;
      if (originalValue) {
        await this.client.send(new PutParameterCommand({
          Name: this.paramName,
          Value: originalValue,
          Type: 'String',
          Overwrite: true,
        }));
      }
      // Delete .backup — clean slate for next run
      await this.client.send(new DeleteParameterCommand({
        Name: this.backupParamName,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('SsmOverrideFixture: failed to restore SSM value', err);
    }
  }

  private async paramExists(name: string): Promise<boolean> {
    try {
      await this.client.send(new GetParameterCommand({ Name: name }));
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test integration-testing -- --testPathPattern=ssm-override`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/ssm-override.fixture.ts libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts
git commit -m "feat(integration-testing): make SsmOverrideFixture crash-safe with .backup param"
```

---

### Task 3: Create OrphanReaper

**Files:**
- Create: `libs/integration-testing/src/fixtures/orphan-reaper.ts`
- Test: `libs/integration-testing/test/fixtures/orphan-reaper.test.ts`
- Modify: `libs/integration-testing/src/index.ts`

- [ ] **Step 1: Implement OrphanReaper**

```typescript
// libs/integration-testing/src/fixtures/orphan-reaper.ts
import {
  LambdaClient, ListFunctionsCommand, DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient, ListRolesCommand, DeleteRoleCommand,
  DetachRolePolicyCommand, ListAttachedRolePoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  SQSClient, ListQueuesCommand, DeleteQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  EventBridgeClient, ListRulesCommand, RemoveTargetsCommand,
  ListTargetsByRuleCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import type { TestContext } from '@nestfolio/test-support';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DOMAIN_BUSES = ['advisory', 'investor', 'execution', 'ledger'];

export class OrphanReaper {
  private readonly region: string;
  private readonly prefix: string;

  constructor(ctx: TestContext) {
    this.region = ctx.region;
    this.prefix = ctx.prefix;
  }

  // Note: List calls return a single page (~50 items). If orphaned resources exceed one page,
  // older ones won't be cleaned. Acceptable for integ-* resources which rarely accumulate that high.
  async cleanup(): Promise<void> {
    await Promise.allSettled([
      this.reapLambdas(),
      this.reapIamRoles(),
      this.reapSqsQueues(),
    ]);
    // EB rules run after SQS cleanup completes
    await this.reapEventBridgeRules().catch(err =>
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: EB rule cleanup failed', err),
    );
  }

  private async reapLambdas(): Promise<void> {
    const lambda = new LambdaClient({ region: this.region });
    try {
      const result = await lambda.send(new ListFunctionsCommand({}));
      const cutoff = Date.now() - ONE_HOUR_MS;

      for (const fn of result.Functions ?? []) {
        if (!fn.FunctionName?.startsWith('integ-mock-')) continue;
        const modified = new Date(fn.LastModified ?? 0).getTime();
        if (modified > cutoff) continue;

        try {
          await lambda.send(new DeleteFunctionUrlConfigCommand({ FunctionName: fn.FunctionName }));
        } catch { /* may not have URL config */ }
        await lambda.send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: Lambda cleanup failed', err);
    }
  }

  private async reapIamRoles(): Promise<void> {
    const iam = new IAMClient({ region: this.region });
    try {
      const result = await iam.send(new ListRolesCommand({}));
      const cutoff = Date.now() - ONE_HOUR_MS;

      for (const role of result.Roles ?? []) {
        if (!role.RoleName?.startsWith('integ-mock-')) continue;
        const created = new Date(role.CreateDate ?? 0).getTime();
        if (created > cutoff) continue;

        // Detach all policies before deleting
        const policies = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: role.RoleName }));
        for (const policy of policies.AttachedPolicies ?? []) {
          await iam.send(new DetachRolePolicyCommand({
            RoleName: role.RoleName,
            PolicyArn: policy.PolicyArn,
          }));
        }
        await iam.send(new DeleteRoleCommand({ RoleName: role.RoleName }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: IAM role cleanup failed', err);
    }
  }

  private async reapSqsQueues(): Promise<void> {
    const sqs = new SQSClient({ region: this.region });
    try {
      const result = await sqs.send(new ListQueuesCommand({ QueueNamePrefix: 'integ-trap-' }));
      // SQS doesn't expose creation time directly — use queue name timestamp
      const cutoff = Date.now() - ONE_HOUR_MS;

      for (const url of result.QueueUrls ?? []) {
        const name = url.split('/').pop() ?? '';
        const match = name.match(/^integ-trap-(\d+)-/);
        if (!match) continue;
        const created = Number(match[1]);
        if (created > cutoff) continue;

        await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: SQS queue cleanup failed', err);
    }
  }

  private async reapEventBridgeRules(): Promise<void> {
    const eb = new EventBridgeClient({ region: this.region });
    try {
      const cutoff = Date.now() - ONE_HOUR_MS;

      // EventBusTrap creates rules on named domain buses, not the default bus.
      // Iterate all 4 domain buses to find orphaned integ-trap-* rules.
      for (const domain of DOMAIN_BUSES) {
        const busName = `${this.prefix}-${domain}`;
        const result = await eb.send(new ListRulesCommand({
          NamePrefix: 'integ-trap-',
          EventBusName: busName,
        }));

        for (const rule of result.Rules ?? []) {
          if (!rule.Name) continue;
          const match = rule.Name.match(/^integ-trap-(\d+)-/);
          if (!match) continue;
          const created = Number(match[1]);
          if (created > cutoff) continue;

          // Remove targets first
          const targets = await eb.send(new ListTargetsByRuleCommand({
            Rule: rule.Name,
            EventBusName: busName,
          }));
          const targetIds = (targets.Targets ?? []).map(t => t.Id!).filter(Boolean);
          if (targetIds.length > 0) {
            await eb.send(new RemoveTargetsCommand({
              Rule: rule.Name,
              EventBusName: busName,
              Ids: targetIds,
            }));
          }
          await eb.send(new DeleteRuleCommand({
            Name: rule.Name,
            EventBusName: busName,
          }));
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: EB rule cleanup failed', err);
    }
  }
}
```

- [ ] **Step 2: Write the test**

```typescript
// libs/integration-testing/test/fixtures/orphan-reaper.test.ts
import {
  LambdaClient, ListFunctionsCommand, DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient, ListRolesCommand, DeleteRoleCommand,
  DetachRolePolicyCommand, ListAttachedRolePoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  SQSClient, ListQueuesCommand, DeleteQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  EventBridgeClient, ListRulesCommand, RemoveTargetsCommand,
  ListTargetsByRuleCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { OrphanReaper } from '../../src/fixtures/orphan-reaper';

jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-iam');
jest.mock('@aws-sdk/client-sqs');
jest.mock('@aws-sdk/client-eventbridge');

const lambdaSend = jest.fn();
const iamSend = jest.fn();
const sqsSend = jest.fn();
const ebSend = jest.fn();

(LambdaClient as jest.Mock).mockImplementation(() => ({ send: lambdaSend }));
(IAMClient as jest.Mock).mockImplementation(() => ({ send: iamSend }));
(SQSClient as jest.Mock).mockImplementation(() => ({ send: sqsSend }));
(EventBridgeClient as jest.Mock).mockImplementation(() => ({ send: ebSend }));

const OLD_TIMESTAMP = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
const RECENT_TIMESTAMP = Date.now() - 10 * 60 * 1000;  // 10 minutes ago
const mockCtx = { region: 'us-east-1', prefix: 'dev' } as any;

describe('OrphanReaper', () => {
  beforeEach(() => {
    lambdaSend.mockReset();
    iamSend.mockReset();
    sqsSend.mockReset();
    ebSend.mockReset();
  });

  it('should delete old integ-mock-* Lambda functions', async () => {
    lambdaSend.mockResolvedValueOnce({
      Functions: [
        { FunctionName: 'integ-mock-alpaca-' + OLD_TIMESTAMP, LastModified: new Date(OLD_TIMESTAMP).toISOString() },
        { FunctionName: 'integ-mock-agent-' + RECENT_TIMESTAMP, LastModified: new Date(RECENT_TIMESTAMP).toISOString() },
        { FunctionName: 'production-fn', LastModified: new Date().toISOString() },
      ],
    });
    lambdaSend.mockResolvedValue({}); // DeleteFunctionUrlConfig + DeleteFunction
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    ebSend.mockResolvedValue({ Rules: [] }); // 4 buses × ListRules

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    // Should delete the old one (URL config + function), skip the recent one and production fn
    const deleteCallNames = lambdaSend.mock.calls
      .filter(c => c[0] instanceof DeleteFunctionCommand)
      .map(c => c[0].input.FunctionName);
    expect(deleteCallNames).toEqual(['integ-mock-alpaca-' + OLD_TIMESTAMP]);
  });

  it('should iterate all 4 domain buses for EB rules', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });

    // Each bus returns empty rules
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    // Should have called ListRules for all 4 buses
    const listRuleCalls = ebSend.mock.calls.filter(c => c[0] instanceof ListRulesCommand);
    expect(listRuleCalls).toHaveLength(4);
    const busNames = listRuleCalls.map(c => c[0].input.EventBusName);
    expect(busNames).toEqual(['dev-advisory', 'dev-investor', 'dev-execution', 'dev-ledger']);
  });

  it('should delete old SQS queues matching integ-trap-{timestamp} pattern', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({
      QueueUrls: [
        `https://sqs.us-east-1.amazonaws.com/123/integ-trap-${OLD_TIMESTAMP}-abc123`,
        `https://sqs.us-east-1.amazonaws.com/123/integ-trap-${RECENT_TIMESTAMP}-def456`,
      ],
    });
    sqsSend.mockResolvedValue({}); // DeleteQueue
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const deleteCalls = sqsSend.mock.calls.filter(c => c[0] instanceof DeleteQueueCommand);
    expect(deleteCalls).toHaveLength(1); // Only old one
  });

  it('should not throw when cleanup encounters errors', async () => {
    lambdaSend.mockRejectedValue(new Error('AccessDenied'));
    iamSend.mockRejectedValue(new Error('AccessDenied'));
    sqsSend.mockRejectedValue(new Error('AccessDenied'));
    ebSend.mockRejectedValue(new Error('AccessDenied'));

    const reaper = new OrphanReaper(mockCtx);
    await expect(reaper.cleanup()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm nx test integration-testing -- --testPathPattern=orphan-reaper`
Expected: PASS

- [ ] **Step 4: Export from index**

Add to `libs/integration-testing/src/index.ts`:
```typescript
export { OrphanReaper } from './fixtures/orphan-reaper';
```

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/orphan-reaper.ts libs/integration-testing/test/fixtures/orphan-reaper.test.ts libs/integration-testing/src/index.ts
git commit -m "feat(integration-testing): add OrphanReaper for cleaning leaked integ-* AWS resources"
```

---

### Task 4: Add resolveAgentRuntimeUrl helper

**Files:**
- Create: `libs/agent-orchestrator/src/resolve-runtime-url.ts`
- Test: `libs/agent-orchestrator/test/resolve-runtime-url.test.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`

- [ ] **Step 1: Write the test**

```typescript
// libs/agent-orchestrator/test/resolve-runtime-url.test.ts
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '../src/resolve-runtime-url';

// Mock Powertools Logger — avoid real structured logging in tests
jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('resolveAgentRuntimeUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null when AGENT_RUNTIME_URL_PARAM is not set', async () => {
    delete process.env.AGENT_RUNTIME_URL_PARAM;
    expect(await resolveAgentRuntimeUrl()).toBeNull();
  });

  it('should return null when AGENT_RUNTIME_URL_PARAM is empty string', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '';
    expect(await resolveAgentRuntimeUrl()).toBeNull();
  });

  it('should return null when SSM param value is DISABLED sentinel', async () => {
    // Simulates the CDK default 'DISABLED'
    process.env.AGENT_RUNTIME_URL_PARAM = '/test/param';
    process.env.AWS_SESSION_TOKEN = 'test-token';
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      json: async () => ({ Parameter: { Value: 'DISABLED' } }),
    } as Response);

    expect(await resolveAgentRuntimeUrl()).toBeNull();
    mockFetch.mockRestore();
  });

  it('should return URL when SSM param has a real value', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/test/param';
    process.env.AWS_SESSION_TOKEN = 'test-token';
    const mockUrl = 'https://mock.lambda-url.us-east-1.on.aws';
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      json: async () => ({ Parameter: { Value: mockUrl } }),
    } as Response);

    expect(await resolveAgentRuntimeUrl()).toBe(mockUrl);
    mockFetch.mockRestore();
  });

  it('should log warning and return null on SSM fetch error', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/test/param';
    process.env.AWS_SESSION_TOKEN = 'test-token';
    const mockFetch = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

    expect(await resolveAgentRuntimeUrl()).toBeNull();
    mockFetch.mockRestore();
  });
});

describe('invokeRemoteRuntime', () => {
  it('should POST payload and return parsed JSON', async () => {
    const expected = { result: 'ok' };
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => expected,
    } as Response);

    const result = await invokeRemoteRuntime('https://mock.url', { input: 'test' });
    expect(result).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith('https://mock.url', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ input: 'test' }),
    }));
    mockFetch.mockRestore();
  });

  it('should throw on non-OK response', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    await expect(invokeRemoteRuntime('https://mock.url', {}))
      .rejects.toThrow('Remote agent runtime returned 500');
    mockFetch.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=resolve-runtime-url`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolveAgentRuntimeUrl**

```typescript
// libs/agent-orchestrator/src/resolve-runtime-url.ts
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'agent-orchestrator' });

/**
 * Resolve agent runtime URL from SSM via the Parameters and Secrets Lambda Extension.
 * Returns null if AGENT_RUNTIME_URL_PARAM is unset or the param value is empty/whitespace (in-process mode).
 *
 * No application-level cache — the Parameters and Secrets Extension already caches with a
 * configurable TTL (PARAMETERS_SECRETS_EXTENSION_CACHE_SIZE / _TTL env vars). Adding a second
 * cache layer would prevent SsmOverrideFixture from redirecting warm Lambda instances to mocks.
 */
export async function resolveAgentRuntimeUrl(): Promise<string | null> {
  const paramName = process.env.AGENT_RUNTIME_URL_PARAM;
  if (!paramName) return null;

  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;

  try {
    const res = await fetch(
      `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
      { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
    );
    const data = await res.json() as { Parameter: { Value: string } };
    const value = data.Parameter.Value?.trim() ?? '';
    return value.startsWith('https://') ? value : null;
  } catch (err) {
    logger.warn('resolveAgentRuntimeUrl: SSM lookup failed, falling back to in-process', { error: err });
    return null;
  }
}

/**
 * Invoke a remote agent runtime via HTTP POST.
 * Used when resolveAgentRuntimeUrl() returns a non-null URL.
 */
export async function invokeRemoteRuntime<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Remote agent runtime returned ${res.status}: ${await res.text()}`);
  }
  return await res.json() as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=resolve-runtime-url`
Expected: PASS

- [ ] **Step 5: Export from index**

Add to `libs/agent-orchestrator/src/index.ts`:
```typescript
export { resolveAgentRuntimeUrl, invokeRemoteRuntime } from './resolve-runtime-url';
```

- [ ] **Step 6: Verify no application-level caching**

Confirm `resolve-runtime-url.ts` has NO module-level `cachedUrl` variable. The Parameters and Secrets Extension handles caching — a second cache would prevent `SsmOverrideFixture` from redirecting warm Lambda instances to mocks.

- [ ] **Step 7: Commit**

```bash
git add libs/agent-orchestrator/src/resolve-runtime-url.ts libs/agent-orchestrator/test/resolve-runtime-url.test.ts libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): add resolveAgentRuntimeUrl helper for mock agent runtime"
```

---

### Task 5: Wire advisory-ctrl mock agent runtime

**Files:**
- Create: `services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts`
- Create: `services/advisory/advisory-ctrl/test/mocks/.gitignore`
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`
- Modify: `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`

- [ ] **Step 1: Create mock-agent-runtime.ts**

Create the mock handler matching what `DecisionLifecycleService` expects from `invokeOrchestrator`:

```typescript
// services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime that returns canned DecisionLifecycleStateType.
 * Shape must match what createOrchestrator returns: keyed by agent name.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    'user-goals': {
      goals: [{ description: 'Mock growth goal', priority: 'HIGH', timeHorizon: 'LONG_TERM' }],
      investmentStyle: 'GROWTH',
      confidence: 0.9,
    },
    'risk-assessment': {
      riskScore: 7,
      riskBand: 'MODERATE',
      maxDrawdownTolerance: 0.15,
      confidence: 0.85,
    },
    'market-research': {
      signals: [{ indicator: 'VIX', value: 18, interpretation: 'LOW_VOLATILITY' }],
      regime: 'BULL',
      confidence: 0.8,
    },
    'portfolio-construction': {
      allocations: [
        { ticker: 'VTI', weight: 0.6, assetClass: 'US_EQUITY' },
        { ticker: 'BND', weight: 0.4, assetClass: 'FIXED_INCOME' },
      ],
      confidence: 0.85,
    },
    'rebalance-planner': {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 5 },
        { ticker: 'BND', action: 'buy', quantity: 10 },
      ],
      urgency: 'NORMAL',
      confidence: 0.9,
    },
    explainability: {
      summary: 'Mock: Portfolio rebalanced toward growth allocation.',
      rationale: 'Mock rationale for integration test',
      keyFactors: ['Market conditions favorable', 'Risk tolerance moderate'],
      tone: 'confident',
      wordCount: 12,
      confidence: 0.85,
    },
  });
}
```

- [ ] **Step 2: Create .gitignore and build mock zip**

```bash
echo -e "*.zip\ndist/" > services/advisory/advisory-ctrl/test/mocks/.gitignore
npx esbuild services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts --bundle --platform=node --target=node20 --format=esm --outfile=services/advisory/advisory-ctrl/test/mocks/dist/index.mjs
cd services/advisory/advisory-ctrl/test/mocks/dist && zip -j ../mock-agent-runtime.zip index.mjs && cd -
```

- [ ] **Step 3: Add SSM param + extension + permissions to CDK stack**

Modify `services/advisory/advisory-ctrl/src/service.stack.ts`:

Add imports:
```typescript
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
```

Add inside the constructor, after model ID resolution (before the Ingress construct):
```typescript
const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-advisory-ctrl/agent/runtimeUrl`,
  stringValue: 'DISABLED', // SSM rejects empty strings — resolveAgentRuntimeUrl() treats non-URL values as null
});
```

Add `paramsAndSecrets` to the Ingress construct's `lambdaProps` so `resolveAgentRuntimeUrl()` can reach the Parameters and Secrets Extension at `localhost:2773`:
```typescript
paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
```

After the Ingress construct is created, add the env var and grant SSM read permission:
```typescript
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

- [ ] **Step 4: Add runtime URL resolution to DecisionLifecycleService**

Modify `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`:

Add import at top:
```typescript
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
```

Replace the `runAgentPipeline` method:
```typescript
  private async runAgentPipeline(context: DecisionContext): Promise<DecisionLifecycleStateType> {
    const runtimeUrl = await resolveAgentRuntimeUrl();

    if (runtimeUrl) {
      return invokeRemoteRuntime<DecisionLifecycleStateType>(runtimeUrl, context);
    }

    const result = await invokeOrchestrator(this.graph, { input: JSON.stringify(context) });

    if ('serviceUnavailable' in result && (result as ServiceUnavailableResponse).serviceUnavailable) {
      const unavailable = result as ServiceUnavailableResponse;
      throw new Error(`Agent pipeline unavailable: ${unavailable.reason}`);
    }

    return result as DecisionLifecycleStateType;
  }
```

- [ ] **Step 5: Update integration test to use MockApiFixture + SsmOverrideFixture**

Modify `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`:

Update imports:
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
} from '@nestfolio/integration-testing';
```

Update `beforeAll`:
```typescript
  beforeAll(async () => {
    ctx = await createTestContext();

    // Deploy mock agent runtime
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM to point to mock (crash-safe)
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-advisory-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_UPDATED',
        'AGENT_INVOCATION_CREATED',
        'AGENT_INVOCATION_UPDATED',
      ],
    });
  }, 120_000);
```

- [ ] **Step 6: Revert the earlier interim timeout increase**

In the same test file, revert the `waitForEvent` timeout change (the mock makes it fast now):
```typescript
        const cdcEvent = await trap.waitForEvent({
          detailType: 'DECISION_PACKET_CREATED',
        });
```

And revert the `it.each` timeout back to `60_000`.

- [ ] **Step 7: Run unit tests**

```bash
pnpm nx test advisory-ctrl
```
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-ctrl/test/mocks/ services/advisory/advisory-ctrl/src/service.stack.ts services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts
git commit -m "feat(advisory-ctrl): wire mock agent runtime for integration tests"
```

---

### Task 6: Create + wire investor-profile-ctrl mock agent runtime

**Files:**
- Create: `services/advisory/investor-profile-ctrl/test/mocks/mock-agent-runtime.ts`
- Create: `services/advisory/investor-profile-ctrl/test/mocks/.gitignore`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/agent-service.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`

- [ ] **Step 1: Create mock handler**

```typescript
// services/advisory/investor-profile-ctrl/test/mocks/mock-agent-runtime.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for investor-profile-ctrl.
 * Returns canned orchestrator output keyed by agent name.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    'user-goals': {
      goals: [{ description: 'Mock retirement goal', priority: 'HIGH', timeHorizon: 'LONG_TERM' }],
      investmentStyle: 'BALANCED',
      confidence: 0.9,
    },
    'risk-assessment': {
      riskScore: 6,
      riskBand: 'MODERATE',
      maxDrawdownTolerance: 0.12,
      confidence: 0.85,
    },
  });
}
```

- [ ] **Step 2: Create .gitignore and build zip**

```bash
echo -e "*.zip\ndist/" > services/advisory/investor-profile-ctrl/test/mocks/.gitignore
npx esbuild services/advisory/investor-profile-ctrl/test/mocks/mock-agent-runtime.ts --bundle --platform=node --target=node20 --format=esm --outfile=services/advisory/investor-profile-ctrl/test/mocks/dist/index.mjs
cd services/advisory/investor-profile-ctrl/test/mocks/dist && zip -j ../mock-agent-runtime.zip index.mjs && cd -
```

- [ ] **Step 3: Add SSM param + extension + permissions to CDK stack**

Modify `services/advisory/investor-profile-ctrl/src/service.stack.ts`:

Add imports:
```typescript
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
```

Add inside constructor (before Ingress):
```typescript
const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
  stringValue: 'DISABLED',
});
```

Add `paramsAndSecrets` to the Ingress construct's `lambdaProps`:
```typescript
paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
```

After Ingress creation, add env var and grant SSM read:
```typescript
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

- [ ] **Step 4: Add runtime URL resolution to agent-service.ts**

Modify `services/advisory/investor-profile-ctrl/src/agent-service.ts`:

Add import:
```typescript
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
```

In the `runPipeline` function, replace the `invokeOrchestrator` call (lines 44-49):
```typescript
      let result: Record<string, unknown>;
      const runtimeUrl = await resolveAgentRuntimeUrl();
      if (runtimeUrl) {
        result = await invokeRemoteRuntime(runtimeUrl, {
          tenantId, decisionId,
          investorProfile: subject.investorProfile ?? subject.context ?? {},
          portfolioState: subject.portfolioState ?? {},
        });
      } else {
        result = await invokeOrchestrator(orchestrator, {
          tenantId, decisionId,
          investorProfile: subject.investorProfile ?? subject.context ?? {},
          portfolioState: subject.portfolioState ?? {},
        }) as Record<string, unknown>;
      }
```

- [ ] **Step 5: Update integration test**

Modify `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`:

Add imports:
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
```

Update the `@nestfolio/integration-testing` import:
```typescript
import {
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
} from '@nestfolio/integration-testing';
```

Update `beforeAll`:
```typescript
  beforeAll(async () => {
    ctx = await createTestContext();

    // Deploy mock agent runtime
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: ['GOAL_INTERPRETATION_PRODUCED'],
    });
  }, 120_000);
```

- [ ] **Step 6: Run unit tests**

```bash
pnpm nx test investor-profile-ctrl
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/advisory/investor-profile-ctrl/test/mocks/ services/advisory/investor-profile-ctrl/src/service.stack.ts services/advisory/investor-profile-ctrl/src/agent-service.ts services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts
git commit -m "feat(investor-profile-ctrl): add mock agent runtime for integration tests"
```

---

### Task 7: Create + wire portfolio-engine-ctrl mock agent runtime

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/test/mocks/mock-agent-runtime.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/mocks/.gitignore`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`

- [ ] **Step 1: Create mock handler**

```typescript
// services/advisory/portfolio-engine-ctrl/test/mocks/mock-agent-runtime.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for portfolio-engine-ctrl.
 * Returns canned orchestrator output keyed by agent name.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    'portfolio-construction': {
      allocations: [
        { ticker: 'VTI', weight: 0.6, assetClass: 'US_EQUITY' },
        { ticker: 'VXUS', weight: 0.2, assetClass: 'INTL_EQUITY' },
        { ticker: 'BND', weight: 0.2, assetClass: 'FIXED_INCOME' },
      ],
      confidence: 0.88,
    },
    'rebalance-planner': {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 3 },
        { ticker: 'VXUS', action: 'buy', quantity: 2 },
      ],
      urgency: 'NORMAL',
      confidence: 0.85,
    },
  });
}
```

- [ ] **Step 2: Create .gitignore and build zip**

```bash
echo -e "*.zip\ndist/" > services/advisory/portfolio-engine-ctrl/test/mocks/.gitignore
npx esbuild services/advisory/portfolio-engine-ctrl/test/mocks/mock-agent-runtime.ts --bundle --platform=node --target=node20 --format=esm --outfile=services/advisory/portfolio-engine-ctrl/test/mocks/dist/index.mjs
cd services/advisory/portfolio-engine-ctrl/test/mocks/dist && zip -j ../mock-agent-runtime.zip index.mjs && cd -
```

- [ ] **Step 3: Add SSM param + extension + permissions to CDK stack**

Modify `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`:

Add imports:
```typescript
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
```

Add inside constructor (before Ingress):
```typescript
const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-portfolio-engine-ctrl/agent/runtimeUrl`,
  stringValue: 'DISABLED',
});
```

Add `paramsAndSecrets` to the Ingress construct's `lambdaProps`:
```typescript
paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
```

After Ingress creation, add env var and grant SSM read:
```typescript
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

- [ ] **Step 4: Add runtime URL resolution to agent-service.ts**

Modify `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`:

Add import:
```typescript
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
```

Replace the `invokeOrchestrator` call (line 66-70):
```typescript
      let result: Record<string, unknown>;
      const runtimeUrl = await resolveAgentRuntimeUrl();
      if (runtimeUrl) {
        result = await invokeRemoteRuntime(runtimeUrl, {
          tenantId, decisionId,
          upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
        });
      } else {
        result = await invokeOrchestrator(orchestrator, {
          tenantId, decisionId,
          upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
        }) as Record<string, unknown>;
      }
```

- [ ] **Step 5: Update integration tests (both files)**

Update both `portfolio-engine-ctrl.integration.test.ts` AND `portfolio-engine-ctrl.resilience.integration.test.ts` — the resilience test also triggers `CONSTRUCT_PORTFOLIO` events that invoke the agent pipeline.

Same pattern as Task 6, Step 5. In each file, update imports and add MockApiFixture + SsmOverrideFixture setup in `beforeAll`:

```typescript
    // Deploy mock agent runtime
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-portfolio-engine-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
    });
```

- [ ] **Step 6: Run unit tests**

```bash
pnpm nx test portfolio-engine-ctrl
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/test/mocks/ services/advisory/portfolio-engine-ctrl/src/service.stack.ts services/advisory/portfolio-engine-ctrl/src/agent-service.ts services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts
git commit -m "feat(portfolio-engine-ctrl): add mock agent runtime for integration tests"
```

---

### Task 8: Create + wire advisory-narrative-ctrl mock agent runtime

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/test/mocks/mock-agent-runtime.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/mocks/.gitignore`
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/agent-service.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`

- [ ] **Step 1: Create mock handler**

This service uses a single agent (explainability), not an orchestrator. The mock returns the single-agent output shape:

```typescript
// services/advisory/advisory-narrative-ctrl/test/mocks/mock-agent-runtime.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for advisory-narrative-ctrl.
 * Returns canned explainability agent output.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    summary: 'Mock: Your portfolio has been rebalanced to align with your growth objectives.',
    rationale: 'Mock rationale: Market conditions support increased equity exposure.',
    keyFactors: ['Moderate risk tolerance', 'Long-term growth goal', 'Low volatility environment'],
    tone: 'confident',
    wordCount: 18,
    confidence: 0.88,
  });
}
```

- [ ] **Step 2: Create .gitignore and build zip**

```bash
echo -e "*.zip\ndist/" > services/advisory/advisory-narrative-ctrl/test/mocks/.gitignore
npx esbuild services/advisory/advisory-narrative-ctrl/test/mocks/mock-agent-runtime.ts --bundle --platform=node --target=node20 --format=esm --outfile=services/advisory/advisory-narrative-ctrl/test/mocks/dist/index.mjs
cd services/advisory/advisory-narrative-ctrl/test/mocks/dist && zip -j ../mock-agent-runtime.zip index.mjs && cd -
```

- [ ] **Step 3: Add SSM param + extension + permissions to CDK stack**

Modify `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`:

Add imports:
```typescript
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
```

Add inside constructor (before Ingress):
```typescript
const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
  stringValue: 'DISABLED',
});
```

Add `paramsAndSecrets` to the Ingress construct's `lambdaProps`:
```typescript
paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
```

After Ingress creation, add env var and grant SSM read:
```typescript
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

- [ ] **Step 4: Add runtime URL resolution to agent-service.ts**

Modify `services/advisory/advisory-narrative-ctrl/src/agent-service.ts`:

Add import:
```typescript
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
```

Replace the `agentNode` call (line 46-50):
```typescript
      let result: Record<string, unknown>;
      const runtimeUrl = await resolveAgentRuntimeUrl();
      if (runtimeUrl) {
        result = await invokeRemoteRuntime(runtimeUrl, {
          tenantId, decisionId,
          upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
        });
      } else {
        result = await agentNode({
          tenantId, decisionId,
          upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
        });
      }
```

- [ ] **Step 5: Update integration test**

Same pattern. Update imports, add MockApiFixture + SsmOverrideFixture setup in `beforeAll`:

```typescript
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
    });
```

- [ ] **Step 6: Run unit tests**

```bash
pnpm nx test advisory-narrative-ctrl
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/test/mocks/ services/advisory/advisory-narrative-ctrl/src/service.stack.ts services/advisory/advisory-narrative-ctrl/src/agent-service.ts services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts
git commit -m "feat(advisory-narrative-ctrl): add mock agent runtime for integration tests"
```

---

### Task 9: Create + wire market-intelligence-ctrl mock agent runtime

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/test/mocks/mock-agent-runtime.ts`
- Create: `services/advisory/market-intelligence-ctrl/test/mocks/.gitignore`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/agent-service.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`

- [ ] **Step 1: Create mock handler**

This service uses a single agent (`createAgentNode` + `withRetry` + `withFallback`), not a multi-agent orchestrator. The mock returns the market research output shape:

```typescript
// services/advisory/market-intelligence-ctrl/test/mocks/mock-agent-runtime.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for market-intelligence-ctrl.
 * Returns canned market research agent output.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    signals: [
      { indicator: 'VIX', value: 18.5, interpretation: 'LOW_VOLATILITY' },
      { indicator: 'SPY_RSI', value: 55, interpretation: 'NEUTRAL' },
    ],
    tickersMentioned: ['SPY', 'VTI', 'BND'],
    marketOutlook: 'NEUTRAL_BULLISH',
    confidenceScore: 0.82,
    metadata: { analysisTimestamp: new Date().toISOString(), modelVersion: 'mock-v1' },
  });
}
```

- [ ] **Step 2: Create .gitignore and build zip**

```bash
echo -e "*.zip\ndist/" > services/advisory/market-intelligence-ctrl/test/mocks/.gitignore
npx esbuild services/advisory/market-intelligence-ctrl/test/mocks/mock-agent-runtime.ts --bundle --platform=node --target=node20 --format=esm --outfile=services/advisory/market-intelligence-ctrl/test/mocks/dist/index.mjs
cd services/advisory/market-intelligence-ctrl/test/mocks/dist && zip -j ../mock-agent-runtime.zip index.mjs && cd -
```

- [ ] **Step 3: Add SSM param + extension + permissions to CDK stack**

Modify `services/advisory/market-intelligence-ctrl/src/service.stack.ts`:

Add imports:
```typescript
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
```

Add inside constructor (before Ingress):
```typescript
const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-market-intelligence-ctrl/agent/runtimeUrl`,
  stringValue: 'DISABLED',
});
```

Add `paramsAndSecrets` to the Ingress construct's `lambdaProps`:
```typescript
paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
```

After Ingress creation, add env var and grant SSM read:
```typescript
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

- [ ] **Step 4: Add runtime URL resolution to agent-service.ts**

Modify `services/advisory/market-intelligence-ctrl/src/agent-service.ts`:

Add import:
```typescript
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
```

Replace the `resilientNode` call (line ~44):
```typescript
      let result: Record<string, unknown>;
      const runtimeUrl = await resolveAgentRuntimeUrl();
      if (runtimeUrl) {
        result = await invokeRemoteRuntime(runtimeUrl, {
          tenantId, decisionId,
          upstreamOutputs: subject.upstreamOutputs ?? {},
        });
      } else {
        result = await resilientNode({
          tenantId, decisionId,
          upstreamOutputs: subject.upstreamOutputs ?? {},
        }) as Record<string, unknown>;
      }
```

- [ ] **Step 5: Update integration test**

Modify `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`:

Add imports:
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
```

Update the `@nestfolio/integration-testing` import:
```typescript
import {
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
} from '@nestfolio/integration-testing';
```

Update `beforeAll`:
```typescript
    // Deploy mock agent runtime
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-market-intelligence-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
    });
```

- [ ] **Step 6: Run unit tests**

```bash
pnpm nx test market-intelligence-ctrl
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/test/mocks/ services/advisory/market-intelligence-ctrl/src/service.stack.ts services/advisory/market-intelligence-ctrl/src/agent-service.ts services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts
git commit -m "feat(market-intelligence-ctrl): add mock agent runtime for integration tests"
```

---

### Task 10: Wire StateResetFixture into broker-alpaca-adpt and investor-bff

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Update broker-alpaca-adpt integration test**

Add `StateResetFixture` import:
```typescript
import {
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  StateResetFixture,
  type BusEventPayload,
} from '@nestfolio/integration-testing';
```

Add to `beforeAll`, BEFORE MockApiFixture setup (after `createTestContext`):
```typescript
    // Clear stale circuit breaker state from interrupted runs
    const stateReset = new StateResetFixture(ctx);
    await stateReset.reset([
      { table: 'broker-alpaca-adpt', pk: 'CircuitBreaker#alpaca' },
    ]);
```

- [ ] **Step 2: Update investor-bff integration test**

Add `StateResetFixture` import:
```typescript
import {
  EventBusTrap,
  TableAssertions,
  StateResetFixture,
  type BusEventPayload,
} from '@nestfolio/integration-testing';
```

Add to `beforeAll`, after `createTestContext`:
```typescript
    // Clear stale feature flag state from interrupted runs
    const stateReset = new StateResetFixture(ctx);
    await stateReset.reset([
      { table: 'investor-bff', pk: 'FeatureFlag#SYSTEM' },
    ]);
```

Remove the interim `beforeAll` cleanup in the `describe('AppSync mutations')` block that was added earlier (the `table.cleanup` call), since `StateResetFixture` now handles this at suite level.

- [ ] **Step 3: Run unit tests for both**

```bash
pnpm nx test broker-alpaca-adpt && pnpm nx test investor-bff
```
Expected: PASS (unit tests don't exercise fixtures)

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "fix(broker-alpaca-adpt,investor-bff): add StateResetFixture to clear stale DDB items"
```

---

### ~~Task (REMOVED) — AgentCore is NOT dead code~~

> **Removed 2026-04-16:** AgentCore (CDK construct, agent containers, tool Lambdas, MCP Gateway) is
> actively deployed production infrastructure in 6 services. The in-process LangGraph path
> (`invokeOrchestrator()`) coexists with the container deployment model. Deleting AgentCore would
> destroy live AWS resources and the container deployment capability.

---

### Task 11: Deploy CDK changes for mock agent runtime SSM params

Tasks 5-9 added `AgentRuntimeUrlParam` SSM parameters and `AGENT_RUNTIME_URL_PARAM` env vars to 5 service stacks. These must be deployed before integration tests can use the mock wiring.

- [ ] **Step 1: Deploy all 5 affected services**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl
```
Expected: All 5 stacks deploy successfully. Each stack creates a new SSM parameter at `/nestfolio/dev-{service}/agent/runtimeUrl` with value `DISABLED`.

- [ ] **Step 2: Verify SSM params exist**

```bash
aws ssm get-parameters --names \
  /nestfolio/dev-advisory-ctrl/agent/runtimeUrl \
  /nestfolio/dev-investor-profile-ctrl/agent/runtimeUrl \
  /nestfolio/dev-portfolio-engine-ctrl/agent/runtimeUrl \
  /nestfolio/dev-advisory-narrative-ctrl/agent/runtimeUrl \
  /nestfolio/dev-market-intelligence-ctrl/agent/runtimeUrl \
  --query 'Parameters[].{Name:Name,Value:Value}' --output table
```
Expected: All 5 params present with value `DISABLED`.

---

### Task 12: Final verification — run all affected unit tests

- [ ] **Step 1: Run all affected unit tests**

```bash
pnpm nx run-many -t test --projects=integration-testing,agent-orchestrator,advisory-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl,broker-alpaca-adpt,investor-bff --parallel=4
```
Expected: ALL PASS

- [ ] **Step 2: Commit any remaining fixes**

If any test fails, fix and commit.
