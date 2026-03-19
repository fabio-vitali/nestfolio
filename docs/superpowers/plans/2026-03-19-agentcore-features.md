# AgentCore Features Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt 4 unused AgentCore CDK features — CodeInterpreter, Browser, Gateway Interceptors, Memory enhancements — across the advisory domain services.

**Architecture:** 4 independent tracks (A–D) that can be implemented in any order. Tracks A+B add new CDK constructs in `cdk-constructs`. Track C extends the existing `AgentRuntime` construct with interceptor support. Track D modifies the Memory config in `decision-workflow-ctrl`.

**Tech Stack:** `@aws-cdk/aws-bedrock-agentcore-alpha@2.243.0-alpha.0`, `@aws-cdk/aws-bedrock-alpha` (new peer dep for Track D), CDK assertions (`Template`, `Match`), Jest, Nx

**Spec:** `docs/superpowers/specs/2026-03-19-agentcore-features-design.md`

---

## Chunk 1: Track A — CodeInterpreter Construct (Tasks 1–3)

### Task 1: Create `AgentCodeInterpreter` construct with tests

**Files:**
- Create: `libs/cdk-constructs/src/code-interpreter.ts`
- Create: `libs/cdk-constructs/test/code-interpreter.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// libs/cdk-constructs/test/code-interpreter.test.ts
import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { AgentCodeInterpreter } from '../src/code-interpreter';

describe('AgentCodeInterpreter construct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    new AgentCodeInterpreter(stack, 'TestInterpreter', {
      interpreterName: 'test_sandbox',
      description: 'Test code interpreter',
    });
    template = Template.fromStack(stack);
  });

  it('creates a BedrockAgentCore CodeInterpreterCustom resource', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::CodeInterpreterCustom', 1);
  });

  it('sets the code interpreter name', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::CodeInterpreterCustom', {
      Name: 'test_sandbox',
    });
  });

  it('sets the description', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::CodeInterpreterCustom', {
      Description: 'Test code interpreter',
    });
  });

  it('uses PUBLIC network mode by default', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::CodeInterpreterCustom', {
      NetworkMode: 'PUBLIC',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=code-interpreter`
Expected: FAIL — `AgentCodeInterpreter` not found

- [ ] **Step 3: Write the construct implementation**

```typescript
// libs/cdk-constructs/src/code-interpreter.ts
import { Construct } from 'constructs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import type * as iam from 'aws-cdk-lib/aws-iam';
import { applyStandardTags, type StandardTagsProps } from './tagging';

export interface AgentCodeInterpreterProps {
  /** Name for the CodeInterpreter. Maps to codeInterpreterCustomName. */
  readonly interpreterName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Standard tags for the construct scope */
  readonly standardTags?: StandardTagsProps;
}

/**
 * Wraps AgentCore CodeInterpreterCustom with nestfolio conventions.
 * Provides sandboxed code execution for agents (Python/JS).
 */
export class AgentCodeInterpreter extends Construct {
  readonly codeInterpreter: agentcore.CodeInterpreterCustom;

  constructor(scope: Construct, id: string, props: AgentCodeInterpreterProps) {
    super(scope, id);

    this.codeInterpreter = new agentcore.CodeInterpreterCustom(this, 'CodeInterpreter', {
      codeInterpreterCustomName: props.interpreterName,
      description: props.description,
    });

    if (props.standardTags) {
      applyStandardTags(this, props.standardTags);
    }
  }

  /** Grant invoke/start/stop permissions on this code interpreter. */
  grantUse(grantee: iam.IGrantable): iam.Grant {
    return this.codeInterpreter.grantUse(grantee);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=code-interpreter`
Expected: PASS (4 tests). **Important:** Alpha CDK L2 constructs may synthesize property names differently than expected (e.g., `CodeInterpreterCustomName` instead of `Name`). If tests fail on property name assertions, inspect the synthesized template with `template.toJSON()` to find the correct CFN property names and update the assertions accordingly.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/code-interpreter.ts libs/cdk-constructs/test/code-interpreter.test.ts
git commit -m "feat(cdk-constructs): add AgentCodeInterpreter construct with tests"
```

### Task 2: Export `AgentCodeInterpreter` from `cdk-constructs` index

**Files:**
- Modify: `libs/cdk-constructs/src/index.ts`

- [ ] **Step 1: Add export to index**

Add this line to `libs/cdk-constructs/src/index.ts`:

```typescript
export { AgentCodeInterpreter, AgentCodeInterpreterProps } from './code-interpreter';
```

- [ ] **Step 2: Run build to verify export compiles**

Run: `pnpm nx build cdk-constructs`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/src/index.ts
git commit -m "feat(cdk-constructs): export AgentCodeInterpreter from index"
```

### Task 3: Wire CodeInterpreter into service stacks

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`

- [ ] **Step 1: Add CodeInterpreter to portfolio-engine-ctrl stack**

In `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`:
1. Add `AgentCodeInterpreter` to the imports from `@nestfolio/cdk-constructs`
2. After the `AgentRuntime` instantiation, add:

```typescript
const codeInterpreter = new AgentCodeInterpreter(this, 'CodeInterpreter', {
  interpreterName: 'portfolio_engine_sandbox',
  description: 'Sandboxed Python for portfolio math and simulations',
});
codeInterpreter.grantUse(this.agentRuntime.runtime);
```

Note: `this.agentRuntime` — the `AgentRuntime` construct is currently instantiated with `new AgentRuntime(...)` but not stored. You'll need to store the reference: `const agentRuntime = new AgentRuntime(...)` and use `agentRuntime.runtime`.

- [ ] **Step 2: Add CodeInterpreter to market-intelligence-ctrl stack**

Same pattern in `services/advisory/market-intelligence-ctrl/src/service.stack.ts`:

```typescript
const codeInterpreter = new AgentCodeInterpreter(this, 'CodeInterpreter', {
  interpreterName: 'market_intelligence_sandbox',
  description: 'Sandboxed Python for data analysis and backtesting',
});
codeInterpreter.grantUse(agentRuntime.runtime);
```

- [ ] **Step 3: Run tests for both services**

Run: `pnpm nx test portfolio-engine-ctrl && pnpm nx test market-intelligence-ctrl`
Expected: PASS — existing tests should still pass. The new resources are additive.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts services/advisory/market-intelligence-ctrl/src/service.stack.ts
git commit -m "feat(advisory): wire CodeInterpreter into portfolio-engine and market-intelligence stacks"
```

---

## Chunk 2: Track B — Browser Construct (Tasks 4–6)

### Task 4: Create `AgentBrowser` construct with tests

**Files:**
- Create: `libs/cdk-constructs/src/agent-browser.ts`
- Create: `libs/cdk-constructs/test/agent-browser.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// libs/cdk-constructs/test/agent-browser.test.ts
import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { AgentBrowser } from '../src/agent-browser';

describe('AgentBrowser construct', () => {
  describe('with defaults', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });
      new AgentBrowser(stack, 'TestBrowser', {
        browserName: 'test_browser',
        description: 'Test browser',
      });
      template = Template.fromStack(stack);
    });

    it('creates a BedrockAgentCore BrowserCustom resource', () => {
      template.resourceCountIs('AWS::BedrockAgentCore::BrowserCustom', 1);
    });

    it('sets the browser name', () => {
      template.hasResourceProperties('AWS::BedrockAgentCore::BrowserCustom', {
        Name: 'test_browser',
      });
    });

    it('enables browser signing by default', () => {
      template.hasResourceProperties('AWS::BedrockAgentCore::BrowserCustom', {
        BrowserSigning: 'ENABLED',
      });
    });
  });

  describe('with recording bucket', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });
      const bucket = new Bucket(stack, 'RecordingBucket');
      new AgentBrowser(stack, 'TestBrowser', {
        browserName: 'test_browser',
        recordingBucket: bucket,
      });
      template = Template.fromStack(stack);
    });

    it('enables recording when bucket is provided', () => {
      template.hasResourceProperties('AWS::BedrockAgentCore::BrowserCustom', {
        RecordingConfig: Match.objectLike({
          Enabled: true,
        }),
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=agent-browser`
Expected: FAIL — `AgentBrowser` not found

- [ ] **Step 3: Write the construct implementation**

```typescript
// libs/cdk-constructs/src/agent-browser.ts
import { Construct } from 'constructs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import type * as iam from 'aws-cdk-lib/aws-iam';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import { applyStandardTags, type StandardTagsProps } from './tagging';

export interface AgentBrowserProps {
  /** Name for the Browser. Maps to browserCustomName. */
  readonly browserName: string;
  /** Human-readable description */
  readonly description?: string;
  /** Browser signing. Default: ENABLED (overrides CDK default of DISABLED). */
  readonly signing?: agentcore.BrowserSigning;
  /** Optional S3 bucket for session recordings. */
  readonly recordingBucket?: IBucket;
  /** Standard tags for the construct scope */
  readonly standardTags?: StandardTagsProps;
}

/**
 * Wraps AgentCore BrowserCustom with nestfolio conventions.
 * Provides managed headless browser for agents.
 */
export class AgentBrowser extends Construct {
  readonly browser: agentcore.BrowserCustom;

  constructor(scope: Construct, id: string, props: AgentBrowserProps) {
    super(scope, id);

    // Signing defaults to ENABLED — intentional override of CDK default (DISABLED)
    this.browser = new agentcore.BrowserCustom(this, 'Browser', {
      browserCustomName: props.browserName,
      description: props.description,
      browserSigning: props.signing ?? agentcore.BrowserSigning.ENABLED,
      ...(props.recordingBucket
        ? {
            recordingConfig: {
              enabled: true,
              s3Location: {
                bucketName: props.recordingBucket.bucketName,
                objectKey: 'browser-recordings/',
              },
            },
          }
        : {}),
    });

    if (props.standardTags) {
      applyStandardTags(this, props.standardTags);
    }
  }

  /** Grant use permissions (start/update/stop sessions). */
  grantUse(grantee: iam.IGrantable): iam.Grant {
    return this.browser.grantUse(grantee);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=agent-browser`
Expected: PASS (4 tests). Adjust CFN property names if they differ from the expected names.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/agent-browser.ts libs/cdk-constructs/test/agent-browser.test.ts
git commit -m "feat(cdk-constructs): add AgentBrowser construct with tests"
```

### Task 5: Export `AgentBrowser` from `cdk-constructs` index

**Files:**
- Modify: `libs/cdk-constructs/src/index.ts`

- [ ] **Step 1: Add export to index**

Add this line to `libs/cdk-constructs/src/index.ts`:

```typescript
export { AgentBrowser, AgentBrowserProps } from './agent-browser';
```

- [ ] **Step 2: Run build to verify export compiles**

Run: `pnpm nx build cdk-constructs`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/src/index.ts
git commit -m "feat(cdk-constructs): export AgentBrowser from index"
```

### Task 6: Wire Browser into market-intelligence-ctrl stack

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`

- [ ] **Step 1: Add Browser to market-intelligence-ctrl stack**

In `services/advisory/market-intelligence-ctrl/src/service.stack.ts`:
1. Add `AgentBrowser` to the imports from `@nestfolio/cdk-constructs`
2. Ensure `AgentRuntime` is stored in a variable (should already be done from Task 3): `const agentRuntime = new AgentRuntime(...)`
3. After the `AgentRuntime` instantiation, add:

```typescript
const browser = new AgentBrowser(this, 'Browser', {
  browserName: 'market_intelligence_browser',
  description: 'Headless browser for regulatory filings and market research',
  signing: BrowserSigning.ENABLED,
});
browser.grantUse(agentRuntime.runtime);
```

Import `BrowserSigning` from `@aws-cdk/aws-bedrock-agentcore-alpha`.

- [ ] **Step 2: Run tests**

Run: `pnpm nx test market-intelligence-ctrl`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/service.stack.ts
git commit -m "feat(market-intelligence): wire AgentBrowser into stack"
```

---

## Chunk 3: Track C — Gateway Interceptors (Tasks 7–10)

### Task 7: Create request-guard interceptor Lambda handler

**Files:**
- Create: `libs/cdk-constructs/src/interceptors/request-guard.ts`
- Create: `libs/cdk-constructs/test/interceptors/request-guard.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// libs/cdk-constructs/test/interceptors/request-guard.test.ts
import { handler, extractTenantId, validatePayload, checkRateLimit } from '../../src/interceptors/request-guard';

// Mock DynamoDB client
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  UpdateItemCommand: jest.fn((params: unknown) => ({ input: params })),
}));

describe('request-guard interceptor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RATE_LIMIT_TABLE = 'rate-table';
    process.env.MAX_INVOCATIONS_PER_MINUTE = '100';
  });

  describe('extractTenantId', () => {
    it('extracts tenantId from request headers', () => {
      const headers = { 'x-tenant-id': 'tenant-123' };
      expect(extractTenantId(headers)).toBe('tenant-123');
    });

    it('returns null when no tenant header present', () => {
      expect(extractTenantId({})).toBeNull();
    });
  });

  describe('validatePayload', () => {
    it('accepts valid payload', () => {
      const result = validatePayload({ toolName: 'lookup', input: { query: 'test' } });
      expect(result.valid).toBe(true);
    });

    it('rejects oversized payload (>256KB)', () => {
      const result = validatePayload({ toolName: 'lookup', input: { data: 'x'.repeat(300_000) } });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('size');
    });
  });

  describe('checkRateLimit', () => {
    it('allows requests under limit', async () => {
      mockSend.mockResolvedValue({ Attributes: { count: { N: '5' } } });
      const result = await checkRateLimit('tenant-123');
      expect(result.allowed).toBe(true);
    });

    it('rejects requests over limit', async () => {
      mockSend.mockResolvedValue({ Attributes: { count: { N: '101' } } });
      const result = await checkRateLimit('tenant-123');
      expect(result.allowed).toBe(false);
    });
  });

  describe('handler', () => {
    it('rejects requests without tenant context', async () => {
      const event = { headers: {}, body: JSON.stringify({ toolName: 'test', input: {} }) };
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('passes valid requests with tenant injection', async () => {
      mockSend.mockResolvedValue({ Attributes: { count: { N: '1' } } });
      const event = {
        headers: { 'x-tenant-id': 'tenant-123' },
        body: JSON.stringify({ toolName: 'test', input: {} }),
      };
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.input.tenantId).toBe('tenant-123');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=request-guard`
Expected: FAIL — module not found

- [ ] **Step 3: Write the request-guard Lambda handler**

```typescript
// libs/cdk-constructs/src/interceptors/request-guard.ts
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient({});

export function extractTenantId(headers: Record<string, string>): string | null {
  return headers['x-tenant-id'] ?? headers['X-Tenant-Id'] ?? null;
}

export function validatePayload(payload: { toolName?: string; input?: unknown }): { valid: boolean; reason?: string } {
  if (!payload.toolName) return { valid: false, reason: 'Missing toolName' };
  const size = JSON.stringify(payload).length;
  if (size > 256_000) return { valid: false, reason: `Payload size ${size} exceeds 256KB limit` };
  return { valid: true };
}

export async function checkRateLimit(tenantId: string): Promise<{ allowed: boolean; count: number }> {
  const table = process.env.RATE_LIMIT_TABLE!;
  const max = parseInt(process.env.MAX_INVOCATIONS_PER_MINUTE ?? '100', 10);
  const minuteKey = `${tenantId}#${Math.floor(Date.now() / 60_000)}`;

  const result = await ddb.send(new UpdateItemCommand({
    TableName: table,
    Key: { pk: { S: minuteKey } },
    UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
    ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':one': { N: '1' },
      ':ttl': { N: String(Math.floor(Date.now() / 1000) + 120) },
    },
    ReturnValues: 'ALL_NEW',
  }));

  const count = parseInt(result.Attributes?.count?.N ?? '0', 10);
  return { allowed: count <= max, count };
}

export async function handler(event: { headers: Record<string, string>; body: string }) {
  // 1. Tenant scope
  const tenantId = extractTenantId(event.headers);
  if (!tenantId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing tenant context' }) };
  }

  // 2. Input validation
  const payload = JSON.parse(event.body);
  const validation = validatePayload(payload);
  if (!validation.valid) {
    return { statusCode: 400, body: JSON.stringify({ error: validation.reason }) };
  }

  // 3. Rate limiting (skip if no table configured)
  if (process.env.RATE_LIMIT_TABLE) {
    const rateCheck = await checkRateLimit(tenantId);
    if (!rateCheck.allowed) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Rate limit exceeded', count: rateCheck.count }) };
    }
  }

  // Inject tenantId and pass through
  payload.input = { ...payload.input, tenantId };
  return { statusCode: 200, body: JSON.stringify(payload) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=request-guard`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/interceptors/request-guard.ts libs/cdk-constructs/test/interceptors/request-guard.test.ts
git commit -m "feat(cdk-constructs): add request-guard interceptor Lambda handler"
```

### Task 8: Create audit-trail interceptor Lambda handler

**Files:**
- Create: `libs/cdk-constructs/src/interceptors/audit-trail.ts`
- Create: `libs/cdk-constructs/test/interceptors/audit-trail.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// libs/cdk-constructs/test/interceptors/audit-trail.test.ts
import { handler } from '../../src/interceptors/audit-trail';

describe('audit-trail interceptor', () => {
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

  afterEach(() => consoleSpy.mockClear());

  it('logs structured JSON with tool name and tenant', async () => {
    const event = {
      headers: { 'x-tenant-id': 'tenant-123' },
      requestBody: JSON.stringify({ toolName: 'portfolio-lookup', input: { query: 'AAPL' } }),
      responseBody: JSON.stringify({ output: { price: 150 } }),
      statusCode: 200,
    };
    await handler(event);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.toolName).toBe('portfolio-lookup');
    expect(logged.tenantId).toBe('tenant-123');
    expect(logged.statusCode).toBe(200);
    expect(logged.timestamp).toBeDefined();
  });

  it('handles missing headers gracefully', async () => {
    const event = {
      headers: {},
      requestBody: JSON.stringify({ toolName: 'test' }),
      responseBody: JSON.stringify({}),
      statusCode: 200,
    };
    await handler(event);
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.tenantId).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=audit-trail`
Expected: FAIL — module not found

- [ ] **Step 3: Write the audit-trail Lambda handler**

```typescript
// libs/cdk-constructs/src/interceptors/audit-trail.ts
export async function handler(event: {
  headers: Record<string, string>;
  requestBody: string;
  responseBody: string;
  statusCode: number;
}) {
  const tenantId = event.headers['x-tenant-id'] ?? event.headers['X-Tenant-Id'] ?? 'unknown';
  const request = JSON.parse(event.requestBody || '{}');
  const response = JSON.parse(event.responseBody || '{}');

  const logEntry = {
    timestamp: new Date().toISOString(),
    tenantId,
    toolName: request.toolName ?? 'unknown',
    statusCode: event.statusCode,
    inputSummary: JSON.stringify(request.input ?? {}).slice(0, 500),
    outputSummary: JSON.stringify(response.output ?? response).slice(0, 500),
  };

  // Structured log — CloudWatch Logs Insights can query JSON fields
  console.log(JSON.stringify(logEntry));

  // Pass through — RESPONSE interceptor must return the original response
  return { statusCode: event.statusCode, body: event.responseBody };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=audit-trail`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/interceptors/audit-trail.ts libs/cdk-constructs/test/interceptors/audit-trail.test.ts
git commit -m "feat(cdk-constructs): add audit-trail interceptor Lambda handler"
```

### Task 9: Extend `AgentRuntime` construct with interceptor support

**Files:**
- Modify: `libs/cdk-constructs/src/agent-runtime.ts`
- Create: `libs/cdk-constructs/test/agent-runtime-interceptors.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// libs/cdk-constructs/test/agent-runtime-interceptors.test.ts
import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { AgentRuntime } from '../src/agent-runtime';

describe('AgentRuntime with interceptors', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const rateLimitTable = new Table(stack, 'RateLimitTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
    });
    new AgentRuntime(stack, 'TestRuntime', {
      runtimeName: 'test_runtime',
      agentCodePath: __dirname,
      interceptors: {
        requestGuard: {
          tenantScope: true,
          inputValidation: true,
          rateLimiting: {
            maxInvocationsPerMinute: 50,
            table: rateLimitTable,
          },
        },
        auditTrail: true,
      },
    });
    template = Template.fromStack(stack);
  });

  it('creates a Gateway when interceptors are configured (even without toolTargets)', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::Gateway', 1);
  });

  it('creates Lambda functions for interceptors', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const lambdaNames = Object.keys(lambdas);
    // At least 2 interceptor Lambdas (request-guard + audit-trail)
    expect(lambdaNames.length).toBeGreaterThanOrEqual(2);
  });

  it('sets RATE_LIMIT_TABLE env var on request-guard Lambda', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          RATE_LIMIT_TABLE: Match.anyValue(),
          MAX_INVOCATIONS_PER_MINUTE: '50',
        }),
      },
    });
  });
});

describe('AgentRuntime without interceptors', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    new AgentRuntime(stack, 'TestRuntime', {
      runtimeName: 'test_runtime',
      agentCodePath: __dirname,
    });
    template = Template.fromStack(stack);
  });

  it('does not create interceptor Lambda functions when not configured', () => {
    // Only the Runtime — no Gateway or interceptor Lambdas
    template.resourceCountIs('AWS::BedrockAgentCore::Gateway', 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=agent-runtime-interceptors`
Expected: FAIL — `InterceptorConfig` not recognized / interceptors not handled

- [ ] **Step 3: Extend `AgentRuntime` construct**

Modify `libs/cdk-constructs/src/agent-runtime.ts`:

1. Add the `InterceptorConfig` interface to the file:

```typescript
import { join } from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export interface InterceptorConfig {
  requestGuard?: {
    tenantScope: boolean;
    inputValidation: boolean;
    rateLimiting?: {
      maxInvocationsPerMinute: number;
      table: ITable;
    };
  };
  auditTrail?: boolean;
}
```

2. Add `interceptors?: InterceptorConfig` to `AgentRuntimeProps`.

3. In the constructor, after the existing Gateway block, add interceptor wiring:

```typescript
// Create Gateway for interceptors even if no toolTargets
const needsGateway = (props.toolTargets && props.toolTargets.length > 0) || props.interceptors;

if (needsGateway && !this.gateway) {
  this.gateway = new agentcore.Gateway(this, 'Gateway', {
    gatewayName: `${props.runtimeName}-tools`,
    protocolConfiguration: new agentcore.McpProtocolConfiguration({
      instructions: `Tools for ${props.runtimeName}`,
      searchType: agentcore.McpGatewaySearchType.SEMANTIC,
    }),
    authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
  });
  this.gateway.grantInvoke(this.runtime);
}

// Add interceptors
if (props.interceptors?.requestGuard && this.gateway) {
  const requestGuardFn = new NodejsFunction(this, 'RequestGuard', {
    runtime: Runtime.NODEJS_20_X,
    entry: join(__dirname, 'interceptors', 'request-guard.ts'),
    handler: 'handler',
    environment: {
      ...(props.interceptors.requestGuard.rateLimiting
        ? {
            RATE_LIMIT_TABLE: props.interceptors.requestGuard.rateLimiting.table.tableName,
            MAX_INVOCATIONS_PER_MINUTE: String(props.interceptors.requestGuard.rateLimiting.maxInvocationsPerMinute),
          }
        : {}),
    },
  });
  if (props.interceptors.requestGuard.rateLimiting) {
    props.interceptors.requestGuard.rateLimiting.table.grantReadWriteData(requestGuardFn);
  }
  this.gateway.addInterceptor(
    agentcore.LambdaInterceptor.forRequest(requestGuardFn, { passRequestHeaders: true }),
  );
}

if (props.interceptors?.auditTrail && this.gateway) {
  const auditTrailFn = new NodejsFunction(this, 'AuditTrail', {
    runtime: Runtime.NODEJS_20_X,
    entry: join(__dirname, 'interceptors', 'audit-trail.ts'),
    handler: 'handler',
  });
  this.gateway.addInterceptor(
    agentcore.LambdaInterceptor.forResponse(auditTrailFn),
  );
}
```

Note: The existing Gateway creation logic needs refactoring — currently it only creates a Gateway when `toolTargets` is non-empty. This change ensures a Gateway is also created when interceptors are configured. Reorganize the conditional so toolTargets and interceptors both feed into the same Gateway instance.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs -- --testPathPattern=agent-runtime-interceptors`
Expected: PASS (4 tests)

- [ ] **Step 5: Run all cdk-constructs tests**

Run: `pnpm nx test cdk-constructs`
Expected: ALL PASS — no regressions

- [ ] **Step 6: Commit**

```bash
git add libs/cdk-constructs/src/agent-runtime.ts libs/cdk-constructs/test/agent-runtime-interceptors.test.ts
git commit -m "feat(cdk-constructs): add interceptor support to AgentRuntime construct"
```

### Task 10: Wire interceptors into all 5 agent service stacks

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts`

- [ ] **Step 1: Create a shared rate-limit DynamoDB table**

Each service stack creates its own `AgentRuntime`. For rate limiting, each needs access to a DDB table. Two options:
- **Option A:** Each stack creates its own rate-limit table (simpler, isolated)
- **Option B:** Shared table via SSM parameter from advisory-hub (more consistent)

Use **Option A** for simplicity — each stack adds a small DDB table:

```typescript
const rateLimitTable = new Table(this, 'RateLimitTable', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  timeToLiveAttribute: 'ttl',
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
});
```

- [ ] **Step 2: Add interceptor config to each stack's `AgentRuntime`**

In each of the 5 service stacks, add to the `AgentRuntime` instantiation:

```typescript
interceptors: {
  requestGuard: {
    tenantScope: true,
    inputValidation: true,
    rateLimiting: {
      maxInvocationsPerMinute: 100,
      table: rateLimitTable,
    },
  },
  auditTrail: true,
},
```

Add the required imports: `Table`, `AttributeType`, `BillingMode`, `RemovalPolicy`.

- [ ] **Step 3: Run tests for all 5 services**

Run: `pnpm nx run-many -t test -p advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-ctrl`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add services/advisory/*/src/service.stack.ts
git commit -m "feat(advisory): wire gateway interceptors into all 5 agent service stacks"
```

---

## Chunk 4: Track D — Memory Enhancements (Tasks 11–12)

### Task 11: Install `@aws-cdk/aws-bedrock-alpha` peer dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

`@aws-cdk/aws-bedrock-alpha` is a peer dependency of `@aws-cdk/aws-bedrock-agentcore-alpha` and is required for `IBedrockInvokable` / `BedrockFoundationModel`. It's not currently installed.

First verify the installed agentcore version to ensure version alignment:
Run: `node -e "console.log(require('@aws-cdk/aws-bedrock-agentcore-alpha/package.json').version)"`

Then install the matching version:
Run: `pnpm add -D @aws-cdk/aws-bedrock-alpha@2.243.0-alpha.0`

Expected: Package installed, `package.json` updated. Version MUST match the installed `@aws-cdk/aws-bedrock-agentcore-alpha` version to avoid build failures.

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require('@aws-cdk/aws-bedrock-alpha')"`
Expected: No error

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install @aws-cdk/aws-bedrock-alpha peer dependency for Memory OverrideConfig"
```

### Task 12: Add KMS encryption and custom prompts to Memory

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts`

- [ ] **Step 1: Write new tests for Memory enhancements**

Add to `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts`:

```typescript
it('creates a KMS key with rotation enabled for Memory encryption', () => {
  template.hasResourceProperties('AWS::KMS::Key', {
    EnableKeyRotation: true,
    Description: Match.stringLikeRegexp('AgentCore Memory'),
  });
});

it('associates KMS key with AgentCore Memory', () => {
  template.hasResourceProperties('AWS::BedrockAgentCore::Memory', {
    EncryptionKeyArn: Match.anyValue(),
  });
});
```

Add tests for custom extraction/consolidation prompts:

```typescript
it('sets custom extraction on InvestorPreferenceLearner strategy', () => {
  template.hasResourceProperties('AWS::BedrockAgentCore::Memory', {
    Strategies: Match.arrayWith([
      Match.objectLike({
        StrategyName: 'InvestorPreferenceLearner',
        Configuration: Match.objectLike({
          ExtractionConfiguration: Match.objectLike({
            CustomExtractionConfiguration: Match.anyValue(),
          }),
        }),
      }),
    ]),
  });
});

it('does not set custom extraction on MarketSignalExtractor strategy', () => {
  // MarketSignalExtractor and NarrativeSessionSummarizer should NOT have custom overrides
  const memory = template.findResources('AWS::BedrockAgentCore::Memory');
  const strategies = Object.values(memory)[0]?.Properties?.Strategies ?? [];
  const marketSignal = strategies.find((s: any) => s.StrategyName === 'MarketSignalExtractor');
  expect(marketSignal?.Configuration?.ExtractionConfiguration?.CustomExtractionConfiguration).toBeUndefined();
});
```

Note: The exact CFN property names for strategy overrides may differ from expected. If tests fail, inspect `template.toJSON()` to find the correct property structure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test decision-workflow-ctrl -- --testPathPattern=service.stack`
Expected: FAIL — no KMS key exists, no custom extraction configured

- [ ] **Step 3: Add KMS key to decision-workflow-ctrl stack**

In `services/advisory/decision-workflow-ctrl/src/service.stack.ts`:

1. Add imports:

```typescript
import * as kms from 'aws-cdk-lib/aws-kms';
```

2. Before the `agentcore.Memory` instantiation, add:

```typescript
const memoryKey = new kms.Key(this, 'AgentMemoryKey', {
  alias: `${props.prefix}/agent-memory`,
  description: 'Encryption key for AgentCore Memory (investor financial data)',
  enableKeyRotation: true,
});
```

3. Add `kmsKey: memoryKey` to the `agentcore.Memory` props.

- [ ] **Step 4: Run tests to verify KMS tests pass**

Run: `pnpm nx test decision-workflow-ctrl -- --testPathPattern=service.stack`
Expected: PASS (including the 2 new KMS tests)

- [ ] **Step 5: Add custom extraction/consolidation prompts**

In `services/advisory/decision-workflow-ctrl/src/service.stack.ts`:

1. Add import for BedrockFoundationModel:

```typescript
import { BedrockFoundationModel } from '@aws-cdk/aws-bedrock-alpha';
```

2. Resolve the Sonnet model using `fromFoundationModelId()` with the SSM-resolved model ID (consistent with how all advisory stacks resolve model IDs):

```typescript
const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));
const sonnetModel = BedrockFoundationModel.fromFoundationModelId(this, 'SonnetModel', modelSonnetId);
```

Note: Verify `fromFoundationModelId` exists on the installed `@aws-cdk/aws-bedrock-alpha` package. If it doesn't, use the static constant approach: inspect `node_modules/@aws-cdk/aws-bedrock-alpha/lib/models.d.ts` for the correct field name (e.g., `ANTHROPIC_CLAUDE_3_5_SONNET_V2_0`).

3. Update the 3 strategies with custom prompts:

```typescript
agentcore.MemoryStrategy.usingUserPreference({
  name: 'InvestorPreferenceLearner',
  namespaces: ['/investor-profile/{actorId}/preferences'],
  customExtraction: {
    model: sonnetModel,
    appendToPrompt: 'Extract investment preferences: risk tolerance level, asset class preferences, ESG constraints, liquidity needs, time horizon, and any stated return targets. Ignore conversational filler.',
  },
  customConsolidation: {
    model: sonnetModel,
    appendToPrompt: 'When consolidating investor preferences, newer statements override older ones for the same dimension. Flag contradictions (e.g., high growth vs conservative).',
  },
}),
```

Apply the same pattern to `AllocationRationaleExtractor` and `NarrativePreferenceLearner` with the prompts from the spec.

- [ ] **Step 6: Run all decision-workflow-ctrl tests**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/service.stack.test.ts
git commit -m "feat(decision-workflow): add KMS encryption and custom prompts to AgentCore Memory"
```

---

## Chunk 5: Verification (Task 13)

### Task 13: Full workspace verification

- [ ] **Step 1: Run all cdk-constructs tests**

Run: `pnpm nx test cdk-constructs`
Expected: ALL PASS

- [ ] **Step 2: Run all advisory service tests**

Run: `pnpm nx run-many -t test -p advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-ctrl,decision-workflow-ctrl`
Expected: ALL PASS

- [ ] **Step 3: Run full workspace test**

Run: `pnpm nx run-many -t test --all`
Expected: ALL PASS — no regressions across all 30+ projects

- [ ] **Step 4: Run lint**

Run: `pnpm nx run-many -t lint -p cdk-constructs,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-ctrl,decision-workflow-ctrl`
Expected: ALL PASS

- [ ] **Step 5: Verify build**

Run: `pnpm nx build cdk-constructs`
Expected: BUILD SUCCESS — all exports resolve correctly
