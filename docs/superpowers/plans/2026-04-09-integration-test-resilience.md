# Integration Test Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate transient AWS failures in the integration test suite so all 28 services pass reliably under `--parallel=4` (and higher) execution.

**Architecture:** Central `TimingConfig` on `IntegrationContext` with env-var scaling, canary warmup in `EventBusTrap.deploy()` to empirically verify EB→SQS pipeline activation, exponential-backoff retry in `putEvent()`, `jest.retryTimes(1)` safety net, removal of best-effort CDC try/catch wrappers.

**Tech Stack:** TypeScript, AWS SDK v3 (EventBridge, SQS, DynamoDB), Jest, `@nestfolio/integration-testing`

---

### Task 1: TimingConfig interface + IntegrationContext + exports

**Files:**
- Modify: `libs/integration-testing/src/context.ts`
- Modify: `libs/integration-testing/src/index.ts`

- [ ] **Step 1: Add TimingConfig interface and wire into createIntegrationContext**

In `libs/integration-testing/src/context.ts`, replace the entire file with:

```typescript
import { CleanupRegistry } from './cleanup';
import { SsmCache } from './ssm-cache';

export interface TimingConfig {
  /** Default timeout for waitForEvent / waitForItem (ms) */
  eventTimeout: number;
  /** Poll interval for SQS / DDB polling (ms) */
  pollInterval: number;
  /** Canary warmup timeout (ms) */
  canaryTimeout: number;
  /** Number of retries for putEvent */
  putEventRetries: number;
  /** Base backoff for putEvent retries (ms) */
  putEventBackoffMs: number;
}

export interface IntegrationContext {
  tenantId: string;
  userId: string;
  prefix: string;
  region: string;
  ssm: SsmCache;
  cleanup: CleanupRegistry;
  timings: TimingConfig;
}

function createTimingConfig(overrides?: Partial<TimingConfig>): TimingConfig {
  const multiplier = Number(process.env.INTEG_TIMEOUT_MULTIPLIER) || 1;
  return {
    eventTimeout: overrides?.eventTimeout ?? 45_000 * multiplier,
    pollInterval: overrides?.pollInterval ?? 2_000,
    canaryTimeout: overrides?.canaryTimeout ?? 15_000 * multiplier,
    putEventRetries: overrides?.putEventRetries ?? 3,
    putEventBackoffMs: overrides?.putEventBackoffMs ?? 500,
  };
}

export async function createIntegrationContext(options?: {
  prefix?: string;
  region?: string;
  timings?: Partial<TimingConfig>;
}): Promise<IntegrationContext> {
  const prefix = options?.prefix ?? 'dev';
  const region = options?.region ?? 'us-east-1';
  const timestamp = Date.now();
  const cleanup = new CleanupRegistry();
  const ssm = new SsmCache(prefix, region);

  cleanup.register('SsmCache', () => {
    ssm.destroy();
    return Promise.resolve();
  });

  return {
    tenantId: `integ-${timestamp}`,
    userId: `integ-user-${timestamp}`,
    prefix,
    region,
    ssm,
    cleanup,
    timings: createTimingConfig(options?.timings),
  };
}
```

- [ ] **Step 2: Update index.ts to export TimingConfig**

In `libs/integration-testing/src/index.ts`, change the context export line from:

```typescript
export { createIntegrationContext, type IntegrationContext } from './context';
```

to:

```typescript
export { createIntegrationContext, type IntegrationContext, type TimingConfig } from './context';
```

- [ ] **Step 3: Verify compilation**

Run: `pnpm nx run integration-testing:build --skip-nx-cache`

Expected: compiles without errors. Downstream consumers still compile because `timings` is a new additive property — no existing code references it yet.

- [ ] **Step 4: Commit**

```bash
git add libs/integration-testing/src/context.ts libs/integration-testing/src/index.ts
git commit -m "feat(integration-testing): add TimingConfig with env-var scaling

Central timing configuration for all integration test fixtures.
Supports INTEG_TIMEOUT_MULTIPLIER env var for CI scaling.
Explicit overrides via createIntegrationContext({ timings }) merge with defaults."
```

---

### Task 2: Canary warmup in EventBusTrap.deploy()

**Files:**
- Modify: `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`

This is the most critical change. The canary replaces the hardcoded 2s wait with an empirical end-to-end verification that the EB rule → SQS pipeline is active.

- [ ] **Step 1: Add PutEventsCommand import**

In `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`, change the eventbridge import from:

```typescript
import {
  EventBridgeClient, PutRuleCommand, PutTargetsCommand,
  RemoveTargetsCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
```

to:

```typescript
import {
  EventBridgeClient, PutEventsCommand, PutRuleCommand, PutTargetsCommand,
  RemoveTargetsCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
```

- [ ] **Step 2: Replace deploy() method**

Replace the entire `deploy()` method (lines 36–110) with:

```typescript
  async deploy(params: {
    bus: string;
    detailType: string | string[];
  }): Promise<void> {
    this.busArn = await this.ctx.ssm.busArn(params.bus);
    const timestamp = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    const trapId = `integ-trap-${timestamp}-${suffix}`;

    // Create SQS queue
    const createResult = await this.sqs.send(new CreateQueueCommand({
      QueueName: trapId,
      Attributes: {
        VisibilityTimeout: '60',
        MessageRetentionPeriod: '300',
      },
    }));
    this.queueUrl = createResult.QueueUrl!;

    // Get queue ARN
    const attrsResult = await this.sqs.send(new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      AttributeNames: ['QueueArn'],
    }));
    this.queueArn = attrsResult.Attributes!['QueueArn'];

    // Create EB rule — include canary detailType for warmup verification
    this.ruleName = trapId;
    const detailTypes = Array.isArray(params.detailType) ? params.detailType : [params.detailType];

    await this.eb.send(new PutRuleCommand({
      Name: this.ruleName,
      EventBusName: this.busArn,
      EventPattern: JSON.stringify({
        'detail-type': [...detailTypes, '__INTEG_CANARY'],
        detail: {
          context: {
            tenantId: [this.ctx.tenantId],
          },
        },
      }),
      State: 'ENABLED',
    }));

    // Set SQS policy to allow EB
    const policy = {
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'events.amazonaws.com' },
        Action: 'sqs:SendMessage',
        Resource: this.queueArn,
        Condition: {
          ArnEquals: { 'aws:SourceArn': `arn:aws:events:${this.ctx.region}:*:rule/${this.busArn!.split('/').pop()}/${this.ruleName}` },
        },
      }],
    };
    await this.sqs.send(new SetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      Attributes: { Policy: JSON.stringify(policy) },
    }));

    // Add SQS target
    await this.eb.send(new PutTargetsCommand({
      Rule: this.ruleName,
      EventBusName: this.busArn,
      Targets: [{ Id: 'trap-target', Arn: this.queueArn }],
    }));

    // Canary warmup — send event and poll SQS until it arrives
    await this.eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: this.busArn,
        Source: 'integration-test:canary',
        DetailType: '__INTEG_CANARY',
        Detail: JSON.stringify({ context: { tenantId: this.ctx.tenantId } }),
      }],
    }));

    const canaryTimeout = this.ctx.timings.canaryTimeout;
    const canaryDeadline = Date.now() + canaryTimeout;
    let canaryReceived = false;

    while (Date.now() < canaryDeadline && !canaryReceived) {
      const result = await this.sqs.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: Math.min(5, Math.ceil((canaryDeadline - Date.now()) / 1000)),
      }));

      for (const msg of result.Messages ?? []) {
        const body = JSON.parse(msg.Body!);
        if (body['detail-type'] === '__INTEG_CANARY') {
          canaryReceived = true;
          continue;
        }
        // Buffer any real events that arrived during warmup
        this.captured.push({
          detailType: body['detail-type'],
          detail: body.detail,
          source: body.source,
          time: body.time,
        });
      }
    }

    if (!canaryReceived) {
      throw new Error(`EventBusTrap: canary event did not arrive after ${canaryTimeout}ms — EB rule may not be active`);
    }

    // Register cleanup
    this.ctx.cleanup.register('EventBusTrap', () => this.teardown());
  }
```

- [ ] **Step 3: Update waitForEvent defaults to use ctx.timings**

In the `waitForEvent` method, change the timeout and pollInterval defaults from:

```typescript
    const timeout = params?.timeoutMs ?? 30_000;
    const pollInterval = params?.pollIntervalMs ?? 2_000;
```

to:

```typescript
    const timeout = params?.timeoutMs ?? this.ctx.timings.eventTimeout;
    const pollInterval = params?.pollIntervalMs ?? this.ctx.timings.pollInterval;
```

- [ ] **Step 4: Verify compilation**

Run: `pnpm nx run integration-testing:build --skip-nx-cache`

Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
git commit -m "feat(integration-testing): canary warmup in EventBusTrap.deploy()

Replace 2s hardcoded wait with canary event that empirically proves
the EB rule → SQS pipeline is active before returning. Timeouts
read from ctx.timings. Real events arriving during warmup are buffered."
```

---

### Task 3: putEvent retry with exponential backoff

**Files:**
- Modify: `libs/integration-testing/src/fixtures/event-bridge-client.ts`

- [ ] **Step 1: Add retry loop to putEvent()**

Replace the entire `putEvent` method (lines 18–46) with:

```typescript
  async putEvent(params: {
    bus: string;
    targetService: string;
    detailType: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const busArn = await this.ctx.ssm.busArn(params.bus);
    const maxRetries = this.ctx.timings.putEventRetries;
    const baseBackoff = this.ctx.timings.putEventBackoffMs;

    const detail = {
      id: `integ-${randomUUID()}`,
      type: params.detailType,
      timestamp: new Date().toISOString(),
      subject: params.detail,
      context: {
        tenantId: this.ctx.tenantId,
        userId: this.ctx.userId,
        region: this.ctx.region,
      },
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.client.send(new PutEventsCommand({
          Entries: [{
            EventBusName: busArn,
            Source: `integration-test:${params.targetService}`,
            DetailType: params.detailType,
            Detail: JSON.stringify(detail),
          }],
        }));
        if (result.FailedEntryCount === 0) return;
        if (attempt === maxRetries) {
          throw new Error(`putEvent failed after ${maxRetries} retries: ${result.Entries?.[0]?.ErrorMessage}`);
        }
      } catch (err) {
        if (attempt === maxRetries) throw err;
      }
      await new Promise(r => setTimeout(r, baseBackoff * Math.pow(2, attempt)));
    }
  }
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm nx run integration-testing:build --skip-nx-cache`

Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add libs/integration-testing/src/fixtures/event-bridge-client.ts
git commit -m "feat(integration-testing): putEvent retry with exponential backoff

Retries on SDK errors and FailedEntryCount > 0, up to ctx.timings.putEventRetries
attempts with exponential backoff (500ms, 1000ms, 2000ms default)."
```

---

### Task 4: TableAssertions default timeouts from ctx.timings

**Files:**
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts`

- [ ] **Step 1: Update waitForItem defaults**

In `waitForItem()` (line 49–50), change:

```typescript
    const timeout = params.timeoutMs ?? 30_000;
    const pollInterval = params.pollIntervalMs ?? 2_000;
```

to:

```typescript
    const timeout = params.timeoutMs ?? this.ctx.timings.eventTimeout;
    const pollInterval = params.pollIntervalMs ?? this.ctx.timings.pollInterval;
```

- [ ] **Step 2: Update waitForItemMatching defaults**

In `waitForItemMatching()` (line 93–94), change:

```typescript
    const timeout = params.timeoutMs ?? 30_000;
    const pollInterval = params.pollIntervalMs ?? 2_000;
```

to:

```typescript
    const timeout = params.timeoutMs ?? this.ctx.timings.eventTimeout;
    const pollInterval = params.pollIntervalMs ?? this.ctx.timings.pollInterval;
```

- [ ] **Step 3: Verify compilation**

Run: `pnpm nx run integration-testing:build --skip-nx-cache`

Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add libs/integration-testing/src/fixtures/table-assertions.ts
git commit -m "feat(integration-testing): TableAssertions reads defaults from ctx.timings

waitForItem and waitForItemMatching use ctx.timings.eventTimeout (45s)
and ctx.timings.pollInterval (2s) instead of hardcoded 30s/2s."
```

---

### Task 5: jest.integration.setup.ts + wire into 28 jest configs

**Files:**
- Create: `libs/integration-testing/src/jest.integration.setup.ts`
- Modify: 28 `jest.integration.config.js` files (listed below)

- [ ] **Step 1: Create jest.integration.setup.ts**

Create file `libs/integration-testing/src/jest.integration.setup.ts`:

```typescript
jest.retryTimes(1, { logErrorsBeforeRetry: true });
```

- [ ] **Step 2: Add setupFilesAfterEnv to all 28 jest.integration.config.js files**

Each file follows the same pattern. Add this line after `maxWorkers: 1,`:

```javascript
  setupFilesAfterEnv: ['<rootDir>/../../../libs/integration-testing/src/jest.integration.setup.ts'],
```

The 28 files to modify:

```
services/advisory/advisory-ctrl/jest.integration.config.js
services/advisory/advisory-narrative-ctrl/jest.integration.config.js
services/advisory/investor-profile-ctrl/jest.integration.config.js
services/advisory/market-intelligence-ctrl/jest.integration.config.js
services/advisory/portfolio-engine-ctrl/jest.integration.config.js
services/advisory/advisory-bff/jest.integration.config.js
services/advisory/advisory-adpt/jest.integration.config.js
services/advisory/compliance-ctrl/jest.integration.config.js
services/advisory/decision-workflow-ctrl/jest.integration.config.js
services/advisory/alpha-vantage-adpt/jest.integration.config.js
services/advisory/sec-edgar-adpt/jest.integration.config.js
services/advisory/fred-adpt/jest.integration.config.js
services/advisory/marketwatch-adpt/jest.integration.config.js
services/advisory/yahoo-finance-adpt/jest.integration.config.js
services/execution/broker-ctrl/jest.integration.config.js
services/execution/broker-sim-adpt/jest.integration.config.js
services/execution/broker-alpaca-adpt/jest.integration.config.js
services/execution/execution-ctrl/jest.integration.config.js
services/execution/execution-adpt/jest.integration.config.js
services/investor/investor-ctrl/jest.integration.config.js
services/investor/investor-adpt/jest.integration.config.js
services/investor/investor-bff/jest.integration.config.js
services/investor/dashboard-bff/jest.integration.config.js
services/investor/onboarding-bff/jest.integration.config.js
services/ledger/ledger-ctrl/jest.integration.config.js
services/ledger/ledger-adpt/jest.integration.config.js
services/ledger/ledger-bff/jest.integration.config.js
services/ledger/reconciliation-ctrl/jest.integration.config.js
```

Example — the advisory-ctrl config changes from:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-ctrl-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  testTimeout: 120_000,
  maxWorkers: 1,
};
```

to:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'advisory-ctrl-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
  testTimeout: 120_000,
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/../../../libs/integration-testing/src/jest.integration.setup.ts'],
};
```

All 28 files get the identical `setupFilesAfterEnv` line.

> **Note:** The design spec says `setupFilesAfterSetup` — this is a typo. The correct Jest property is `setupFilesAfterEnv`.

- [ ] **Step 3: Commit**

```bash
git add libs/integration-testing/src/jest.integration.setup.ts
git add services/advisory/*/jest.integration.config.js
git add services/execution/*/jest.integration.config.js
git add services/investor/*/jest.integration.config.js
git add services/ledger/*/jest.integration.config.js
git commit -m "feat(integration-testing): jest.retryTimes(1) safety net for all integration tests

Shared setup file enables one automatic retry with error logging.
Wired into all 28 jest.integration.config.js via setupFilesAfterEnv."
```

---

### Task 6: Remove best-effort CDC try/catch assertions

**Files:**
- Modify: `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`

There are 7 try/catch blocks across 5 files. Each wraps a CDC `waitForEvent` call. Remove the try/catch and console.warn, leaving the assertions as mandatory.

- [ ] **Step 1: advisory-ctrl — DECISION_BLOCKED CDC (lines 125–131)**

Change:

```typescript
      // CDC verification — best-effort (DDB Stream propagation can be slow under load)
      try {
        const cdcEvent = await trap.waitForEvent({ detailType: 'DECISION_PACKET_CREATED', timeoutMs: 30_000 });
        expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
      } catch {
        console.warn('CDC assertion skipped — DECISION_PACKET_CREATED not received within timeout (DECISION_BLOCKED path)');
      }
```

to:

```typescript
      // CDC verification
      const cdcEvent = await trap.waitForEvent({ detailType: 'DECISION_PACKET_CREATED', timeoutMs: 30_000 });
      expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
```

- [ ] **Step 2: advisory-ctrl — it.each trigger CDC (lines 370–381)**

Change:

```typescript
        // CDC verification — best-effort (DDB Stream propagation can be slow under load)
        try {
          const cdcEvent = await trap.waitForEvent({
            detailType: 'DECISION_PACKET_CREATED',
            timeoutMs: 30_000,
          });
          expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
          expect(cdcEvent.detail).toBeDefined();
        } catch {
          console.warn(`CDC assertion skipped — DECISION_PACKET_CREATED not received within timeout (${detailType} trigger)`);
        }
```

to:

```typescript
        // CDC verification
        const cdcEvent = await trap.waitForEvent({
          detailType: 'DECISION_PACKET_CREATED',
          timeoutMs: 30_000,
        });
        expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
        expect(cdcEvent.detail).toBeDefined();
```

- [ ] **Step 3: advisory-narrative-ctrl (lines 58–67)**

Change:

```typescript
    // CDC verification — best-effort (AgentRuntime may be unavailable)
    try {
      const cdcEvent = await trap.waitForEvent({
        detailType: 'AGENT_INVOCATION_CREATED',
        timeoutMs: 30_000,
      });
      expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
    } catch {
      console.warn('CDC assertion skipped — AGENT_INVOCATION_CREATED not received within timeout');
    }
```

to:

```typescript
    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
```

- [ ] **Step 4: investor-profile-ctrl (lines 68–77)**

Change:

```typescript
    // CDC verification — best-effort (AgentRuntime may be unavailable)
    try {
      const cdcEvent = await trap.waitForEvent({
        detailType: 'AGENT_INVOCATION_CREATED',
        timeoutMs: 30_000,
      });
      expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
    } catch {
      console.warn('CDC assertion skipped — AGENT_INVOCATION_CREATED not received within timeout');
    }
```

to:

```typescript
    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
```

- [ ] **Step 5: market-intelligence-ctrl (lines 58–67)**

Change:

```typescript
    // CDC verification — best-effort (AgentRuntime may be unavailable)
    try {
      const cdcEvent = await trap.waitForEvent({
        detailType: 'AGENT_INVOCATION_CREATED',
        timeoutMs: 30_000,
      });
      expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
    } catch {
      console.warn('CDC assertion skipped — AGENT_INVOCATION_CREATED not received within timeout');
    }
```

to:

```typescript
    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
```

- [ ] **Step 6: portfolio-engine-ctrl (lines 87–96)**

Change:

```typescript
    // CDC verification — best-effort (AgentRuntime may be unavailable)
    try {
      const cdcEvent = await trap.waitForEvent({
        detailType: 'AGENT_INVOCATION_CREATED',
        timeoutMs: 30_000,
      });
      expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
    } catch {
      console.warn('CDC assertion skipped — AGENT_INVOCATION_CREATED not received within timeout');
    }
```

to:

```typescript
    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
```

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts
git add services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts
git add services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts
git add services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts
git add services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts
git commit -m "fix(integration-tests): remove best-effort CDC try/catch wrappers

With canary warmup, increased timeouts, putEvent retry, and
jest.retryTimes(1) in place, CDC assertions are now mandatory.
7 try/catch blocks removed across 5 advisory service tests."
```

---

### Task 7: Validation

Run the integration test suite to verify resilience improvements.

- [ ] **Step 1: Run one adapter test individually (canary warmup verification)**

Run: `pnpm nx run advisory-narrative-ctrl:test-integration --skip-nx-cache`

Expected: PASS. The canary warmup message should appear in test output (visible in beforeAll timing — should be under 15s, not the old 2s fixed wait).

- [ ] **Step 2: Run full suite at --parallel=4**

Run: `pnpm nx run-many -t test-integration --parallel=4 --skip-nx-cache`

Expected: 28/28 services pass. No CDC assertion failures. Any retried tests show `logErrorsBeforeRetry` output.

- [ ] **Step 3: Run full suite at --parallel=6 (stress test)**

Run: `pnpm nx run-many -t test-integration --parallel=6 --skip-nx-cache`

Expected: 28/28 services pass under higher contention.

- [ ] **Step 4: Verify timeout multiplier**

Run: `INTEG_TIMEOUT_MULTIPLIER=0.5 pnpm nx run advisory-ctrl:test-integration --skip-nx-cache`

Expected: Tests may fail faster (confirms multiplier is effective). The canary timeout is 7.5s, event timeout is 22.5s — tests might time out if AWS is slow.

- [ ] **Step 5: Final commit (if any adjustments needed)**

If validation reveals issues, fix and commit. Otherwise, done.
