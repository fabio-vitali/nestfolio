# Per-Service Integration Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the integration test framework and 4 starter tests that verify deployed services end-to-end against the real dev environment (account 771924376645, us-east-1).

**Architecture:** Three phases — (1) CDK infrastructure changes for test isolation (source filters + CDC tagging + Cognito auth flow + 3P adapter SSM/Secrets), (2) shared `libs/integration-testing` Nx library with all fixtures, (3) integration tests for 4 starter services (investor-adpt, investor-ctrl, investor-bff, broker-alpaca-adpt).

**Tech Stack:** CDK (aws-cdk-lib), Jest, AWS SDK v3 (EventBridge, SQS, DynamoDB, Cognito, SSM, SecretsManager, IAM, Lambda), esbuild, TypeScript.

---

## File Map

### Phase 1 — Infrastructure (CDK changes)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `libs/cdk-constructs/src/core/ingress.ts:109-113` | Add `source` filter to EB Rule |
| Modify | `services/investor/investor-adpt/src/service.stack.ts` (3 rules) | Add `source` filter to ADPT EB Rules |
| Modify | `services/advisory/advisory-adpt/src/service.stack.ts` (3 rules) | Add `source` filter to ADPT EB Rules |
| Modify | `services/execution/execution-adpt/src/service.stack.ts` (2 rules) | Add `source` filter to ADPT EB Rules |
| Modify | `services/ledger/ledger-adpt/src/service.stack.ts` (1 rule) | Add `source` filter to ADPT EB Rules |
| Modify | `libs/event-processor/src/pipelines/change-data-capture.ts:72-77` | CDC test-tenant source tagging |
| Modify | `services/investor/investor-web/src/service.stack.ts:79-82` | Add `adminUserPassword: true` to Cognito client |
| Modify | `services/execution/broker-alpaca-adpt/src/service.stack.ts` | Add ParamsAndSecrets Extension + env vars |
| Modify | `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts` | Refactor to lazy-init from extension |

### Phase 2 — Test Infrastructure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `libs/integration-testing/project.json` | Nx library config |
| Create | `libs/integration-testing/tsconfig.json` | TypeScript config |
| Create | `libs/integration-testing/tsconfig.spec.json` | Test TypeScript config |
| Create | `libs/integration-testing/jest.config.js` | Jest config for lib tests |
| Create | `libs/integration-testing/src/index.ts` | Public API barrel |
| Create | `libs/integration-testing/src/cleanup.ts` | CleanupRegistry |
| Create | `libs/integration-testing/src/ssm-cache.ts` | SsmCache |
| Create | `libs/integration-testing/src/context.ts` | IntegrationContext factory |
| Create | `libs/integration-testing/src/fixtures/event-bridge-client.ts` | Publish events with target-aware source |
| Create | `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` | Temporary EB rule + SQS queue |
| Create | `libs/integration-testing/src/fixtures/table-assertions.ts` | DDB polling/assertions |
| Create | `libs/integration-testing/src/fixtures/cognito.fixture.ts` | Cognito test user lifecycle |
| Create | `libs/integration-testing/src/fixtures/appsync-client.ts` | Authenticated GraphQL client |
| Create | `libs/integration-testing/src/fixtures/mock-api.fixture.ts` | Ephemeral Lambda + Function URL |
| Create | `libs/integration-testing/src/fixtures/ssm-override.fixture.ts` | SSM save/override/restore |
| Create | `libs/integration-testing/src/mock-handlers/mock-alpaca.ts` | Mock Alpaca handler source |
| Modify | `tsconfig.base.json` | Add `@nestfolio/integration-testing` path |
| Modify (move) | `services/investor/investor-adpt/test/*.test.ts` → `test/unit/` | Unit test migration |
| Modify (move) | `services/investor/investor-ctrl/test/*.test.ts` → `test/unit/` | Unit test migration |
| Modify (move) | `services/investor/investor-bff/test/**/*.test.ts` → `test/unit/` | Unit test migration |
| Modify (move) | `services/execution/broker-alpaca-adpt/test/*.test.ts` → `test/unit/` | Unit test migration |
| Modify | 4x `jest.config.js` | Scope testMatch to `test/unit/` |
| Create | 4x `jest.integration.config.js` | Integration test configs |
| Modify | 4x `project.json` | Add `test:integration` target |

### Phase 3 — Integration Tests

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `services/investor/investor-adpt/test/integration/from-execution.integration.test.ts` | ADPT forwarding test |
| Create | `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` | CTRL pipeline test |
| Create | `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts` | BFF pipeline test |
| Create | `services/execution/broker-alpaca-adpt/test/integration/order-flow.integration.test.ts` | 3P-ADPT order tests |
| Create | `services/execution/broker-alpaca-adpt/test/integration/transfer-flow.integration.test.ts` | 3P-ADPT transfer test |
| Create | `services/execution/broker-alpaca-adpt/test/integration/account-check.integration.test.ts` | 3P-ADPT account test |

---

## Phase 1: Infrastructure

### Task 1: Add target-aware source filter to Ingress construct

**Files:**
- Modify: `libs/cdk-constructs/src/core/ingress.ts:108-113`

- [ ] **Step 1: Update the EB Rule event pattern**

In `libs/cdk-constructs/src/core/ingress.ts`, replace the Rule construction (lines 108-113):

```typescript
// EventBridge Rule -> SQS
new Rule(this, 'Rule', {
  eventBus,
  eventPattern: { detailType: props.eventTypes },
  targets: [new SqsQueue(this.queue)],
});
```

with:

```typescript
// EventBridge Rule -> SQS
// Source filter: pass normal events + test events targeting this service only
new Rule(this, 'Rule', {
  eventBus,
  eventPattern: {
    detailType: props.eventTypes,
    source: [
      { 'anything-but': { prefix: 'integration-test:' } },
      { prefix: `integration-test:${serviceName}` },
    ],
  },
  targets: [new SqsQueue(this.queue)],
});
```

- [ ] **Step 2: Run existing Ingress-related unit tests**

Run: `pnpm nx run-many -t test --projects=investor-bff,investor-ctrl,broker-alpaca-adpt -- --testPathPattern="service.stack" 2>&1 | tail -20`

Expected: existing stack tests still pass (the source filter addition is additive — no existing test asserts the absence of `source`).

If any test asserts exact event pattern shape and fails, update that test to include the new `source` filter.

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/src/core/ingress.ts
git commit -m "$(cat <<'EOF'
feat(ingress): add target-aware source filter for integration test isolation

Adds a two-condition source filter to the Ingress EB Rule: passes all normal
events (source doesn't start with integration-test:) and test events targeting
this specific service (source starts with integration-test:{serviceName}).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add source filter to all 4 ADPT stacks

**Files:**
- Modify: `services/investor/investor-adpt/src/service.stack.ts`
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts`
- Modify: `services/execution/execution-adpt/src/service.stack.ts`
- Modify: `services/ledger/ledger-adpt/src/service.stack.ts`

The `serviceName` for each adapter is available via `this.serviceName` (inherited from `ServiceStack`). However, ADPT stacks don't call `ServiceStack.of(this)` — they ARE the ServiceStack. Use `this.serviceName` directly.

Check: verify `this.serviceName` is available in ServiceStack. If not, use the string literal from the stack class.

- [ ] **Step 1: Update investor-adpt — 3 rules**

In `services/investor/investor-adpt/src/service.stack.ts`, add `const serviceName = 'investor-adpt';` after `const domainAccounts = ...;` (line 16), then add `source` filter to each of the 3 rules.

For each rule, add the `source` array inside `eventPattern`:

```typescript
eventPattern: {
  detailType: [...],
  source: [
    { 'anything-but': { prefix: 'integration-test:' } },
    { prefix: `integration-test:${serviceName}` },
  ],
},
```

Apply to:
- `InvestorIngress-FromAdvisory` (line 37)
- `InvestorIngress-FromExecution` (line 61)
- `InvestorIngress-FromLedger` (line 83)

- [ ] **Step 2: Update advisory-adpt — 3 rules**

In `services/advisory/advisory-adpt/src/service.stack.ts`, add `const serviceName = 'advisory-adpt';` after `const domainAccounts = ...;` (line 16), then add the same `source` filter to:

- `AdvisoryIngress-FromInvestor` (line 37)
- `AdvisoryIngress-FromExecution` (line 58)
- `AdvisoryIngress-FromLedger` (line 76)

- [ ] **Step 3: Update execution-adpt — 2 rules**

In `services/execution/execution-adpt/src/service.stack.ts`, add `const serviceName = 'execution-adpt';` after `const domainAccounts = ...;` (line 16), then add the same `source` filter to:

- `ExecutionIngress-FromAdvisory` (line 34)
- `ExecutionIngress-FromInvestor` (line 53)

- [ ] **Step 4: Update ledger-adpt — 1 rule**

In `services/ledger/ledger-adpt/src/service.stack.ts`, add `const serviceName = 'ledger-adpt';` after `const domainAccounts = ...;` (line 16), then add the same `source` filter to:

- `LedgerIngress-FromExecution` (line 31)

- [ ] **Step 5: Run ADPT stack tests**

Run: `pnpm nx run-many -t test --projects=investor-adpt,advisory-adpt,execution-adpt,ledger-adpt 2>&1 | tail -20`

Expected: all pass. If any stack test asserts exact event pattern shape and fails, update that test to include the new `source` array.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-adpt/src/service.stack.ts \
      services/advisory/advisory-adpt/src/service.stack.ts \
      services/execution/execution-adpt/src/service.stack.ts \
      services/ledger/ledger-adpt/src/service.stack.ts
git commit -m "$(cat <<'EOF'
feat(adpt): add target-aware source filter to all 4 adapter stacks

Adds the same two-condition source filter pattern to every cross-domain
EB Rule in investor-adpt (3), advisory-adpt (3), execution-adpt (2),
and ledger-adpt (1). Prevents integration test events from leaking
across services.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add CDC test-tenant source tagging

**Files:**
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts:60-78`

- [ ] **Step 1: Update buildEntry to detect test tenants**

In `libs/event-processor/src/pipelines/change-data-capture.ts`, replace the `return` block in `buildEntry` (lines 72-78):

```typescript
  return {
    EventBusName: busName,
    Source: `${busName}@${serviceName}`,
    DetailType: eventType,
    Detail: JSON.stringify(detail),
  };
```

with:

```typescript
  // Tag CDC events from test tenants so other services' EB rules filter them out
  const isTestTenant = record.tenantId?.startsWith('integ-');
  const source = isTestTenant
    ? `integration-test:${serviceName}`
    : `${busName}@${serviceName}`;

  return {
    EventBusName: busName,
    Source: source,
    DetailType: eventType,
    Detail: JSON.stringify(detail),
  };
```

- [ ] **Step 2: Run event-processor tests**

Run: `pnpm nx test event-processor 2>&1 | tail -20`

Expected: PASS. The `buildEntry` function is internal and existing tests mock at a higher level.

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/pipelines/change-data-capture.ts
git commit -m "$(cat <<'EOF'
feat(event-processor): tag CDC events from test tenants for isolation

When a DDB record has tenantId starting with 'integ-', the CDC pipeline
sets Source to 'integration-test:{serviceName}' instead of the normal
'{busName}@{serviceName}'. This ensures downstream EB rules filter out
CDC events triggered by integration tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add adminUserPassword to Cognito client config

**Files:**
- Modify: `services/investor/investor-web/src/service.stack.ts:79-82`

- [ ] **Step 1: Add adminUserPassword auth flow**

In `services/investor/investor-web/src/service.stack.ts`, replace the client creation (lines 79-82):

```typescript
    const client = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
    });
```

with:

```typescript
    const client = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true, adminUserPassword: true },
      generateSecret: false,
    });
```

- [ ] **Step 2: Run investor-web tests**

Run: `pnpm nx test investor-web 2>&1 | tail -20`

Expected: PASS. No existing test asserts auth flow config.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts
git commit -m "$(cat <<'EOF'
feat(investor-web): enable ADMIN_USER_PASSWORD_AUTH for integration tests

Adds adminUserPassword: true to the Cognito WebClient auth flows. This
enables AdminInitiateAuth for integration tests without affecting the
existing user-facing auth flows.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add Parameters and Secrets Extension to broker-alpaca-adpt

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/service.stack.ts`

- [ ] **Step 1: Add ParamsAndSecrets to Ingress Lambda and poll handlers**

In `services/execution/broker-alpaca-adpt/src/service.stack.ts`, add the import at line 2:

```typescript
import { Duration } from 'aws-cdk-lib';
```

After the existing imports (line 9), add:

```typescript
import { ParamsAndSecretsLayerVersion, ParamsAndSecretsVersions } from 'aws-cdk-lib/aws-lambda';
```

After `const table = state.getTable();` (line 16), add:

```typescript
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

Then modify the Ingress construct (line 18) to pass environment vars for the SSM/Secrets pointers. The Ingress construct supports `environment` and `lambdaProps`:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK,
      ],
      environment: {
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      lambdaProps: { paramsAndSecrets },
    });
```

Also add `paramsAndSecrets` and env vars to the `orderPollFn` (line 63):

```typescript
    const orderPollFn = new NodejsFunction(this, 'OrderPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'order-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      paramsAndSecrets,
      timeout: Duration.seconds(30),
    });
```

And to the `transferPollFn` (line 74):

```typescript
    const transferPollFn = new NodejsFunction(this, 'TransferPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'transfer-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      paramsAndSecrets,
      timeout: Duration.seconds(30),
    });
```

- [ ] **Step 2: Run broker-alpaca-adpt stack tests**

Run: `pnpm nx test broker-alpaca-adpt -- --testPathPattern="service.stack" 2>&1 | tail -20`

Expected: PASS (or no stack test exists — check). If tests fail due to new constructs, update accordingly.

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-alpaca-adpt/src/service.stack.ts
git commit -m "$(cat <<'EOF'
feat(broker-alpaca-adpt): add Parameters and Secrets Extension

Adds ParamsAndSecretsLayerVersion (V1_0_103, 5s TTL) to the Ingress
handler and both poll handler Lambdas. SSM param and secret ID passed
as env var pointers (ALPACA_BASE_URL_PARAM, ALPACA_SECRET_ID).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create SSM parameter and Secrets Manager secret for Alpaca config

**Files:** None (AWS CLI commands against the deployed environment)

- [ ] **Step 1: Create SSM parameter for base URL**

```bash
aws ssm put-parameter \
  --name "/nestfolio/dev-broker-alpaca-adpt/alpaca/baseUrl" \
  --type String \
  --value "https://paper-api.alpaca.markets" \
  --overwrite \
  --region us-east-1
```

Expected: `{"Version": 1, "Tier": "Standard"}`

- [ ] **Step 2: Create Secrets Manager secret for API keys**

```bash
aws secretsmanager create-secret \
  --name "dev-broker-alpaca-adpt/alpaca-api-keys" \
  --secret-string '{"apiKeyId":"PLACEHOLDER","apiKeySecret":"PLACEHOLDER"}' \
  --region us-east-1
```

Expected: `{"ARN": "arn:aws:secretsmanager:us-east-1:771924376645:secret:dev-broker-alpaca-adpt/alpaca-api-keys-XXXXXX", ...}`

If the secret already exists, use `aws secretsmanager put-secret-value --secret-id dev-broker-alpaca-adpt/alpaca-api-keys --secret-string '...'` instead.

- [ ] **Step 3: Verify both resources**

```bash
aws ssm get-parameter --name "/nestfolio/dev-broker-alpaca-adpt/alpaca/baseUrl" --region us-east-1 | jq '.Parameter.Value'
aws secretsmanager get-secret-value --secret-id "dev-broker-alpaca-adpt/alpaca-api-keys" --region us-east-1 | jq '.SecretString | fromjson | keys'
```

Expected: `"https://paper-api.alpaca.markets"` and `["apiKeyId","apiKeySecret"]`

---

### Task 7: Refactor AlpacaClient to lazy-init from extension

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts`

- [ ] **Step 1: Refactor AlpacaClient for lazy initialization**

Replace the entire file `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts` with:

```typescript
import { logger } from '@nestfolio/event-processor';
import type {
  AlpacaOrderApiResponse,
  AlpacaAccountApiResponse,
  AlpacaPositionApiResponse,
  AlpacaTransferApiResponse,
  AlpacaTradeEvent,
} from '../domain/schemas';

export interface AlpacaOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc' | 'ioc';
  limit_price?: number;
}

export interface AlpacaTransferParams {
  transfer_type: 'ach';
  direction: 'INCOMING' | 'OUTGOING';
  amount: string;
  relationship_id: string;
}

export interface AlpacaResponse<T = unknown> {
  status: number;
  data: T;
}

export class AlpacaClient {
  private baseUrl?: string;
  private apiKeyId?: string;
  private apiKeySecret?: string;

  constructor(config?: { baseUrl?: string; apiKeyId?: string; apiKeySecret?: string }) {
    // Direct config injection for unit tests — bypasses resolve()
    if (config?.baseUrl) {
      this.baseUrl = config.baseUrl;
      this.apiKeyId = config.apiKeyId;
      this.apiKeySecret = config.apiKeySecret;
    }
  }

  private async resolve(): Promise<void> {
    if (this.baseUrl) return;

    const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
    const token = process.env.AWS_SESSION_TOKEN!;
    const headers = { 'X-Aws-Parameters-Secrets-Token': token };

    // SSM param
    const paramName = process.env.ALPACA_BASE_URL_PARAM!;
    const paramRes = await fetch(
      `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
      { headers },
    );
    const paramData = await paramRes.json() as { Parameter: { Value: string } };
    this.baseUrl = paramData.Parameter.Value;

    // Secrets Manager
    const secretId = process.env.ALPACA_SECRET_ID!;
    const secretRes = await fetch(
      `http://localhost:${port}/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
      { headers },
    );
    const secretData = await secretRes.json() as { SecretString: string };
    const keys = JSON.parse(secretData.SecretString) as { apiKeyId: string; apiKeySecret: string };
    this.apiKeyId = keys.apiKeyId;
    this.apiKeySecret = keys.apiKeySecret;
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<AlpacaResponse<T>> {
    await this.resolve();
    const url = `${this.baseUrl}${path}`;
    logger.info('Alpaca API request', { method, path });

    const response = await fetch(url, {
      method,
      headers: {
        'APCA-API-KEY-ID': this.apiKeyId!,
        'APCA-API-SECRET-KEY': this.apiKeySecret!,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as T;
    logger.info('Alpaca API response', { method, path, status: response.status });

    return { status: response.status, data };
  }

  async submitOrder(params: AlpacaOrderParams): Promise<AlpacaResponse<AlpacaOrderApiResponse>> {
    return this.request<AlpacaOrderApiResponse>('POST', '/v2/orders', params);
  }

  async cancelOrder(alpacaOrderId: string): Promise<AlpacaResponse<AlpacaOrderApiResponse>> {
    return this.request<AlpacaOrderApiResponse>('DELETE', `/v2/orders/${alpacaOrderId}`);
  }

  async getOrder(orderId: string): Promise<AlpacaResponse<AlpacaOrderApiResponse>> {
    return this.request<AlpacaOrderApiResponse>('GET', `/v2/orders/${orderId}`);
  }

  async getTradeEvents(since: string, until: string): Promise<AlpacaResponse<AlpacaTradeEvent[]>> {
    return this.request<AlpacaTradeEvent[]>('GET', `/v2/events/trades?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
  }

  async getAccount(): Promise<AlpacaResponse<AlpacaAccountApiResponse>> {
    return this.request<AlpacaAccountApiResponse>('GET', '/v2/account');
  }

  async getPositions(): Promise<AlpacaResponse<AlpacaPositionApiResponse[]>> {
    return this.request<AlpacaPositionApiResponse[]>('GET', '/v2/positions');
  }

  async initiateTransfer(params: AlpacaTransferParams): Promise<AlpacaResponse<AlpacaTransferApiResponse>> {
    return this.request<AlpacaTransferApiResponse>('POST', '/v2/ach/transfers', params);
  }

  async getTransfer(transferId: string): Promise<AlpacaResponse<AlpacaTransferApiResponse>> {
    return this.request<AlpacaTransferApiResponse>('GET', `/v2/ach/transfers/${transferId}`);
  }
}
```

**Key change:** Constructor no longer reads `process.env` directly. Unit tests pass `config` → fields set immediately → `resolve()` skips. In Lambda (no config), `resolve()` lazy-fetches from the extension on first API call.

- [ ] **Step 2: Run existing AlpacaClient unit tests**

Run: `pnpm nx test broker-alpaca-adpt -- --testPathPattern="alpaca.client" 2>&1 | tail -20`

Expected: PASS. All unit tests pass `config` to the constructor, so `resolve()` is never called.

- [ ] **Step 3: Run all broker-alpaca-adpt unit tests**

Run: `pnpm nx test broker-alpaca-adpt 2>&1 | tail -20`

Expected: PASS. The `event-listener.ts` instantiates `new AlpacaClient()` at module scope — in unit tests this is mocked. The poll handlers also instantiate `new AlpacaClient()` — also mocked in tests.

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts
git commit -m "$(cat <<'EOF'
feat(broker-alpaca-adpt): refactor AlpacaClient to lazy-init from extension

AlpacaClient now lazy-fetches baseUrl from SSM and API keys from Secrets
Manager via the Parameters and Secrets Lambda Extension on first request.
Unit tests still pass config directly, bypassing resolve(). No unit test
changes needed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Deploy all affected services

**Files:** None (deployment commands)

- [ ] **Step 1: Deploy all affected services**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev
```

This deploys all services. Alternatively, deploy just the affected services:

```bash
pnpm nx run-many -t deploy --projects=investor-web,investor-adpt,advisory-adpt,execution-adpt,ledger-adpt,broker-alpaca-adpt --prefix=dev
```

Expected: All CloudFormation stacks update successfully. The Ingress construct change affects ALL services with Ingress (not just the 4 starters), so a full deploy is safest.

- [ ] **Step 2: Verify deployment**

Check CloudFormation stack status for one affected service:

```bash
aws cloudformation describe-stacks --stack-name dev-broker-alpaca-adpt --region us-east-1 --query "Stacks[0].StackStatus"
```

Expected: `"UPDATE_COMPLETE"`

---

## Phase 2: Test Infrastructure

### Task 9: Create libs/integration-testing Nx library

**Files:**
- Create: `libs/integration-testing/project.json`
- Create: `libs/integration-testing/tsconfig.json`
- Create: `libs/integration-testing/tsconfig.spec.json`
- Create: `libs/integration-testing/jest.config.js`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Create project.json**

Create `libs/integration-testing/project.json`:

```json
{
  "name": "integration-testing",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/integration-testing/src",
  "projectType": "library",
  "targets": {
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "libs/integration-testing/jest.config.js",
        "passWithNoTests": true
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    },
    "build:mocks": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx esbuild libs/integration-testing/src/mock-handlers/mock-alpaca.ts --bundle --platform=node --target=node20 --outfile=libs/integration-testing/assets/mock-alpaca/index.mjs --format=esm && cd libs/integration-testing/assets/mock-alpaca && zip -j ../mock-alpaca.zip index.mjs && cd ../.. && rm -rf assets/mock-alpaca"
      },
      "outputs": ["{projectRoot}/assets/mock-alpaca.zip"]
    }
  },
  "tags": ["scope:platform", "type:lib"]
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `libs/integration-testing/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "target": "ES2022",
    "outDir": "../../dist/libs/integration-testing",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create tsconfig.spec.json**

Create `libs/integration-testing/tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Create jest.config.js**

Create `libs/integration-testing/jest.config.js`:

```javascript
const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'integration-testing',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
};
```

- [ ] **Step 5: Add path mapping to tsconfig.base.json**

In `tsconfig.base.json`, add after the `@nestfolio/event-processor/*` entry (line 35):

```json
      "@nestfolio/integration-testing": ["libs/integration-testing/src/index.ts"],
      "@nestfolio/integration-testing/*": ["libs/integration-testing/src/*"],
```

- [ ] **Step 6: Create directory structure**

```bash
mkdir -p libs/integration-testing/src/fixtures libs/integration-testing/src/mock-handlers libs/integration-testing/assets
```

- [ ] **Step 7: Commit**

```bash
git add libs/integration-testing/project.json libs/integration-testing/tsconfig.json libs/integration-testing/tsconfig.spec.json libs/integration-testing/jest.config.js tsconfig.base.json
git commit -m "$(cat <<'EOF'
feat(integration-testing): scaffold Nx library

Creates libs/integration-testing with project.json, tsconfig, jest config,
and build:mocks target for esbuild mock handler packaging. Adds path
mapping to tsconfig.base.json.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Implement core fixtures (CleanupRegistry, SsmCache, IntegrationContext)

**Files:**
- Create: `libs/integration-testing/src/cleanup.ts`
- Create: `libs/integration-testing/src/ssm-cache.ts`
- Create: `libs/integration-testing/src/context.ts`

- [ ] **Step 1: Create CleanupRegistry**

Create `libs/integration-testing/src/cleanup.ts`:

```typescript
export class CleanupRegistry {
  private readonly actions: { name: string; fn: () => Promise<void> }[] = [];

  register(name: string, fn: () => Promise<void>): void {
    this.actions.push({ name, fn });
  }

  async runAll(): Promise<void> {
    // LIFO order — most recently registered first
    const reversed = [...this.actions].reverse();
    for (const { name, fn } of reversed) {
      try {
        await fn();
      } catch (err) {
        console.error(`Cleanup failed: ${name}`, err);
      }
    }
  }
}
```

- [ ] **Step 2: Create SsmCache**

Create `libs/integration-testing/src/ssm-cache.ts`:

```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export class SsmCache {
  private readonly client: SSMClient;
  private readonly cache = new Map<string, string>();
  private readonly prefix: string;

  constructor(prefix: string, region: string) {
    this.prefix = prefix;
    this.client = new SSMClient({ region });
  }

  private async get(paramName: string): Promise<string> {
    const cached = this.cache.get(paramName);
    if (cached) return cached;

    const result = await this.client.send(new GetParameterCommand({ Name: paramName }));
    const value = result.Parameter?.Value;
    if (!value) throw new Error(`SSM parameter not found: ${paramName}`);

    this.cache.set(paramName, value);
    return value;
  }

  /** Bus ARN: /nestfolio/{prefix}-{subsystem}/event-hub/busArn */
  async busArn(subsystem: string): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-${subsystem}/event-hub/busArn`);
  }

  /** Table name: deterministic "{prefix}-{service}-table" — no SSM needed */
  tableName(service: string): string {
    return `${this.prefix}-${service}-table`;
  }

  /** GraphQL URL: /nestfolio/{prefix}-{service}/api/graphqlUrl */
  async graphqlUrl(service: string): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-${service}/api/graphqlUrl`);
  }

  /** Cognito User Pool ID: /nestfolio/{prefix}-investor/auth/userPoolId */
  async userPoolId(): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-investor/auth/userPoolId`);
  }

  /** Cognito Client ID: /nestfolio/{prefix}-investor/auth/userPoolClientId */
  async userPoolClientId(): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-investor/auth/userPoolClientId`);
  }
}
```

- [ ] **Step 3: Create IntegrationContext factory**

Create `libs/integration-testing/src/context.ts`:

```typescript
import { CleanupRegistry } from './cleanup';
import { SsmCache } from './ssm-cache';

export interface IntegrationContext {
  tenantId: string;
  userId: string;
  prefix: string;
  region: string;
  ssm: SsmCache;
  cleanup: CleanupRegistry;
}

export async function createIntegrationContext(options?: {
  prefix?: string;
  region?: string;
}): Promise<IntegrationContext> {
  const prefix = options?.prefix ?? 'dev';
  const region = options?.region ?? 'us-east-1';
  const timestamp = Date.now();

  return {
    tenantId: `integ-${timestamp}`,
    userId: `integ-user-${timestamp}`,
    prefix,
    region,
    ssm: new SsmCache(prefix, region),
    cleanup: new CleanupRegistry(),
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add libs/integration-testing/src/cleanup.ts libs/integration-testing/src/ssm-cache.ts libs/integration-testing/src/context.ts
git commit -m "$(cat <<'EOF'
feat(integration-testing): add CleanupRegistry, SsmCache, IntegrationContext

Core fixtures for integration test lifecycle: LIFO cleanup registry,
SSM parameter cache with typed accessors, and per-run context factory
with unique integ- tenant/user IDs.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Implement base fixtures (EventBridgeClient, EventBusTrap, TableAssertions, CognitoFixture, AppSyncClient)

**Files:**
- Create: `libs/integration-testing/src/fixtures/event-bridge-client.ts`
- Create: `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`
- Create: `libs/integration-testing/src/fixtures/table-assertions.ts`
- Create: `libs/integration-testing/src/fixtures/cognito.fixture.ts`
- Create: `libs/integration-testing/src/fixtures/appsync-client.ts`

- [ ] **Step 1: Create EventBridgeClient**

Create `libs/integration-testing/src/fixtures/event-bridge-client.ts`:

```typescript
import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { IntegrationContext } from '../context';

export class EventBridgeClient {
  private readonly client: AwsEBClient;
  private readonly ctx: IntegrationContext;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new AwsEBClient({ region: ctx.region });
  }

  async putEvent(params: {
    bus: string;
    targetService: string;
    detailType: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const busArn = await this.ctx.ssm.busArn(params.bus);

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

    await this.client.send(new PutEventsCommand({
      Entries: [{
        EventBusName: busArn,
        Source: `integration-test:${params.targetService}`,
        DetailType: params.detailType,
        Detail: JSON.stringify(detail),
      }],
    }));
  }
}
```

- [ ] **Step 2: Create EventBusTrap**

Create `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`:

```typescript
import {
  EventBridgeClient, PutRuleCommand, PutTargetsCommand,
  RemoveTargetsCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SQSClient, CreateQueueCommand, DeleteQueueCommand,
  ReceiveMessageCommand, GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import type { IntegrationContext } from '../context';

export interface CapturedEvent {
  detailType: string;
  detail: Record<string, unknown>;
  source: string;
  time: string;
}

export class EventBusTrap {
  private readonly eb: EventBridgeClient;
  private readonly sqs: SQSClient;
  private readonly ctx: IntegrationContext;

  private queueUrl?: string;
  private queueArn?: string;
  private ruleName?: string;
  private busArn?: string;
  private captured: CapturedEvent[] = [];

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.eb = new EventBridgeClient({ region: ctx.region });
    this.sqs = new SQSClient({ region: ctx.region });
  }

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

    // Create EB rule
    this.ruleName = trapId;
    const detailTypes = Array.isArray(params.detailType) ? params.detailType : [params.detailType];

    await this.eb.send(new PutRuleCommand({
      Name: this.ruleName,
      EventBusName: this.busArn,
      EventPattern: JSON.stringify({
        'detail-type': detailTypes,
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

    // Wait for rule activation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Register cleanup
    this.ctx.cleanup.register('EventBusTrap', () => this.teardown());
  }

  async waitForEvent(params?: {
    detailType?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<CapturedEvent> {
    const timeout = params?.timeoutMs ?? 30_000;
    const pollInterval = params?.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      // Check captured buffer first
      if (params?.detailType) {
        const match = this.captured.find(e => e.detailType === params.detailType);
        if (match) {
          this.captured = this.captured.filter(e => e !== match);
          return match;
        }
      } else if (this.captured.length > 0) {
        return this.captured.shift()!;
      }

      // Poll SQS
      const result = await this.sqs.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl!,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: Math.min(5, Math.ceil((deadline - Date.now()) / 1000)),
      }));

      for (const msg of result.Messages ?? []) {
        const body = JSON.parse(msg.Body!);
        const event: CapturedEvent = {
          detailType: body['detail-type'],
          detail: body.detail,
          source: body.source,
          time: body.time,
        };

        if (params?.detailType && event.detailType === params.detailType) {
          return event;
        }
        if (!params?.detailType) {
          return event;
        }
        // Buffer non-matching events
        this.captured.push(event);
      }

      if (!result.Messages?.length) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`EventBusTrap: timeout waiting for event${params?.detailType ? ` ${params.detailType}` : ''} after ${timeout}ms`);
  }

  async drain(): Promise<CapturedEvent[]> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl!,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,
    }));

    const events: CapturedEvent[] = [...this.captured];
    this.captured = [];

    for (const msg of result.Messages ?? []) {
      const body = JSON.parse(msg.Body!);
      events.push({
        detailType: body['detail-type'],
        detail: body.detail,
        source: body.source,
        time: body.time,
      });
    }

    return events;
  }

  async teardown(): Promise<void> {
    try {
      if (this.ruleName && this.busArn) {
        await this.eb.send(new RemoveTargetsCommand({
          Rule: this.ruleName,
          EventBusName: this.busArn,
          Ids: ['trap-target'],
        }));
        await this.eb.send(new DeleteRuleCommand({
          Name: this.ruleName,
          EventBusName: this.busArn,
        }));
      }
    } catch (err) {
      console.error('EventBusTrap: failed to delete EB rule', err);
    }
    try {
      if (this.queueUrl) {
        await this.sqs.send(new DeleteQueueCommand({ QueueUrl: this.queueUrl }));
      }
    } catch (err) {
      console.error('EventBusTrap: failed to delete SQS queue', err);
    }
  }
}
```

- [ ] **Step 3: Create TableAssertions**

Create `libs/integration-testing/src/fixtures/table-assertions.ts`:

```typescript
import { DynamoDBClient, GetItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import type { IntegrationContext } from '../context';

export class TableAssertions {
  private readonly client: DynamoDBClient;
  private readonly ctx: IntegrationContext;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
  }

  async waitForItem(params: {
    table: string;
    pk: string;
    sk?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<Record<string, unknown>> {
    const timeout = params.timeoutMs ?? 30_000;
    const pollInterval = params.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;
    const tableName = this.ctx.ssm.tableName(params.table);

    while (Date.now() < deadline) {
      if (params.sk) {
        const result = await this.client.send(new GetItemCommand({
          TableName: tableName,
          Key: marshall({ pk: params.pk, sk: params.sk }),
        }));
        if (result.Item) return unmarshall(result.Item);
      } else {
        // Query by pk, optionally with sk prefix
        const result = await this.client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': params.pk }),
          Limit: 1,
        }));
        if (result.Items?.length) return unmarshall(result.Items[0]);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`TableAssertions: timeout waiting for item pk=${params.pk} sk=${params.sk ?? '(any)'} in ${params.table} after ${timeout}ms`);
  }

  async assertItem(params: {
    table: string;
    pk: string;
    sk: string;
    expect: Record<string, unknown>;
  }): Promise<void> {
    const tableName = this.ctx.ssm.tableName(params.table);
    const result = await this.client.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall({ pk: params.pk, sk: params.sk }),
    }));

    if (!result.Item) {
      throw new Error(`TableAssertions: item not found pk=${params.pk} sk=${params.sk}`);
    }

    const item = unmarshall(result.Item);
    for (const [key, expectedValue] of Object.entries(params.expect)) {
      if (item[key] !== expectedValue) {
        throw new Error(`TableAssertions: expected ${key}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(item[key])}`);
      }
    }
  }

  async queryItems(params: {
    table: string;
    pk: string;
    skPrefix?: string;
  }): Promise<Record<string, unknown>[]> {
    const tableName = this.ctx.ssm.tableName(params.table);
    const keyCondition = params.skPrefix
      ? 'pk = :pk AND begins_with(sk, :skPrefix)'
      : 'pk = :pk';
    const exprValues: Record<string, unknown> = { ':pk': params.pk };
    if (params.skPrefix) exprValues[':skPrefix'] = params.skPrefix;

    const result = await this.client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: marshall(exprValues),
    }));

    return (result.Items ?? []).map(item => unmarshall(item));
  }

  async cleanup(params: { table: string; pk: string }): Promise<void> {
    const items = await this.queryItems({ table: params.table, pk: params.pk });
    const tableName = this.ctx.ssm.tableName(params.table);

    for (const item of items) {
      await this.client.send(new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({ pk: item['pk'], sk: item['sk'] }),
      }));
    }
  }
}
```

- [ ] **Step 4: Create CognitoFixture**

Create `libs/integration-testing/src/fixtures/cognito.fixture.ts`:

```typescript
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { IntegrationContext } from '../context';

export interface CognitoTokens {
  idToken: string;
  accessToken: string;
}

export class CognitoFixture {
  private readonly client: CognitoIdentityProviderClient;
  private readonly ctx: IntegrationContext;
  private username?: string;
  private userPoolId?: string;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new CognitoIdentityProviderClient({ region: ctx.region });
  }

  async setup(): Promise<CognitoTokens> {
    this.userPoolId = await this.ctx.ssm.userPoolId();
    const clientId = await this.ctx.ssm.userPoolClientId();
    const email = `integ-${Date.now()}@test.nestfolio.dev`;
    this.username = email;
    const password = 'IntegTest1!';

    // Create user with suppressed verification email
    await this.client.send(new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: this.ctx.tenantId },
      ],
    }));

    // Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
    await this.client.send(new AdminSetUserPasswordCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }));

    // Authenticate to get tokens
    const authResult = await this.client.send(new AdminInitiateAuthCommand({
      UserPoolId: this.userPoolId,
      ClientId: clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }));

    // Register cleanup
    this.ctx.cleanup.register('CognitoFixture', () => this.teardown());

    return {
      idToken: authResult.AuthenticationResult!.IdToken!,
      accessToken: authResult.AuthenticationResult!.AccessToken!,
    };
  }

  async teardown(): Promise<void> {
    if (!this.username || !this.userPoolId) return;
    try {
      await this.client.send(new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: this.username,
      }));
    } catch (err) {
      console.error('CognitoFixture: failed to delete test user', err);
    }
  }
}
```

- [ ] **Step 5: Create AppSyncClient**

Create `libs/integration-testing/src/fixtures/appsync-client.ts`:

```typescript
import type { IntegrationContext } from '../context';
import type { CognitoTokens } from './cognito.fixture';

export class AppSyncClient {
  private readonly graphqlUrl: Promise<string>;
  private readonly idToken: string;

  constructor(ctx: IntegrationContext, tokens: CognitoTokens) {
    this.graphqlUrl = ctx.ssm.graphqlUrl('investor-bff');
    this.idToken = tokens.idToken;
  }

  async query<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.execute<T>(operation, variables);
  }

  async mutate<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.execute<T>(operation, variables);
  }

  private async execute<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
    const url = await this.graphqlUrl;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.idToken,
      },
      body: JSON.stringify({ query: operation, variables }),
    });

    const json = await response.json() as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data as T;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add libs/integration-testing/src/fixtures/
git commit -m "$(cat <<'EOF'
feat(integration-testing): add base fixtures

EventBridgeClient (target-aware source publishing), EventBusTrap
(temp EB rule + SQS queue for CDC assertion), TableAssertions (DDB
polling + partial match), CognitoFixture (admin user lifecycle),
AppSyncClient (authenticated GraphQL via raw fetch).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Implement 3P-ADPT fixtures (MockApiFixture, SsmOverrideFixture)

**Files:**
- Create: `libs/integration-testing/src/fixtures/mock-api.fixture.ts`
- Create: `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`

- [ ] **Step 1: Create MockApiFixture**

Create `libs/integration-testing/src/fixtures/mock-api.fixture.ts`:

```typescript
import {
  IAMClient, CreateRoleCommand, DeleteRoleCommand,
  AttachRolePolicyCommand, DetachRolePolicyCommand,
} from '@aws-sdk/client-iam';
import {
  LambdaClient, CreateFunctionCommand, DeleteFunctionCommand,
  GetFunctionConfigurationCommand, CreateFunctionUrlConfigCommand,
  DeleteFunctionUrlConfigCommand, AddPermissionCommand,
} from '@aws-sdk/client-lambda';
import type { IntegrationContext } from '../context';

const BASIC_EXECUTION_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

export class MockApiFixture {
  private readonly iam: IAMClient;
  private readonly lambda: LambdaClient;
  private readonly ctx: IntegrationContext;

  private roleName?: string;
  private roleArn?: string;
  private functionName?: string;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.iam = new IAMClient({ region: ctx.region });
    this.lambda = new LambdaClient({ region: ctx.region });
  }

  async deploy(params: {
    name: string;
    handlerAsset: Buffer;
  }): Promise<string> {
    const timestamp = Date.now();
    this.roleName = `integ-mock-${params.name}-${timestamp}`;
    this.functionName = `integ-mock-${params.name}-${timestamp}`;

    // Create IAM role
    const assumeRolePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: 'sts:AssumeRole',
      }],
    });

    const roleResult = await this.iam.send(new CreateRoleCommand({
      RoleName: this.roleName,
      AssumeRolePolicyDocument: assumeRolePolicy,
    }));
    this.roleArn = roleResult.Role!.Arn!;

    await this.iam.send(new AttachRolePolicyCommand({
      RoleName: this.roleName,
      PolicyArn: BASIC_EXECUTION_POLICY,
    }));

    // Create Lambda (retry on IAM propagation)
    let attempts = 0;
    while (attempts < 5) {
      try {
        await this.lambda.send(new CreateFunctionCommand({
          FunctionName: this.functionName,
          Runtime: 'nodejs20.x',
          Handler: 'index.handler',
          Role: this.roleArn,
          Code: { ZipFile: params.handlerAsset },
          Timeout: 30,
          MemorySize: 128,
        }));
        break;
      } catch (err: unknown) {
        const errName = (err as { name?: string }).name;
        if (errName === 'InvalidParameterValueException' && attempts < 4) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          continue;
        }
        throw err;
      }
    }

    // Wait for Active state
    let state = '';
    while (state !== 'Active') {
      const config = await this.lambda.send(new GetFunctionConfigurationCommand({
        FunctionName: this.functionName,
      }));
      state = config.State ?? '';
      if (state !== 'Active') {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Create Function URL
    const urlResult = await this.lambda.send(new CreateFunctionUrlConfigCommand({
      FunctionName: this.functionName,
      AuthType: 'NONE',
    }));

    // Add public invoke permission
    await this.lambda.send(new AddPermissionCommand({
      FunctionName: this.functionName,
      StatementId: 'FunctionURLAllowPublicAccess',
      Action: 'lambda:InvokeFunctionUrl',
      Principal: '*',
      FunctionUrlAuthType: 'NONE',
    }));

    // Register cleanup
    this.ctx.cleanup.register('MockApiFixture', () => this.teardown());

    return urlResult.FunctionUrl!;
  }

  async teardown(): Promise<void> {
    try {
      if (this.functionName) {
        try {
          await this.lambda.send(new DeleteFunctionUrlConfigCommand({
            FunctionName: this.functionName,
          }));
        } catch { /* may not exist */ }
        await this.lambda.send(new DeleteFunctionCommand({
          FunctionName: this.functionName,
        }));
      }
    } catch (err) {
      console.error('MockApiFixture: failed to delete Lambda', err);
    }
    try {
      if (this.roleName) {
        await this.iam.send(new DetachRolePolicyCommand({
          RoleName: this.roleName,
          PolicyArn: BASIC_EXECUTION_POLICY,
        }));
        await this.iam.send(new DeleteRoleCommand({ RoleName: this.roleName }));
      }
    } catch (err) {
      console.error('MockApiFixture: failed to delete IAM role', err);
    }
  }
}
```

- [ ] **Step 2: Create SsmOverrideFixture**

Create `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`:

```typescript
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import type { IntegrationContext } from '../context';

export class SsmOverrideFixture {
  private readonly client: SSMClient;
  private readonly ctx: IntegrationContext;
  private paramName?: string;
  private originalValue?: string;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new SSMClient({ region: ctx.region });
  }

  async override(params: {
    paramName: string;
    testValue: string;
    waitMs?: number;
  }): Promise<void> {
    this.paramName = params.paramName;

    // Save current value
    const current = await this.client.send(new GetParameterCommand({
      Name: params.paramName,
    }));
    this.originalValue = current.Parameter?.Value;

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
    if (!this.paramName || !this.originalValue) return;
    try {
      await this.client.send(new PutParameterCommand({
        Name: this.paramName,
        Value: this.originalValue,
        Type: 'String',
        Overwrite: true,
      }));
    } catch (err) {
      console.error('SsmOverrideFixture: failed to restore SSM value', err);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add libs/integration-testing/src/fixtures/mock-api.fixture.ts libs/integration-testing/src/fixtures/ssm-override.fixture.ts
git commit -m "$(cat <<'EOF'
feat(integration-testing): add MockApiFixture and SsmOverrideFixture

MockApiFixture creates ephemeral Lambda + Function URL for mock APIs.
SsmOverrideFixture saves/overrides/restores SSM parameters with TTL
delay for Lambda extension cache invalidation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Implement mock-alpaca handler + esbuild zip target

**Files:**
- Create: `libs/integration-testing/src/mock-handlers/mock-alpaca.ts`

- [ ] **Step 1: Create mock-alpaca handler**

Create `libs/integration-testing/src/mock-handlers/mock-alpaca.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

const orders = new Map<string, Record<string, unknown>>();
const transfers = new Map<string, Record<string, unknown>>();
const pollCounts = new Map<string, number>();

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function getScenario(identifier: string): string {
  if (identifier.startsWith('integ-fill-')) return 'fill';
  if (identifier.startsWith('integ-partial-')) return 'partial';
  if (identifier.startsWith('integ-reject-')) return 'reject';
  if (identifier.startsWith('integ-cancel-')) return 'cancel';
  if (identifier.startsWith('integ-transfer-ok-')) return 'transfer-ok';
  if (identifier.startsWith('integ-transfer-fail-')) return 'transfer-fail';
  return 'fill'; // safe default
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // POST /v2/orders — submit order
  if (method === 'POST' && path === '/v2/orders') {
    const body = JSON.parse(event.body ?? '{}');
    const clientOrderId = body.client_order_id ?? body.symbol ?? '';
    const scenario = getScenario(clientOrderId);

    if (scenario === 'reject') {
      return json(422, { message: 'insufficient buying power' });
    }

    const id = `mock-${randomUUID()}`;
    const order = {
      id, client_order_id: clientOrderId, symbol: body.symbol,
      qty: body.qty, side: body.side, type: body.type,
      status: 'accepted', filled_qty: '0', filled_avg_price: '0',
    };
    orders.set(id, order);
    return json(200, order);
  }

  // DELETE /v2/orders/{orderId} — cancel order
  const cancelMatch = path.match(/^\/v2\/orders\/(.+)$/);
  if (method === 'DELETE' && cancelMatch) {
    const orderId = cancelMatch[1];
    const order = orders.get(orderId);
    if (order) order['status'] = 'canceled';
    return { statusCode: 204, body: '' };
  }

  // GET /v2/orders/{orderId} — poll order status
  const getOrderMatch = path.match(/^\/v2\/orders\/(.+)$/);
  if (method === 'GET' && getOrderMatch) {
    const orderId = getOrderMatch[1];
    const order = orders.get(orderId);
    if (!order) return json(404, { message: 'order not found' });

    const clientOrderId = (order['client_order_id'] as string) ?? '';
    const scenario = getScenario(clientOrderId);
    const count = (pollCounts.get(orderId) ?? 0) + 1;
    pollCounts.set(orderId, count);

    if (scenario === 'fill' || scenario === 'cancel') {
      return json(200, { ...order, status: scenario === 'cancel' ? 'canceled' : 'filled', filled_qty: order['qty'], filled_avg_price: '150.00' });
    }
    if (scenario === 'partial') {
      if (count <= 1) {
        return json(200, { ...order, status: 'partially_filled', filled_qty: '1', filled_avg_price: '150.00' });
      }
      return json(200, { ...order, status: 'filled', filled_qty: order['qty'], filled_avg_price: '150.00' });
    }
    return json(200, { ...order, status: 'filled', filled_qty: order['qty'], filled_avg_price: '150.00' });
  }

  // POST /v2/ach/transfers — initiate transfer
  if (method === 'POST' && path === '/v2/ach/transfers') {
    const body = JSON.parse(event.body ?? '{}');
    const id = `mock-${randomUUID()}`;
    const transfer = { id, status: 'QUEUED', direction: body.direction, amount: body.amount };
    transfers.set(id, transfer);
    return json(200, transfer);
  }

  // GET /v2/ach/transfers/{transferId} — poll transfer status
  const getTransferMatch = path.match(/^\/v2\/ach\/transfers\/(.+)$/);
  if (method === 'GET' && getTransferMatch) {
    const transferId = getTransferMatch[1];
    const transfer = transfers.get(transferId);
    if (!transfer) return json(404, { message: 'transfer not found' });

    // Infer scenario from transfer direction/amount or use default
    // The test controls scenario via the nestfolioTransferId prefix in the event detail,
    // but the mock only sees the Alpaca transfer. Use a simple heuristic:
    // If the transfer exists, return COMPLETE (tests control scenario via orderId prefix).
    return json(200, { ...transfer, status: 'COMPLETE' });
  }

  // GET /v2/account
  if (method === 'GET' && path === '/v2/account') {
    return json(200, {
      id: 'mock-account',
      equity: '125000.00',
      buying_power: '50000.00',
      cash: '50000.00',
      portfolio_value: '75000.00',
    });
  }

  // GET /v2/positions
  if (method === 'GET' && path === '/v2/positions') {
    return json(200, [
      { symbol: 'AAPL', qty: '10', market_value: '1750.00', avg_entry_price: '150.00' },
    ]);
  }

  return json(404, { message: `Unknown route: ${method} ${path}` });
}
```

- [ ] **Step 2: Build the mock zip**

```bash
pnpm nx build:mocks integration-testing
```

Expected: `libs/integration-testing/assets/mock-alpaca.zip` created.

- [ ] **Step 3: Verify the zip**

```bash
ls -la libs/integration-testing/assets/mock-alpaca.zip
unzip -l libs/integration-testing/assets/mock-alpaca.zip
```

Expected: single `index.mjs` file in the zip.

- [ ] **Step 4: Commit**

```bash
git add libs/integration-testing/src/mock-handlers/mock-alpaca.ts libs/integration-testing/assets/mock-alpaca.zip
git commit -m "$(cat <<'EOF'
feat(integration-testing): add mock-alpaca handler + esbuild zip

Scenario-routed mock Lambda handler for Alpaca API. Routes: POST/GET/DELETE
orders, POST/GET transfers, GET account/positions. Scenarios controlled via
identifier prefix (integ-fill-, integ-reject-, etc.). Pre-built zip via
build:mocks target.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Create barrel export

**Files:**
- Create: `libs/integration-testing/src/index.ts`

- [ ] **Step 1: Create barrel**

Create `libs/integration-testing/src/index.ts`:

```typescript
export { CleanupRegistry } from './cleanup';
export { SsmCache } from './ssm-cache';
export { createIntegrationContext, type IntegrationContext } from './context';
export { EventBridgeClient } from './fixtures/event-bridge-client';
export { EventBusTrap, type CapturedEvent } from './fixtures/event-bus-trap.fixture';
export { TableAssertions } from './fixtures/table-assertions';
export { CognitoFixture, type CognitoTokens } from './fixtures/cognito.fixture';
export { AppSyncClient } from './fixtures/appsync-client';
export { MockApiFixture } from './fixtures/mock-api.fixture';
export { SsmOverrideFixture } from './fixtures/ssm-override.fixture';
```

- [ ] **Step 2: Commit**

```bash
git add libs/integration-testing/src/index.ts
git commit -m "$(cat <<'EOF'
feat(integration-testing): add barrel export

Public API: createIntegrationContext, EventBridgeClient, EventBusTrap,
TableAssertions, CognitoFixture, AppSyncClient, MockApiFixture,
SsmOverrideFixture.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Move existing unit tests to test/unit/

**Files:**
- Move: test files for all 4 starter services

- [ ] **Step 1: Move investor-adpt tests**

```bash
mkdir -p services/investor/investor-adpt/test/unit
mv services/investor/investor-adpt/test/service.stack.test.ts services/investor/investor-adpt/test/unit/
```

- [ ] **Step 2: Move investor-ctrl tests**

```bash
mkdir -p services/investor/investor-ctrl/test/unit
mv services/investor/investor-ctrl/test/event-listener.test.ts services/investor/investor-ctrl/test/unit/
mv services/investor/investor-ctrl/test/notification-delivery.service.test.ts services/investor/investor-ctrl/test/unit/
mv services/investor/investor-ctrl/test/notification-lifecycle.service.test.ts services/investor/investor-ctrl/test/unit/
mv services/investor/investor-ctrl/test/notification.repository.test.ts services/investor/investor-ctrl/test/unit/
```

- [ ] **Step 3: Move investor-bff tests**

```bash
mkdir -p services/investor/investor-bff/test/unit/handlers services/investor/investor-bff/test/unit/repositories services/investor/investor-bff/test/unit/transforms
mv services/investor/investor-bff/test/handlers/event-listener.test.ts services/investor/investor-bff/test/unit/handlers/
mv services/investor/investor-bff/test/repositories/investor-profile.repository.test.ts services/investor/investor-bff/test/unit/repositories/
mv services/investor/investor-bff/test/transforms/*.test.ts services/investor/investor-bff/test/unit/transforms/
```

Then remove the now-empty directories:

```bash
rmdir services/investor/investor-bff/test/handlers services/investor/investor-bff/test/repositories services/investor/investor-bff/test/transforms
```

- [ ] **Step 4: Move broker-alpaca-adpt tests**

```bash
mkdir -p services/execution/broker-alpaca-adpt/test/unit
mv services/execution/broker-alpaca-adpt/test/*.test.ts services/execution/broker-alpaca-adpt/test/unit/
```

- [ ] **Step 5: Verify moves**

```bash
find services/investor/investor-adpt/test services/investor/investor-ctrl/test services/investor/investor-bff/test services/execution/broker-alpaca-adpt/test -name "*.test.ts" | sort
```

Expected: all files now under `test/unit/`.

- [ ] **Step 6: Commit**

```bash
git add -A services/investor/investor-adpt/test services/investor/investor-ctrl/test services/investor/investor-bff/test services/execution/broker-alpaca-adpt/test
git commit -m "$(cat <<'EOF'
refactor: move unit tests to test/unit/ for 4 starter services

Moves existing test files to test/unit/ subdirectory for investor-adpt,
investor-ctrl, investor-bff, and broker-alpaca-adpt. Prepares for
test/integration/ directory alongside.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Update jest.config.js for unit tests

**Files:**
- Modify: `services/investor/investor-adpt/jest.config.js`
- Modify: `services/investor/investor-ctrl/jest.config.js`
- Modify: `services/investor/investor-bff/jest.config.js`
- Modify: `services/execution/broker-alpaca-adpt/jest.config.js`

- [ ] **Step 1: Update investor-adpt jest.config.js**

In `services/investor/investor-adpt/jest.config.js`, add `testMatch` after `testEnvironment`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-adpt',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 2: Update investor-ctrl jest.config.js**

In `services/investor/investor-ctrl/jest.config.js`, add `testMatch` after `testEnvironment`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-ctrl',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-bff/events$': '<rootDir>/../../investor/investor-bff/src/domain/events.ts',
    '^@nestfolio/advisory-adpt/domain$': '<rootDir>/../../advisory/advisory-adpt/src/domain/index.ts',
    '^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 3: Update investor-bff jest.config.js**

In `services/investor/investor-bff/jest.config.js`, add `testMatch` after `testEnvironment`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-bff',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
    '^@nestfolio/investor-ctrl/events$': '<rootDir>/../../investor/investor-ctrl/src/domain/events.ts',
    '^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 4: Update broker-alpaca-adpt jest.config.js**

In `services/execution/broker-alpaca-adpt/jest.config.js`, add `testMatch` after `testEnvironment`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'broker-alpaca-adpt',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs/(.*)$': '<rootDir>/../../../libs/cdk-constructs/src/$1/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 5: Run unit tests to verify**

```bash
pnpm nx run-many -t test --projects=investor-adpt,investor-ctrl,investor-bff,broker-alpaca-adpt 2>&1 | tail -30
```

Expected: All unit tests pass with the new `testMatch` pointing to `test/unit/`.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-adpt/jest.config.js services/investor/investor-ctrl/jest.config.js services/investor/investor-bff/jest.config.js services/execution/broker-alpaca-adpt/jest.config.js
git commit -m "$(cat <<'EOF'
refactor: scope jest.config.js testMatch to test/unit/ for 4 services

Updates testMatch to '<rootDir>/test/unit/**/*.test.ts' for investor-adpt,
investor-ctrl, investor-bff, and broker-alpaca-adpt. Existing unit tests
continue running from their new location.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Create jest.integration.config.js and add test:integration targets

**Files:**
- Create: `services/investor/investor-adpt/jest.integration.config.js`
- Create: `services/investor/investor-ctrl/jest.integration.config.js`
- Create: `services/investor/investor-bff/jest.integration.config.js`
- Create: `services/execution/broker-alpaca-adpt/jest.integration.config.js`
- Modify: `services/investor/investor-adpt/project.json`
- Modify: `services/investor/investor-ctrl/project.json`
- Modify: `services/investor/investor-bff/project.json`
- Modify: `services/execution/broker-alpaca-adpt/project.json`

- [ ] **Step 1: Create investor-adpt jest.integration.config.js**

Create `services/investor/investor-adpt/jest.integration.config.js`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-adpt-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  testTimeout: 120_000,
};
```

- [ ] **Step 2: Create investor-ctrl jest.integration.config.js**

Create `services/investor/investor-ctrl/jest.integration.config.js`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-ctrl-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  testTimeout: 120_000,
};
```

- [ ] **Step 3: Create investor-bff jest.integration.config.js**

Create `services/investor/investor-bff/jest.integration.config.js`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'investor-bff-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  testTimeout: 120_000,
};
```

- [ ] **Step 4: Create broker-alpaca-adpt jest.integration.config.js**

Create `services/execution/broker-alpaca-adpt/jest.integration.config.js`:

```javascript
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'broker-alpaca-adpt-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  testTimeout: 120_000,
};
```

- [ ] **Step 5: Add test:integration target to investor-adpt project.json**

In `services/investor/investor-adpt/project.json`, add after the `"test"` target:

```json
    "test:integration": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/investor/investor-adpt/jest.integration.config.js" }
    },
```

- [ ] **Step 6: Add test:integration target to investor-ctrl project.json**

In `services/investor/investor-ctrl/project.json`, add after the `"test"` target:

```json
    "test:integration": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/investor/investor-ctrl/jest.integration.config.js" }
    },
```

- [ ] **Step 7: Add test:integration target to investor-bff project.json**

In `services/investor/investor-bff/project.json`, add after the `"test"` target:

```json
    "test:integration": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/investor/investor-bff/jest.integration.config.js" }
    },
```

- [ ] **Step 8: Add test:integration target to broker-alpaca-adpt project.json**

In `services/execution/broker-alpaca-adpt/project.json`, add after the `"test"` target:

```json
    "test:integration": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/execution/broker-alpaca-adpt/jest.integration.config.js" }
    },
```

- [ ] **Step 9: Commit**

```bash
git add services/investor/investor-adpt/jest.integration.config.js services/investor/investor-adpt/project.json \
      services/investor/investor-ctrl/jest.integration.config.js services/investor/investor-ctrl/project.json \
      services/investor/investor-bff/jest.integration.config.js services/investor/investor-bff/project.json \
      services/execution/broker-alpaca-adpt/jest.integration.config.js services/execution/broker-alpaca-adpt/project.json
git commit -m "$(cat <<'EOF'
feat: add jest.integration.config.js and test:integration targets

Creates integration jest configs (120s timeout, test/integration/ match)
and adds test:integration Nx target to investor-adpt, investor-ctrl,
investor-bff, and broker-alpaca-adpt.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Integration Tests

### Task 18: Write investor-adpt integration test (ADPT pattern)

**Files:**
- Create: `services/investor/investor-adpt/test/integration/from-execution.integration.test.ts`

- [ ] **Step 1: Create the test file**

Create `services/investor/investor-adpt/test/integration/from-execution.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Execution → Investor forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on InvestorBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'investor',
      detailType: 'ORDER_REJECTED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward ORDER_REJECTED from ExecutionBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'investor-adpt',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `integ-order-${Date.now()}`,
        reason: 'SAFETY_CHECK_FAILED',
      },
    });

    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('ORDER_REJECTED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm nx test:integration investor-adpt 2>&1 | tail -30`

Expected: PASS (1 test, 1 passed). The test publishes to ExecutionBus with `source: integration-test:investor-adpt`, which passes investor-adpt's EB rule filter. The event lands on InvestorBus where the trap catches it.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-adpt/test/integration/from-execution.integration.test.ts
git commit -m "$(cat <<'EOF'
test(investor-adpt): add integration test for Execution → Investor forwarding

Verifies ORDER_REJECTED events published to ExecutionBus are forwarded to
InvestorBus via investor-adpt's EB rule. Uses EventBusTrap for assertion.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Write investor-ctrl integration test (CTRL pattern)

**Files:**
- Create: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`

- [ ] **Step 1: Create the test file**

Create `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-ctrl: ONBOARDING_COMPLETED notification', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Trap NOTIFICATION_CREATED on InvestorBus
    await trap.deploy({
      bus: 'investor',
      detailType: 'NOTIFICATION_CREATED',
    });
  }, 60_000);

  afterAll(async () => {
    // Clean up test data from DDB
    await table.cleanup({
      table: 'investor-ctrl',
      pk: `Notification#${ctx.tenantId}#${ctx.userId}`,
    });
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create welcome notification on ONBOARDING_COMPLETED', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-ctrl',
      detailType: 'ONBOARDING_COMPLETED',
      detail: {
        goal: 'RETIREMENT',
        riskTolerance: 'MODERATE',
      },
    });

    // Assert: Notification record in DDB
    const item = await table.waitForItem({
      table: 'investor-ctrl',
      pk: `Notification#${ctx.tenantId}#${ctx.userId}`,
    });
    expect(item['title']).toContain('Welcome');

    // Assert: CDC event emitted
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('NOTIFICATION_CREATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm nx test:integration investor-ctrl 2>&1 | tail -30`

Expected: PASS. The test publishes ONBOARDING_COMPLETED to InvestorBus → investor-ctrl's Ingress processes it → creates Notification in DDB → CDC emits NOTIFICATION_CREATED → trap catches it.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts
git commit -m "$(cat <<'EOF'
test(investor-ctrl): add integration test for ONBOARDING_COMPLETED

Verifies the full CTRL pipeline: ONBOARDING_COMPLETED event → SQS →
Lambda → Notification record in DDB → CDC → NOTIFICATION_CREATED on
InvestorBus. Uses TableAssertions + EventBusTrap.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Write investor-bff integration test (BFF pattern)

**Files:**
- Create: `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts`

- [ ] **Step 1: Create the test file**

Create `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  CognitoFixture,
  AppSyncClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-bff: initiateDeposit', () => {
  let ctx: IntegrationContext;
  let cognito: CognitoFixture;
  let appsync: AppSyncClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Deploy trap BEFORE the mutation (captures DEPOSIT_INITIATED on InvestorBus)
    await trap.deploy({
      bus: 'investor',
      detailType: 'DEPOSIT_INITIATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create deposit record and emit DEPOSIT_INITIATED', async () => {
    // Act: authenticated GraphQL mutation
    const result = await appsync.mutate<{
      initiateDeposit: { depositId: string; status: string };
    }>(`
      mutation InitiateDeposit($input: InitiateDepositInput!) {
        initiateDeposit(input: $input) { depositId status }
      }
    `, {
      input: { amountCents: 100_000, currency: 'USD' },
    });

    expect(result.initiateDeposit.status).toBe('INITIATED');

    // Assert: DDB state
    const item = await table.waitForItem({
      table: 'investor-bff',
      pk: `InvestorProfile#${ctx.tenantId}#${ctx.userId}`,
      sk: 'Deposit#',
    });
    expect(item['amountCents']).toBe(100_000);

    // Assert: CDC event on EventBridge
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('DEPOSIT_INITIATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm nx test:integration investor-bff 2>&1 | tail -30`

Expected: PASS. Full BFF pipeline: Cognito auth → GraphQL mutation → DDB write → CDC → DEPOSIT_INITIATED.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts
git commit -m "$(cat <<'EOF'
test(investor-bff): add integration test for initiateDeposit

Verifies full BFF pipeline: Cognito auth → AppSync mutation →
DDB Deposit record → CDC → DEPOSIT_INITIATED on InvestorBus.
Uses CognitoFixture + AppSyncClient + TableAssertions + EventBusTrap.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Write broker-alpaca-adpt integration tests (3P-ADPT pattern)

**Files:**
- Create: `services/execution/broker-alpaca-adpt/test/integration/order-flow.integration.test.ts`
- Create: `services/execution/broker-alpaca-adpt/test/integration/transfer-flow.integration.test.ts`
- Create: `services/execution/broker-alpaca-adpt/test/integration/account-check.integration.test.ts`

- [ ] **Step 1: Create order-flow test**

Create `services/execution/broker-alpaca-adpt/test/integration/order-flow.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-alpaca-adpt: order flow', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    // Deploy mock Alpaca Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '../../../../..', 'libs/integration-testing/assets/mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Single trap captures all outbound event types
    await trap.deploy({
      bus: 'execution',
      detailType: [
        'ALPACA_ORDER_PLACED', 'ALPACA_ORDER_FILLED', 'ALPACA_ORDER_REJECTED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should place order, trigger polling SF, and fill', async () => {
    const orderId = `integ-fill-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
    });

    // Assert: initial DDB write (PLACED)
    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
      sk: 'OrderMapping',
    });
    expect(item['status']).toBe('PLACED');
    expect(item['alpacaOrderId']).toBeTruthy();

    // Assert: CDC emits ALPACA_ORDER_PLACED
    const placedEvent = await trap.waitForEvent({ detailType: 'ALPACA_ORDER_PLACED' });
    expect(placedEvent.detail.subject.nestfolioOrderId).toBe(orderId);

    // Assert: SF polls mock, writes FILLED, CDC emits ALPACA_ORDER_FILLED
    const filledEvent = await trap.waitForEvent({
      detailType: 'ALPACA_ORDER_FILLED',
      timeoutMs: 90_000,
    });
    expect(filledEvent.detail.subject.nestfolioOrderId).toBe(orderId);
  }, 120_000);

  it('should reject order and emit ALPACA_ORDER_REJECTED', async () => {
    const orderId = `integ-reject-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
      sk: 'OrderMapping',
    });
    expect(item['status']).toBe('REJECTED');
    expect(item['rejectionReason']).toBeTruthy();

    const event = await trap.waitForEvent({ detailType: 'ALPACA_ORDER_REJECTED' });
    expect(event.detail.subject.status).toBe('REJECTED');
  }, 60_000);
});
```

- [ ] **Step 2: Create transfer-flow test**

Create `services/execution/broker-alpaca-adpt/test/integration/transfer-flow.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-alpaca-adpt: transfer flow', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '../../../../..', 'libs/integration-testing/assets/mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    await trap.deploy({
      bus: 'execution',
      detailType: ['ALPACA_TRANSFER_INITIATED', 'ALPACA_TRANSFER_COMPLETED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should initiate transfer, trigger polling SF, and complete', async () => {
    const transferId = `integ-transfer-ok-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: {
        transferId,
        direction: 'INCOMING',
        amount: 10000,
        relationshipId: 'rel-integ',
      },
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
    });
    expect(item['status']).toBe('INITIATED');

    const initiatedEvent = await trap.waitForEvent({ detailType: 'ALPACA_TRANSFER_INITIATED' });
    expect(initiatedEvent.detail.subject.nestfolioTransferId).toBe(transferId);

    const completedEvent = await trap.waitForEvent({
      detailType: 'ALPACA_TRANSFER_COMPLETED',
      timeoutMs: 90_000,
    });
    expect(completedEvent.detail.subject.nestfolioTransferId).toBe(transferId);
  }, 120_000);
});
```

- [ ] **Step 3: Create account-check test**

Create `services/execution/broker-alpaca-adpt/test/integration/account-check.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-alpaca-adpt: account check', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '../../../../..', 'libs/integration-testing/assets/mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    await trap.deploy({
      bus: 'execution',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should create account snapshot and emit ALPACA_ACCOUNT_SNAPSHOT', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ACCOUNT_CHECK',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `AccountSnapshot#${ctx.tenantId}`,
    });
    expect(item['equity']).toBe('125000.00');
    expect(item['positions']).toHaveLength(1);

    const event = await trap.waitForEvent({ detailType: 'ALPACA_ACCOUNT_SNAPSHOT' });
    expect(event.detail.subject.equity).toBe('125000.00');
  }, 60_000);
});
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/integration/
git commit -m "$(cat <<'EOF'
test(broker-alpaca-adpt): add integration tests for order, transfer, account

3P-ADPT pattern: ephemeral mock Lambda via MockApiFixture, SSM override
for runtime switching. Tests: order placement→fill (with SF polling),
order rejection, transfer→completion (with SF), account snapshot.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Verify all integration tests pass

**Files:** None (verification only)

- [ ] **Step 1: Run all integration tests**

```bash
pnpm nx run-many -t test:integration --projects=investor-adpt,investor-ctrl,investor-bff,broker-alpaca-adpt 2>&1 | tail -40
```

Expected: All 4 services pass (7 test cases total across 6 test files):
- investor-adpt: 1 test (from-execution forwarding)
- investor-ctrl: 1 test (onboarding notification)
- investor-bff: 1 test (initiate deposit)
- broker-alpaca-adpt: 4 tests (order fill, order reject, transfer complete, account snapshot)

- [ ] **Step 2: Also verify unit tests still pass**

```bash
pnpm nx run-many -t test --projects=investor-adpt,investor-ctrl,investor-bff,broker-alpaca-adpt 2>&1 | tail -20
```

Expected: All unit tests still pass from their `test/unit/` locations.

- [ ] **Step 3: Final commit (if any fixes were needed)**

If any test adjustments were needed during verification, commit them:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: integration test adjustments from verification run

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```
