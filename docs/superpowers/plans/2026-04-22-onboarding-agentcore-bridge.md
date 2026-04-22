# Onboarding browser ↔ AgentCore bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a Cognito-authenticated, SSE-streaming HTTP path from the browser to the onboarding AgentCore runtime by extending existing infrastructure (no bridge Lambda).

**Architecture:** (1) Enable AgentCore's native Cognito JWT authorizer on the onboarding runtime. (2) Add a `/api/copilotkit*` behavior to the existing `investor-web` CloudFront distribution that reverse-proxies to `bedrock-agentcore.us-east-1.amazonaws.com`, using a CloudFront Function for URI rewrite and a ResponseHeadersPolicy for CORS. (3) Wire the browser to post to the CF distribution URL with a fresh Cognito `idToken` and a `${tenantId}/${sessionId}` session-id header.

**Tech Stack:** AWS CDK v2, aws-cdk-lib/aws-cloudfront (Function, Distribution, ResponseHeadersPolicy, OriginRequestPolicy), aws-cdk-lib/aws-cognito, aws-cdk-lib/aws-ssm, Angular 18, `@ag-ui/client` HttpAgent, AWS Amplify `fetchAuthSession`, Jest + CDK assertions.

**Spec reference:** `docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md`.

**Cross-stack SSM paths (authoritative):**
- User Pool ID: `/nestfolio/${prefix}-investor/auth/userPoolId` (subsystem scope — verified at `services/investor/investor-web/src/service.stack.ts:128`, consumed at `services/ledger/ledger-bff/src/service.stack.ts:51`).
- User Pool Client ID: `/nestfolio/${prefix}-investor/auth/userPoolClientId`.
- Distribution URL: `/nestfolio/${prefix}-investor/web/distributionUrl`.
- Onboarding runtime ARN: `/nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl` (service scope — `services/investor/onboarding-bff/src/service.stack.ts:78`).

**App composition:** Per-service CDK apps (`services/investor/investor-web/src/main.ts`, `services/investor/onboarding-bff/src/main.ts`). **No `stack.addDependency(...)`** is possible across app boundaries — rely on deploy-order discipline (onboarding-bff first).

---

## Task 1: Enable Cognito authorizer on the onboarding AgentCore runtime

**Files:**
- Modify: `services/investor/onboarding-bff/src/service.stack.ts`
- Modify: `services/investor/onboarding-bff/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write the failing stack test**

Append this test inside the existing `describe('OnboardingBffStack', ...)` block in `services/investor/onboarding-bff/test/unit/service.stack.test.ts`:

```ts
  it('configures the AgentCore Runtime with a Cognito authorizer from the investor subsystem', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AuthorizerConfiguration: {
        CustomJWTAuthorizer: Match.objectLike({
          DiscoveryUrl: Match.stringLikeRegexp('.*cognito-idp.*/\\.well-known/openid-configuration'),
          AllowedClients: Match.anyValue(),
        }),
      },
    });
  });
```

- [ ] **Step 2: Run the test — expect it to fail**

Run:

```bash
pnpm nx run onboarding-bff:test --testPathPattern=service.stack
```

Expected: the new test fails with `Template has X resources with type AWS::BedrockAgentCore::Runtime, but none match` because `AuthorizerConfiguration` is absent. Pre-existing tests pass.

- [ ] **Step 3: Import Cognito and read the subsystem-scoped SSM parameters**

At the top of `services/investor/onboarding-bff/src/service.stack.ts`, add:

```ts
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
```

Inside the `constructor`, **before** the `const agentRuntime = new AgentRuntime(...)` call (currently at line 52), insert:

```ts
    // Import the investor User Pool + Web Client published by investor-web.
    // Paths match services/investor/investor-web/src/service.stack.ts:127-134
    // (subsystem-scoped via NamingService.ssmParameterPath).
    const userPoolId = StringParameter.valueForStringParameter(
      this, `/nestfolio/${props.prefix}-investor/auth/userPoolId`,
    );
    const userPoolClientId = StringParameter.valueForStringParameter(
      this, `/nestfolio/${props.prefix}-investor/auth/userPoolClientId`,
    );
    const investorUserPool = UserPool.fromUserPoolId(this, 'InvestorUserPool', userPoolId);
    const investorUserPoolClient = UserPoolClient.fromUserPoolClientId(
      this, 'InvestorUserPoolClient', userPoolClientId,
    );
```

- [ ] **Step 4: Pass the User Pool + Client into `AgentRuntime`**

In the same file, replace the `AgentRuntime` props object (`services/investor/onboarding-bff/src/service.stack.ts:52-70`) so the existing props are preserved and two new props are added. The resulting call must look like this (keep all existing props — only the two `userPool*` props are new):

```ts
    const agentRuntime = new AgentRuntime(this, 'OnboardingAgent', {
      runtimeName: 'onboarding_agent',
      agentCodePath: path.join(__dirname, '..', 'agents', 'onboarding'),
      description: 'Conversational onboarding agent for investor onboarding',
      modelIds: [sonnetModelId],
      state,
      userPool: investorUserPool,
      userPoolClients: [investorUserPoolClient],
      toolTargets: [{
        name: 'search_knowledge_base',
        description: 'Search Nestfolio documentation to answer user questions',
        handler: searchKbFn,
        schemaPath: path.join(__dirname, 'agent/tools/search-kb.schema.json'),
      }],
      environmentVariables: {
        TABLE_NAME: state.getTable().tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
    });
```

The `AgentRuntime` construct at `libs/cdk-constructs/src/extensions/agent-runtime.ts:60-67` already attaches `RuntimeAuthorizerConfiguration.usingCognito(...)` when both props are present.

- [ ] **Step 5: Run the test — expect it to pass**

Run:

```bash
pnpm nx run onboarding-bff:test --testPathPattern=service.stack
```

Expected: all tests green, including the new authorizer assertion.

- [ ] **Step 6: Commit**

```bash
git add services/investor/onboarding-bff/src/service.stack.ts \
        services/investor/onboarding-bff/test/unit/service.stack.test.ts
git commit -m "feat(onboarding-bff): enable Cognito authorizer on AgentCore runtime"
```

---

## Task 2: CloudFront Function source + pure-function unit test

**Files:**
- Create: `services/investor/investor-web/src/cf-functions/copilot-rewrite.js`
- Create: `services/investor/investor-web/test/unit/cf-functions/copilot-rewrite.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `services/investor/investor-web/test/unit/cf-functions/copilot-rewrite.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

// The CF Function source is a template: `__RUNTIME_ARN__` is substituted at
// deploy time via `Fn.sub`. In tests, substitute a fake ARN and evaluate the
// handler in a sandboxed Function.
function loadHandler(runtimeArn: string): (event: unknown) => unknown {
  const template = readFileSync(
    join(__dirname, '..', '..', '..', 'src', 'cf-functions', 'copilot-rewrite.js'),
    'utf-8',
  );
  const substituted = template.replace(/__RUNTIME_ARN__/g, runtimeArn);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`${substituted}\nreturn handler;`)() as (event: unknown) => unknown;
}

describe('copilot-rewrite CF function', () => {
  const ARN = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/onboarding_agent-abc';
  const handler = loadHandler(ARN);

  function runEvent(uri: string, querystring: Record<string, { value: string }> = {}) {
    const event = { request: { uri, querystring, headers: {}, method: 'POST' } };
    const out = handler(event) as { uri: string; querystring: Record<string, { value: string }> };
    return out;
  }

  it('rewrites /api/copilotkit to /runtimes/<encoded-arn>/invocations', () => {
    const out = runEvent('/api/copilotkit');
    expect(out.uri).toBe(`/runtimes/${encodeURIComponent(ARN)}/invocations`);
  });

  it('rewrites /api/copilotkit/ (trailing slash) the same way', () => {
    const out = runEvent('/api/copilotkit/');
    expect(out.uri).toBe(`/runtimes/${encodeURIComponent(ARN)}/invocations`);
  });

  it('sets qualifier=DEFAULT on the querystring regardless of input', () => {
    const out = runEvent('/api/copilotkit', { x: { value: 'y' } });
    expect(out.querystring).toEqual({ qualifier: { value: 'DEFAULT' } });
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail**

Run:

```bash
pnpm nx run investor-web:test --testPathPattern=copilot-rewrite
```

Expected: fails because `src/cf-functions/copilot-rewrite.js` does not exist (`ENOENT`).

- [ ] **Step 3: Create the CF Function source**

Create `services/investor/investor-web/src/cf-functions/copilot-rewrite.js`:

```js
// CloudFront Function (viewer-request). Rewrites any request under
// /api/copilotkit* to the AgentCore runtime invocation path. The literal
// string `__RUNTIME_ARN__` is substituted at deploy time via `Fn.sub` in
// services/investor/investor-web/src/service.stack.ts.
function handler(event) {
  var req = event.request;
  req.uri = '/runtimes/' + encodeURIComponent('__RUNTIME_ARN__') + '/invocations';
  req.querystring = { qualifier: { value: 'DEFAULT' } };
  return req;
}
```

- [ ] **Step 4: Run the test — expect it to pass**

Run:

```bash
pnpm nx run investor-web:test --testPathPattern=copilot-rewrite
```

Expected: all three cases pass.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-web/src/cf-functions/copilot-rewrite.js \
        services/investor/investor-web/test/unit/cf-functions/copilot-rewrite.test.ts
git commit -m "feat(investor-web): CF Function rewriting /api/copilotkit to AgentCore invocations"
```

---

## Task 3: Wire the CloudFront behavior, policies, and function association

**Files:**
- Modify: `services/investor/investor-web/src/service.stack.ts`
- Create: `services/investor/investor-web/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write the failing stack tests**

Create `services/investor/investor-web/test/unit/service.stack.test.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InvestorWebStack } from '../../src/service.stack';

describe('InvestorWebStack — CopilotKit bridge', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStack', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('creates a CloudFront Function with the copilot-rewrite source baked in', () => {
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-1.0' }),
      FunctionCode: Match.stringLikeRegexp("req.uri = '/runtimes/' \\+ encodeURIComponent"),
    });
  });

  it('creates an origin request policy forwarding Authorization + session-id headers only', () => {
    template.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        HeadersConfig: {
          HeaderBehavior: 'whitelist',
          Headers: Match.arrayWith([
            'Authorization',
            'Content-Type',
            'x-amzn-bedrock-agentcore-runtime-session-id',
          ]),
        },
        CookiesConfig: { CookieBehavior: 'none' },
        QueryStringsConfig: { QueryStringBehavior: 'none' },
      }),
    });
  });

  it('creates a response headers policy with CORS allowing localhost:4200 and the distribution domain', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: Match.objectLike({
          AccessControlAllowCredentials: false,
          AccessControlAllowHeaders: {
            Items: Match.arrayWith([
              'Authorization',
              'Content-Type',
              'x-amzn-bedrock-agentcore-runtime-session-id',
            ]),
          },
          AccessControlAllowMethods: { Items: Match.arrayWith(['POST', 'OPTIONS']) },
          AccessControlAllowOrigins: {
            Items: Match.arrayWith(['http://localhost:4200']),
          },
          OriginOverride: true,
        }),
      }),
    });
  });

  it('attaches a /api/copilotkit* cache behavior on the existing distribution', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: '/api/copilotkit*',
            TargetOriginId: Match.anyValue(),
            ViewerProtocolPolicy: 'https-only',
            AllowedMethods: Match.arrayWith(['POST', 'OPTIONS']),
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({ EventType: 'viewer-request' }),
            ]),
          }),
        ]),
        Origins: Match.arrayWith([
          Match.objectLike({ DomainName: 'bedrock-agentcore.us-east-1.amazonaws.com' }),
        ]),
      }),
    });
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail**

Run:

```bash
pnpm nx run investor-web:test --testPathPattern=service.stack
```

Expected: all four new assertions fail (resources absent). The existing handler tests remain green.

- [ ] **Step 3: Extend imports in the stack**

At the top of `services/investor/investor-web/src/service.stack.ts`, **replace** the existing CloudFront import (currently lines 5-8) with the expanded form:

```ts
import {
  Distribution, ViewerProtocolPolicy, OriginAccessIdentity,
  ResponseHeadersPolicy, HeadersFrameOption, HeadersReferrerPolicy,
  Function as CfFunction, FunctionCode, FunctionEventType,
  OriginRequestPolicy, OriginRequestHeaderBehavior, OriginRequestCookieBehavior,
  OriginRequestQueryStringBehavior, AllowedMethods, CachePolicy,
  ResponseHeadersCorsBehavior,
} from 'aws-cdk-lib/aws-cloudfront';
```

Also **add** the HTTP origin and `Fn` imports (new lines, immediately after the existing `S3Origin` import on line 9):

```ts
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Fn } from 'aws-cdk-lib';
import { readFileSync } from 'fs';
import { join as joinPath } from 'path';
```

(`joinPath` is aliased because `join` is already imported from `'path'` on line 15.)

- [ ] **Step 4: Read the runtime ARN + CF Function template and create the CF Function**

Inside the constructor, **after** the existing `const distribution = new Distribution(...)` block (ends at `services/investor/investor-web/src/service.stack.ts:124`) and **before** the `new StringParameter(... 'UserPoolIdParam' ...)` block, insert:

```ts
    // ─── CopilotKit bridge: /api/copilotkit* → AgentCore runtime ───────────────
    // Deploy-order contract: `onboarding-bff` must be deployed first so this
    // SSM parameter exists. This is a per-service CDK app composition
    // (services/investor/investor-web/src/main.ts has no reference to the
    // onboarding-bff stack), so `stack.addDependency(...)` is not available.
    const onboardingRuntimeArn = StringParameter.valueForStringParameter(
      this, `/nestfolio/${this.prefix}-onboarding-bff/agent/runtimeUrl`,
    );

    // CF Function source has `__RUNTIME_ARN__` placeholder; substitute via Fn.sub.
    const cfFunctionTemplate = readFileSync(
      joinPath(__dirname, 'cf-functions', 'copilot-rewrite.js'), 'utf-8',
    );
    const cfFunctionCode = Fn.sub(cfFunctionTemplate.replace(/__RUNTIME_ARN__/g, '${arn}'), {
      arn: onboardingRuntimeArn,
    });

    const copilotRewriteFn = new CfFunction(this, 'CopilotRewriteFn', {
      functionName: `${this.prefix}-investor-web-copilot-rewrite`,
      code: FunctionCode.fromInline(cfFunctionCode),
      comment: 'Rewrites /api/copilotkit* → /runtimes/<arn>/invocations?qualifier=DEFAULT',
    });
```

- [ ] **Step 5: Create the origin-request + response-headers policies**

Immediately after the `CopilotRewriteFn` creation block, insert:

```ts
    const copilotOriginRequestPolicy = new OriginRequestPolicy(this, 'CopilotOriginRequestPolicy', {
      originRequestPolicyName: `${this.prefix}-investor-web-copilot-origin-req`,
      headerBehavior: OriginRequestHeaderBehavior.allowList(
        'Authorization', 'Content-Type', 'x-amzn-bedrock-agentcore-runtime-session-id',
      ),
      cookieBehavior: OriginRequestCookieBehavior.none(),
      queryStringBehavior: OriginRequestQueryStringBehavior.none(),
    });

    // Allowed origins: the distribution's own domain (prod same-origin) plus
    // localhost:4200 for dev + Playwright e2e.
    const copilotResponseHeadersPolicy = new ResponseHeadersPolicy(this, 'CopilotResponseHeadersPolicy', {
      responseHeadersPolicyName: `${this.prefix}-investor-web-copilot-cors`,
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: [
          'Authorization', 'Content-Type', 'x-amzn-bedrock-agentcore-runtime-session-id',
        ],
        accessControlAllowMethods: ['POST', 'OPTIONS'],
        accessControlAllowOrigins: [
          `https://${distribution.distributionDomainName}`,
          'http://localhost:4200',
        ],
        accessControlExposeHeaders: ['Content-Type'],
        originOverride: true,
      } satisfies ResponseHeadersCorsBehavior,
    });
```

- [ ] **Step 6: Attach the `/api/copilotkit*` behavior to the existing distribution**

Immediately after the response-headers policy block, insert:

```ts
    distribution.addBehavior('/api/copilotkit*', new HttpOrigin('bedrock-agentcore.us-east-1.amazonaws.com'), {
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: copilotOriginRequestPolicy,
      responseHeadersPolicy: copilotResponseHeadersPolicy,
      functionAssociations: [{ function: copilotRewriteFn, eventType: FunctionEventType.VIEWER_REQUEST }],
    });
```

- [ ] **Step 7: Run the stack tests — expect them to pass**

Run:

```bash
pnpm nx run investor-web:test --testPathPattern=service.stack
```

Expected: all four new assertions pass; pre-existing tests (post-auth/post-confirm) remain green.

- [ ] **Step 8: Synth-check both stacks**

Run (must not error):

```bash
pnpm nx run investor-web:test && pnpm nx run onboarding-bff:test
```

Expected: both test suites green end-to-end.

- [ ] **Step 9: Commit**

```bash
git add services/investor/investor-web/src/service.stack.ts \
        services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "feat(investor-web): reverse-proxy /api/copilotkit* to onboarding AgentCore"
```

---

## Task 4: Add `copilotApiUrl` to runtime config + Angular DI token

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.config.ts`
- Modify: `apps/nestfolio-host/src/environments/environment.ts`
- Modify: `apps/nestfolio-host/src/environments/environment.prod.ts`
- Modify: `apps/nestfolio-host/src/app/runtime-config.service.ts`
- Create: `apps/nestfolio-host/src/app/copilot-api-url.token.ts`

- [ ] **Step 1: Extend `RuntimeConfig` and `validateEndpoints`**

In `apps/nestfolio-host/src/app/app.config.ts`, update the `RuntimeConfig` interface (currently lines 12-20) and `validateEndpoints` (currently lines 28-42) so both reference the new `copilotApiUrl` field. Replace the interface and function with:

```ts
export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  appsync: {
    investorBff: { endpoint: string; region: string };
    advisoryBff: { endpoint: string; region: string };
    dashboardBff: { endpoint: string; region: string };
    ledgerBff: { endpoint: string; region: string };
  };
  /** Absolute CF URL for the CopilotKit bridge, e.g. "https://dXXX.cloudfront.net/api/copilotkit". */
  copilotApiUrl: string;
}
```

```ts
export function validateEndpoints(config: RuntimeConfig): void {
  const endpoints = [
    config.appsync.investorBff.endpoint,
    config.appsync.advisoryBff.endpoint,
    config.appsync.dashboardBff.endpoint,
    config.appsync.ledgerBff.endpoint,
    config.copilotApiUrl,
  ];

  for (const url of endpoints) {
    if (!url) continue;
    if (url.startsWith('https://')) continue;
    if (isDevMode() && url.startsWith('http://localhost')) continue;
    throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
  }
}
```

- [ ] **Step 2: Add the field to both environments**

In `apps/nestfolio-host/src/environments/environment.ts`, add this key to the exported object (after the `appsync` block):

```ts
  copilotApiUrl: 'http://localhost:4200/api/copilotkit',
```

In `apps/nestfolio-host/src/environments/environment.prod.ts`, add (empty — filled by the config.json at runtime):

```ts
  copilotApiUrl: '',
```

- [ ] **Step 3: Create the DI token**

Create `apps/nestfolio-host/src/app/copilot-api-url.token.ts`:

```ts
import { InjectionToken } from '@angular/core';

/**
 * Absolute URL of the CopilotKit bridge (CloudFront → AgentCore).
 * Sourced from RuntimeConfig.copilotApiUrl, populated by APP_INITIALIZER
 * in app.config.ts.
 */
export const COPILOT_API_URL = new InjectionToken<string>('COPILOT_API_URL');
```

- [ ] **Step 4: Provide the token from the app config**

In `apps/nestfolio-host/src/app/app.config.ts`, add an import at the top:

```ts
import { COPILOT_API_URL } from './copilot-api-url.token';
```

Inside `appConfig.providers` (currently lines 83-110), add a provider entry (anywhere after `provideZonelessChangeDetection()`):

```ts
    {
      provide: COPILOT_API_URL,
      useFactory: () => getRuntimeConfig().copilotApiUrl,
    },
```

- [ ] **Step 5: Expose `copilotApiUrl` from `RuntimeConfigService`**

In `apps/nestfolio-host/src/app/runtime-config.service.ts`, add a getter after the existing `appsync` getter:

```ts
  get copilotApiUrl(): string {
    return this.config.copilotApiUrl;
  }
```

- [ ] **Step 6: Type-check and run existing host tests**

Run:

```bash
pnpm nx run nestfolio-host:lint && pnpm nx run nestfolio-host:test
```

Expected: lint + all existing tests pass. TypeScript compile errors here usually indicate a missed field on one of the environment files — fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add apps/nestfolio-host/src/app/app.config.ts \
        apps/nestfolio-host/src/environments/environment.ts \
        apps/nestfolio-host/src/environments/environment.prod.ts \
        apps/nestfolio-host/src/app/runtime-config.service.ts \
        apps/nestfolio-host/src/app/copilot-api-url.token.ts
git commit -m "feat(nestfolio-host): expose copilotApiUrl via runtime config + DI token"
```

---

## Task 5: Wire the onboarding chat component to the DI token + JWT + session-id header

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`
- Modify: `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts`

- [ ] **Step 1: Write failing tests for URL + headers**

In `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts`, add (1) a mock for `@nestfolio/shell` (AuthStore) and `aws-amplify/auth` (`fetchAuthSession`) at the top, near the existing `jest.mock('@ag-ui/client', ...)`:

```ts
jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(async () => ({
    tokens: { idToken: { toString: () => 'fake-id-token' } },
  })),
}));

const mockAuthStoreUser = { tenantId: 'tenant-xyz' };
jest.mock('@nestfolio/shell', () => ({
  AuthStore: {},
}));
```

Then, inside `beforeEach`, replace the existing `TestBed.configureTestingModule` call with a version that provides the DI token + a stub `AuthStore`:

```ts
    await TestBed.configureTestingModule({
      imports: [OnboardingChatComponent],
      providers: [
        provideRouter([]),
        { provide: (await import('../../../nestfolio-host/src/app/copilot-api-url.token')).COPILOT_API_URL,
          useValue: 'https://example.cloudfront.net/api/copilotkit' },
        { provide: (await import('@nestfolio/shell')).AuthStore,
          useValue: { user: () => mockAuthStoreUser } },
      ],
    }).compileComponents();
```

Append the following test cases to the bottom of the `describe('OnboardingChatComponent', ...)` block:

```ts
  // ── Bridge wiring ───────────────────────────────────────────────────────────

  it('passes the absolute copilotApiUrl to HttpAgent', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpAgent } = require('@ag-ui/client');
    expect(HttpAgent).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.cloudfront.net/api/copilotkit' }),
    );
  });

  it('provides a headers factory that includes Bearer token + session-id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpAgent } = require('@ag-ui/client');
    const call = HttpAgent.mock.calls.at(-1)[0] as { headers?: () => Promise<Record<string, string>> };
    expect(typeof call.headers).toBe('function');
    const headers = await call.headers!();
    expect(headers['Authorization']).toBe('Bearer fake-id-token');
    expect(headers['x-amzn-bedrock-agentcore-runtime-session-id']).toMatch(/^tenant-xyz\/.+/);
  });

  it('persists the sessionId part across remounts via sessionStorage', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpAgent } = require('@ag-ui/client');
    const firstCall = HttpAgent.mock.calls.at(-1)[0] as { headers: () => Promise<Record<string, string>> };
    const firstHeaders = await firstCall.headers();
    const firstSid = firstHeaders['x-amzn-bedrock-agentcore-runtime-session-id'];

    // Remount the component (destroy + recreate).
    fixture.destroy();
    fixture = TestBed.createComponent(OnboardingChatComponent);
    fixture.detectChanges();

    const secondCall = HttpAgent.mock.calls.at(-1)[0] as { headers: () => Promise<Record<string, string>> };
    const secondHeaders = await secondCall.headers();
    expect(secondHeaders['x-amzn-bedrock-agentcore-runtime-session-id']).toBe(firstSid);
  });
```

- [ ] **Step 2: Run the tests — expect the new ones to fail**

Run:

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat
```

Expected: the three new tests fail (component still uses `BFF_URL = '/api/copilotkit'`, passes no `headers` factory, has no sessionStorage logic). Existing tests should still pass.

- [ ] **Step 3: Replace the hardcoded URL with the DI token + AuthStore**

In `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`:

1. Update the imports at the top (add after the existing `@angular/common` import on line 12):

```ts
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthStore } from '@nestfolio/shell';
import { COPILOT_API_URL } from '../../../../../nestfolio-host/src/app/copilot-api-url.token';
```

> **Note:** If your workspace has a TS path alias that exposes `@nestfolio/host` (or similar), prefer the alias over the relative path. Check `tsconfig.base.json`; if no alias exists, use the relative path shown.

2. Delete the hardcoded `BFF_URL` constant (currently line 58):

```ts
// DELETE this line:
// const BFF_URL = '/api/copilotkit'; // proxied to onboarding-bff
```

3. Inside the class, add injection fields right below the `vcr = inject(ViewContainerRef)` line (currently line 148):

```ts
  private readonly copilotApiUrl = inject(COPILOT_API_URL);
  private readonly authStore = inject(AuthStore);
```

4. Add a session-id helper method (place it right above `ngOnInit`, around line 174):

```ts
  private static readonly SESSION_KEY = 'onboarding.sessionId';

  private getOrCreateSessionId(): string {
    const existing = sessionStorage.getItem(OnboardingChatComponent.SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(OnboardingChatComponent.SESSION_KEY, fresh);
    return fresh;
  }
```

5. Replace the existing `ngOnInit` body with:

```ts
  ngOnInit(): void {
    this.agent = new HttpAgent({
      url: this.copilotApiUrl,
      headers: async () => {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString() ?? '';
        const tenantId = this.authStore.user()?.tenantId ?? '';
        const sessionId = this.getOrCreateSessionId();
        return {
          'Authorization': `Bearer ${idToken}`,
          'x-amzn-bedrock-agentcore-runtime-session-id': `${tenantId}/${sessionId}`,
        };
      },
    });
    this.destroyRef.onDestroy(() => this.cleanup());
    // Kick off with an initial agent turn to get the greeting
    this.runAgent([]);
  }
```

- [ ] **Step 4: Run the tests — expect them to pass**

Run:

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat
```

Expected: all existing tests + three new ones green. If `HttpAgent` does not accept `headers` at runtime, verify its type in `node_modules/@ag-ui/client/dist/index.d.ts` — the spec §"References" confirms support via a `headers` factory, and `@copilotkit/runtime-client-gql` re-exports it with the same shape.

- [ ] **Step 5: Lint**

Run:

```bash
pnpm nx run onboarding-mfe:lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts \
        apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts
git commit -m "feat(onboarding-mfe): post to CopilotKit bridge with Cognito JWT + session-id"
```

---

## Task 6: Deploy, smoke-test, and confirm acceptance criteria

**Files:**
- No code changes. Execute-and-verify task.

- [ ] **Step 1: Deploy onboarding-bff first**

Run from the repo root:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=onboarding-bff
```

Expected: stack update completes. Confirm the Cognito authorizer is attached:

```bash
aws ssm get-parameter --name "/nestfolio/dev-onboarding-bff/agent/runtimeUrl" --query "Parameter.Value" --output text
```

Expected: prints a `bedrock-agentcore` runtime ARN.

- [ ] **Step 2: Deploy investor-web second**

Run:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web
```

Expected: stack update completes. The `/api/copilotkit*` behavior is now attached.

- [ ] **Step 3: Confirm CORS preflight from `localhost:4200`**

Grab the distribution URL:

```bash
DIST_URL=$(aws ssm get-parameter --name "/nestfolio/dev-investor/web/distributionUrl" --query "Parameter.Value" --output text)
echo "Distribution: $DIST_URL"

curl -i -X OPTIONS "$DIST_URL/api/copilotkit" \
  -H "Origin: http://localhost:4200" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,x-amzn-bedrock-agentcore-runtime-session-id"
```

Expected: `HTTP/2 204` (or 200) with `access-control-allow-origin: http://localhost:4200` and the three request headers echoed in `access-control-allow-headers`.

- [ ] **Step 4: Confirm unauthenticated POST is rejected by AgentCore**

Run:

```bash
curl -i -X POST "$DIST_URL/api/copilotkit" \
  -H "Content-Type: application/json" \
  -H "x-amzn-bedrock-agentcore-runtime-session-id: tenant-smoke/session-smoke" \
  -d '{"messages":[]}'
```

Expected: `HTTP/2 401` or `403` (AgentCore's Cognito authorizer rejected the missing/invalid JWT). A 200 here would mean the authorizer did **not** attach — go back to Task 1.

- [ ] **Step 5: Confirm browser happy-path**

Start the dev server and exercise the onboarding flow in a real browser (one that can sign in via Cognito):

```bash
pnpm nx run nestfolio-host:serve
```

Open `http://localhost:4200`, complete the Cognito sign-in, navigate to the onboarding flow, and send one message. In the browser Network panel, verify:

- Request: `POST https://<dev-dist>.cloudfront.net/api/copilotkit` (not `/api/copilotkit` on localhost).
- Request headers include `Authorization: Bearer ey...` and `x-amzn-bedrock-agentcore-runtime-session-id: <tenantId>/<uuid>`.
- Response is `200` with `content-type: text/event-stream` and streams chunks progressively.
- CopilotKit phase renderer mounts (greeting message appears).

- [ ] **Step 6: Confirm trace envelope is emitted**

In the AWS console or CLI, verify the onboarding-bff service emits one `ONBOARDING_AGENT_INVOCATION_TRACED` event per invocation:

```bash
aws logs tail /aws/bedrock-agentcore/runtimes/onboarding_agent --since 5m --follow
```

Look for the `onboarding trace emit failed` warning — it should **not** appear. Additionally, tail the event-bus archive (or the CloudWatch events rule that the audit domain owns) to confirm an event with `detailType: ONBOARDING_AGENT_INVOCATION_TRACED` arrives with populated `tenantId` and `correlationId`.

- [ ] **Step 7: Update acceptance-criteria checkboxes in the spec**

Open `docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md` and tick each box under the "Acceptance criteria" section that your smoke run verified. Leave any un-verifiable item (e.g. prod-origin CORS) unchecked and note what is blocking.

- [ ] **Step 8: Commit the spec updates**

```bash
git add docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md
git commit -m "docs(onboarding-bridge): tick acceptance criteria after sandbox smoke"
```

---

## Deploy-order contract (reminder)

`onboarding-bff` **must** deploy before `investor-web`. Both stacks are per-service CDK apps; the SSM token used by `investor-web` fails to resolve at deploy time if the onboarding-bff stack has not published it. There is no `stack.addDependency(...)` escape hatch.

## Known open items (tracked outside this plan)

- **CF Function token substitution**: this plan uses `Fn.sub` explicitly (Task 3 Step 4) — the safest form across CDK versions. If a future CDK upgrade offers native token substitution inside `FunctionCode.fromInline`, the `Fn.sub` call can be dropped.
- **Prod CORS list**: the current plan hardcodes `localhost:4200` + the current distribution domain. Custom-domain prod deploys must append their own domain to `accessControlAllowOrigins`.
- **Session-id lifetime**: single-tab only (sessionStorage). A follow-up spec may promote to `localStorage` per tenant.
- **Container-side tenant hardening**: if future onboarding tools write tenant-scoped DDB rows, `parseRuntimeSessionId` must be replaced by a JWT-claim extractor (tracked in the design spec §"Open questions").
