# WSS-through-CloudFront Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify whether AppSync GraphQL WebSocket subscriptions work end-to-end through a CloudFront proxy with path rewriting, before the broader MFE charter (R6 unified topology) commits to depending on it.

**Architecture:** Stand up a throwaway CloudFront distribution (`tools/spikes/wss-cf-spike/`) with one origin pointing at `investor-bff`'s AppSync realtime endpoint and one CloudFront Function rewriting `/realtime/investor` → `/graphql`. Write a Node test client using the workspace's existing `aws-appsync-subscription-link` to open `Subscription onNotificationRead` against the CF-proxied WSS URL; trigger via a direct AppSync mutation; assert the subscription receives the payload. Document the result in the charter and tear down.

**Tech Stack:** AWS CDK (TypeScript), CloudFront, CloudFront Functions, AWS AppSync, `aws-appsync-subscription-link@4.0.1`, `@apollo/client@3.x`, ts-node, Jest, AWS SDK v3, Cognito user-pool admin auth.

**Charter reference:** [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](../specs/2026-04-24-mfe-architecture-charter.md) §9 V1.

---

## Pre-flight checklist

Before Task 1, the executor must have:

- [ ] AWS credentials in the dev account (771924376645) via Leapp — `aws sts get-caller-identity` returns the AdminRole ARN.
- [ ] `dev`-prefixed `investor-bff` already deployed (verified by `aws ssm get-parameter --name /nestfolio/dev-investor-bff/api/graphqlUrl --region us-east-1` returning a value).
- [ ] At least one Cognito test user in the `dev-investor` user pool with a known password. If none exists, Task 6 includes admin-creating one.
- [ ] Workspace `pnpm install` is current.

---

## Task 1: Capture investor-bff identifiers

**Files:**
- Create: `tools/spikes/wss-cf-spike/.env.local` (gitignored)

This task records the IDs needed by every subsequent task. No code yet.

- [ ] **Step 1: Create the spike directory and gitignore the env file**

```bash
mkdir -p tools/spikes/wss-cf-spike/src
cat > tools/spikes/wss-cf-spike/.gitignore <<'EOF'
.env.local
cdk.out/
node_modules/
*.log
EOF
```

- [ ] **Step 2: Resolve the AppSync HTTPS URL from SSM**

```bash
aws ssm get-parameter \
  --name /nestfolio/dev-investor-bff/api/graphqlUrl \
  --region us-east-1 \
  --query Parameter.Value --output text
```
Expected output: `https://<api-id>.appsync-api.us-east-1.amazonaws.com/graphql`

Capture the `<api-id>` portion.

- [ ] **Step 3: Resolve the Cognito user pool IDs**

```bash
aws ssm get-parameter --name /nestfolio/dev-investor/auth/userPoolId --region us-east-1 --query Parameter.Value --output text
aws ssm get-parameter --name /nestfolio/dev-investor/auth/userPoolClientId --region us-east-1 --query Parameter.Value --output text
```
Expected: a `us-east-1_XXXXXXXXX` user pool ID and a 26-char client ID.

- [ ] **Step 4: Write `.env.local`**

Substitute the captured values:

```bash
cat > tools/spikes/wss-cf-spike/.env.local <<'EOF'
AWS_REGION=us-east-1
APPSYNC_API_ID=<paste-api-id>
APPSYNC_HTTPS_URL=https://<api-id>.appsync-api.us-east-1.amazonaws.com/graphql
APPSYNC_REALTIME_HOST=<api-id>.appsync-realtime-api.us-east-1.amazonaws.com
COGNITO_USER_POOL_ID=<paste-user-pool-id>
COGNITO_CLIENT_ID=<paste-client-id>
SPIKE_TEST_USERNAME=spike-wss-user@example.com
SPIKE_TEST_PASSWORD=<choose-strong-password>
SPIKE_TEST_TENANT_ID=spike-wss-tenant
EOF
```

The realtime hostname is the same `<api-id>` with the `appsync-api` segment replaced by `appsync-realtime-api` (a fixed AppSync convention; no separate SSM parameter exists).

- [ ] **Step 5: Commit the scaffolding**

```bash
git add tools/spikes/wss-cf-spike/.gitignore
git commit -m "spike(wss-cf): scaffold spike directory and gitignore"
```

The `.env.local` is gitignored — never committed.

---

## Task 2: Create the spike CDK app skeleton

**Files:**
- Create: `tools/spikes/wss-cf-spike/package.json`
- Create: `tools/spikes/wss-cf-spike/tsconfig.json`
- Create: `tools/spikes/wss-cf-spike/cdk.json`
- Create: `tools/spikes/wss-cf-spike/src/main.ts`

The spike is **standalone** — not registered as an Nx project. It runs through the AWS CDK CLI directly.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "wss-cf-spike",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "synth": "cdk synth",
    "deploy": "cdk deploy --require-approval never",
    "destroy": "cdk destroy --force"
  }
}
```

No dependencies declared here — relies on the workspace `node_modules` (CDK, ts-node, aws-cdk-lib are all already in the workspace devDeps).

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"]
}
```

Local — does not extend the workspace base, since the spike intentionally avoids path-alias magic.

- [ ] **Step 3: Write `cdk.json`**

```json
{
  "app": "npx ts-node --prefer-ts-exts src/main.ts",
  "watch": { "include": ["src/**"] }
}
```

- [ ] **Step 4: Write `src/main.ts`**

```typescript
import 'dotenv/config';
import { App } from 'aws-cdk-lib';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { SpikeStack } from './spike.stack';

dotenvConfig({ path: join(__dirname, '..', '.env.local') });

const required = ['APPSYNC_API_ID', 'APPSYNC_REALTIME_HOST', 'AWS_REGION'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = new App();

new SpikeStack(app, 'WssCfSpikeStack', {
  env: {
    region: process.env.AWS_REGION!,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  appsyncRealtimeHost: process.env.APPSYNC_REALTIME_HOST!,
});
```

`SpikeStack` is created in Task 3 — running `cdk synth` now will fail at the import; that's expected.

- [ ] **Step 5: Verify `dotenv` is in workspace devDeps**

```bash
node -e "console.log(require('dotenv/package.json').version)"
```
Expected: a version string. If "Cannot find module" — `pnpm add -D -w dotenv` and re-run.

- [ ] **Step 6: Commit**

```bash
git add tools/spikes/wss-cf-spike/package.json \
        tools/spikes/wss-cf-spike/tsconfig.json \
        tools/spikes/wss-cf-spike/cdk.json \
        tools/spikes/wss-cf-spike/src/main.ts
git commit -m "spike(wss-cf): scaffold standalone CDK app entry"
```

---

## Task 3: Write the CloudFront Function (path rewrite)

**Files:**
- Create: `tools/spikes/wss-cf-spike/src/path-rewrite.fn.js`

The function runs at viewer-request and rewrites `/realtime/investor` to `/graphql` so AppSync sees the path it expects. CloudFront Functions are pure JS (ES5.1, no Node API).

- [ ] **Step 1: Write the function**

```javascript
function handler(event) {
  var request = event.request;
  // Match /realtime/<domain>; rewrite to /graphql.
  // <domain> is captured but not currently used — kept for future per-domain routing.
  var match = request.uri.match(/^\/realtime\/([^/]+)\/?$/);
  if (match) {
    request.uri = '/graphql';
  }
  return request;
}
```

CF Functions cannot use regex groups via destructuring (limited ES5.1 runtime); the `match` result is captured even though `match[1]` (the domain) is not currently used.

- [ ] **Step 2: Commit**

```bash
git add tools/spikes/wss-cf-spike/src/path-rewrite.fn.js
git commit -m "spike(wss-cf): cf-function rewriting /realtime/<domain> to /graphql"
```

---

## Task 4: Write the spike CDK stack

**Files:**
- Create: `tools/spikes/wss-cf-spike/src/spike.stack.ts`

Provisions a single CloudFront distribution with: one origin = AppSync realtime hostname; one default behavior with WebSocket-friendly cache + origin-request policies; the path-rewrite CF Function attached at viewer-request; and an SSM export of the distribution domain name.

- [ ] **Step 1: Write the stack**

```typescript
import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SpikeStackProps extends StackProps {
  appsyncRealtimeHost: string;
}

export class SpikeStack extends Stack {
  constructor(scope: Construct, id: string, props: SpikeStackProps) {
    super(scope, id, props);

    const rewriteFn = new CfFunction(this, 'PathRewriteFn', {
      code: FunctionCode.fromInline(
        readFileSync(join(__dirname, 'path-rewrite.fn.js'), 'utf-8'),
      ),
      comment: 'Rewrites /realtime/<domain> to /graphql',
    });

    const origin = new HttpOrigin(props.appsyncRealtimeHost, {
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    });

    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [
          { function: rewriteFn, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      priceClass: PriceClass.PRICE_CLASS_100,
      comment: 'WSS-through-CloudFront spike — throwaway',
    });
    distribution.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new StringParameter(this, 'SpikeDistributionDomain', {
      parameterName: '/nestfolio/spike/wss-cf/distributionDomain',
      stringValue: distribution.distributionDomainName,
    });

    new CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
    });
  }
}
```

Key choices documented in the charter §7 R6:
- `CachingDisabled` cache policy — required for WebSocket upgrade (no caching of upgrade responses).
- `AllViewerExceptHostHeader` origin-request policy — forwards all viewer query strings (the `?header=<base64>` Cognito JWT goes here) and all viewer headers except `Host` (CF replaces `Host` with the origin's hostname, which is what AppSync needs).
- `ALLOW_ALL` allowed methods — WS upgrade is HTTP `GET` but other behaviors might be restricted by default; explicit is safer.
- `RemovalPolicy.DESTROY` — explicit teardown.

- [ ] **Step 2: Synth to verify the stack compiles**

```bash
cd tools/spikes/wss-cf-spike && npx cdk synth > /dev/null && echo OK
```
Expected: `OK` printed; no TypeScript errors. If errors — fix them before continuing.

- [ ] **Step 3: Commit**

```bash
git add tools/spikes/wss-cf-spike/src/spike.stack.ts
git commit -m "spike(wss-cf): cdk stack with cloudfront + appsync wss origin"
```

---

## Task 5: Deploy the spike stack

**Files:** none modified. Deploy operation only.

- [ ] **Step 1: Deploy**

```bash
cd tools/spikes/wss-cf-spike && npx cdk deploy --require-approval never
```
Expected: ~5 minutes (CloudFront global propagation). On success: `Outputs: WssCfSpikeStack.DistributionDomain = d<random>.cloudfront.net`.

- [ ] **Step 2: Capture the distribution domain**

```bash
DOMAIN=$(aws ssm get-parameter \
  --name /nestfolio/spike/wss-cf/distributionDomain \
  --region us-east-1 --query Parameter.Value --output text)
echo "Spike CF domain: $DOMAIN"
```

- [ ] **Step 3: Smoke-test the rewrite via plain HTTPS**

```bash
curl -sI "https://$DOMAIN/realtime/investor" | head -1
```
Expected: `HTTP/2 401` or `HTTP/2 400` (AppSync requires auth on `/graphql` over HTTPS — the **401/400** response confirms that the request reached AppSync via the rewrite, not a CloudFront 4xx for missing behavior). If you see `403` with `CloudFront` in the body, the behavior didn't match — debug Task 4.

- [ ] **Step 4: Commit a deployment note**

No file change; commit a note via empty marker is unnecessary. Skip — the deployment success is recorded by the next task's test outcome.

---

## Task 6: Write the subscription test client

**Files:**
- Create: `tools/spikes/wss-cf-spike/src/test-client.ts`
- Create: `tools/spikes/wss-cf-spike/src/cognito-auth.ts`
- Create: `tools/spikes/wss-cf-spike/src/ensure-test-user.ts`

Three small modules: Cognito JWT acquisition, ensuring the test user exists, and the actual subscription test.

- [ ] **Step 1: Write `cognito-auth.ts`**

```typescript
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export async function getCognitoIdToken(params: {
  region: string;
  clientId: string;
  username: string;
  password: string;
}): Promise<string> {
  const client = new CognitoIdentityProviderClient({ region: params.region });
  const out = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: params.clientId,
      AuthParameters: {
        USERNAME: params.username,
        PASSWORD: params.password,
      },
    }),
  );
  const idToken = out.AuthenticationResult?.IdToken;
  if (!idToken) throw new Error('No IdToken in Cognito auth response');
  return idToken;
}
```

- [ ] **Step 2: Write `ensure-test-user.ts`**

```typescript
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

export async function ensureTestUser(params: {
  region: string;
  userPoolId: string;
  username: string;
  password: string;
  tenantId: string;
}): Promise<void> {
  const client = new CognitoIdentityProviderClient({ region: params.region });

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: params.userPoolId,
        Username: params.username,
        TemporaryPassword: params.password,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: params.username },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:tenant_id', Value: params.tenantId },
        ],
      }),
    );
  } catch (err) {
    if (!(err instanceof UsernameExistsException)) throw err;
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: params.userPoolId,
      Username: params.username,
      Password: params.password,
      Permanent: true,
    }),
  );

  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: params.userPoolId,
      Username: params.username,
      UserAttributes: [{ Name: 'custom:tenant_id', Value: params.tenantId }],
    }),
  );
}
```

The `custom:tenant_id` claim is required by the BFF auth check (memory: "Cognito claim key: custom:tenant_id (snake_case) — verified from User Pool schema").

- [ ] **Step 3: Write `test-client.ts`**

```typescript
import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { join } from 'node:path';
import { ApolloClient, InMemoryCache, gql, HttpLink, from } from '@apollo/client/core';
import { createAuthLink, AUTH_TYPE } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import fetch from 'cross-fetch';
import { ensureTestUser } from './ensure-test-user';
import { getCognitoIdToken } from './cognito-auth';

dotenvConfig({ path: join(__dirname, '..', '.env.local') });

const requireEnv = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};

async function main(): Promise<void> {
  const region = requireEnv('AWS_REGION');
  const userPoolId = requireEnv('COGNITO_USER_POOL_ID');
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  const username = requireEnv('SPIKE_TEST_USERNAME');
  const password = requireEnv('SPIKE_TEST_PASSWORD');
  const tenantId = requireEnv('SPIKE_TEST_TENANT_ID');
  const cfDomain = requireEnv('SPIKE_CF_DOMAIN');
  const directHttps = requireEnv('APPSYNC_HTTPS_URL');

  console.log('[spike] Ensuring test user exists');
  await ensureTestUser({ region, userPoolId, username, password, tenantId });

  console.log('[spike] Acquiring Cognito ID token');
  const idToken = await getCognitoIdToken({ region, clientId, username, password });

  // CF-proxied URL for subscriptions; direct AppSync HTTPS for the trigger mutation.
  // Mutation is sent direct because R6 CloudFront proxying for GraphQL HTTP is
  // a separate concern; this spike only verifies WSS-through-CF.
  const cfGraphqlUrl = `https://${cfDomain}/realtime/investor`;

  const auth = {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: idToken,
  } as const;

  const subClient = new ApolloClient({
    link: from([
      createAuthLink({ url: cfGraphqlUrl, region, auth }),
      createSubscriptionHandshakeLink({ url: cfGraphqlUrl, region, auth }, new HttpLink({ uri: cfGraphqlUrl, fetch })),
    ]),
    cache: new InMemoryCache(),
  });

  const triggerClient = new ApolloClient({
    link: from([
      createAuthLink({ url: directHttps, region, auth }),
      new HttpLink({ uri: directHttps, fetch }),
    ]),
    cache: new InMemoryCache(),
  });

  console.log('[spike] Opening subscription via', cfGraphqlUrl);

  const received: unknown[] = [];
  const sub = subClient
    .subscribe({
      query: gql`
        subscription OnNotificationRead {
          onNotificationRead {
            notificationId
            readAt
          }
        }
      `,
    })
    .subscribe({
      next: (payload) => {
        console.log('[spike] subscription payload received:', JSON.stringify(payload.data));
        received.push(payload.data);
      },
      error: (err) => {
        console.error('[spike] subscription error:', err);
      },
    });

  // Give the WS time to handshake before triggering.
  await new Promise((r) => setTimeout(r, 5000));

  console.log('[spike] Triggering markNotificationRead mutation (direct AppSync)');
  // markNotificationRead requires a notificationId to exist; for the spike we send a
  // fabricated one — the resolver may return an error but @aws_subscribe still publishes
  // to subscribers of the mutation. If the spike BFF rejects the mutation entirely
  // (no row to update), swap to invoking a mutation that has no precondition (e.g.
  // initiateDeposit, then mark its notification). See Task 7 for fallback.
  const fabricatedNotificationId = 'spike-' + Date.now();
  try {
    await triggerClient.mutate({
      mutation: gql`
        mutation MarkRead($input: MarkNotificationReadInput!) {
          markNotificationRead(input: $input) {
            notificationId
            readAt
          }
        }
      `,
      variables: { input: { notificationId: fabricatedNotificationId } },
    });
  } catch (err) {
    console.warn('[spike] mutation errored (often expected for fabricated ID):', (err as Error).message);
  }

  // Wait up to 15 seconds for a payload.
  await new Promise((r) => setTimeout(r, 15000));

  sub.unsubscribe();
  subClient.stop();
  triggerClient.stop();

  if (received.length > 0) {
    console.log('[spike] PASS — subscription received', received.length, 'payload(s)');
    process.exit(0);
  } else {
    console.error('[spike] FAIL — no subscription payload received within 15s');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[spike] fatal:', err);
  process.exit(2);
});
```

- [ ] **Step 4: Verify the workspace has the required deps**

```bash
node -e "['@apollo/client','aws-appsync-auth-link','aws-appsync-subscription-link','cross-fetch','@aws-sdk/client-cognito-identity-provider'].forEach(p => console.log(p, require(p+'/package.json').version))"
```
Expected: a version printed for each. Any "Cannot find module" → `pnpm add -w <missing-pkg>` and retry.

- [ ] **Step 5: Update `.env.local` with the spike CF domain**

```bash
echo "SPIKE_CF_DOMAIN=$(aws ssm get-parameter --name /nestfolio/spike/wss-cf/distributionDomain --region us-east-1 --query Parameter.Value --output text)" >> tools/spikes/wss-cf-spike/.env.local
```

- [ ] **Step 6: Commit**

```bash
git add tools/spikes/wss-cf-spike/src/test-client.ts \
        tools/spikes/wss-cf-spike/src/cognito-auth.ts \
        tools/spikes/wss-cf-spike/src/ensure-test-user.ts
git commit -m "spike(wss-cf): test client opens subscription via cf, triggers via direct appsync"
```

---

## Task 7: Run the spike test and capture results

**Files:** none modified by the run itself. Output captured for Task 8.

- [ ] **Step 1: Run the test client**

```bash
cd tools/spikes/wss-cf-spike && npx ts-node src/test-client.ts 2>&1 | tee spike-result.log
```

Expected outcomes:
- **PASS path:** `[spike] PASS — subscription received N payload(s)` and exit code 0. → V1 verified, R6 same-origin holds.
- **FAIL path A:** `[spike] FAIL — no subscription payload received within 15s` and exit code 1. → Either CF didn't proxy the WS upgrade, or the mutation was silently rejected. Inspect:
  - `[spike] subscription error:` lines for handshake failure
  - The mutation `warn` line — if it complained about a missing row, the trigger never published
- **FAIL path B:** Subscription error during open (`[spike] subscription error: ...`) → CF proxy/handshake failure. Capture the error text verbatim.

- [ ] **Step 2: If FAIL path A (no error, no payload), retry with a real notification**

The fallback workflow: have the spike create a real notification first.

```bash
# In a separate terminal, with the same Cognito user authenticated, trigger
# whatever produces a real Notification row in investor-bff. Per investor-bff
# CLAUDE.md (Egress section), Notification rows are created server-side by
# the event-listener handling NOTIFICATION_CREATED events on InvestorBus. The
# simplest bypass: emit a synthetic NOTIFICATION_CREATED event:

aws events put-events --region us-east-1 --entries '[{
  "Source": "spike@wss-cf",
  "DetailType": "NOTIFICATION_CREATED",
  "EventBusName": "dev-investor-event-bus",
  "Detail": "{\"tenantId\":\"spike-wss-tenant\",\"userId\":\"<cognito-sub>\",\"notificationId\":\"spike-real-001\",\"createdAt\":\"2026-04-24T00:00:00Z\",\"kind\":\"SPIKE\"}"
}]'

# Then re-run the test client with input.notificationId = "spike-real-001".
```

Update `test-client.ts` line `const fabricatedNotificationId = ...` to the real ID and re-run Step 1.

- [ ] **Step 3: If FAIL path B (handshake fails), capture diagnostics**

```bash
# Re-run with debug logging on the WebSocket layer:
DEBUG='*' npx ts-node src/test-client.ts 2>&1 | tee spike-result-debug.log
```

Look for `WebSocket connection to 'wss://...' failed` lines and capture the underlying status code (401/403/upgrade-rejected/etc.). These are the inputs to the V1 fallback decision in Task 8.

- [ ] **Step 4: Save the result log**

`spike-result.log` (and `spike-result-debug.log` if produced) stay in the spike directory but are not committed (covered by the `.gitignore` rule for `*.log`).

---

## Task 8: Document the V1 result in the charter

**Files:**
- Modify: `docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` §9 V1

Update the charter's V1 section based on the result. Two templated outcomes — pick the one matching Task 7's result.

- [ ] **Step 1: Read the current §9 V1 wording**

Locate `### V1 — AppSync WSS subscription through CloudFront` in the charter.

- [ ] **Step 2: Apply the PASS update (if Task 7 exited 0)**

Replace the `**Status:**` line at the top of V1 (or add one if absent) and append a `**Result (2026-04-24):**` block:

```markdown
**Status:** Verified PASS (2026-04-24).

**Result:** A throwaway CloudFront distribution (spike code under `tools/spikes/wss-cf-spike/`, since torn down) with the configuration described in §7 R6 — `CachingDisabled` cache policy, `AllViewerExceptHostHeader` origin-request policy, viewer-request CF Function rewriting `/realtime/<domain>` → `/graphql`, custom HTTPS origin pointing at `<api-id>.appsync-realtime-api.us-east-1.amazonaws.com` — successfully proxied a `Subscription onNotificationRead` against `investor-bff`. The subscription handshake completed; a `markNotificationRead` mutation triggered a payload that arrived at the subscriber within seconds.

**Implication:** Charter §7 R6 is unblocked. Pillar 5 (`connect-src 'self'`) holds. No CSP exception row needed. Migration plans may proceed against the unified-topology design as written.
```

- [ ] **Step 3: Apply the FAIL update (if Task 7 exited non-zero)**

Replace with:

```markdown
**Status:** Failed verification (2026-04-24).

**Result:** A spike attempting CloudFront → AppSync WSS proxying with the §7 R6 configuration did NOT successfully receive subscription payloads. Failure mode: <describe the captured failure verbatim — handshake rejected with HTTP <code>, OR handshake completed but no payloads delivered, OR mutation could not trigger>. Diagnostic log preserved in spike-result-debug.log (not committed; under tools/spikes/wss-cf-spike/).

**Charter amendments required:**
- §7 R6 — replace the `/realtime/<domain>` row with: `wss://<api-id>.appsync-realtime-api.<region>.amazonaws.com` direct (sole exception to same-origin).
- Pillar 5 invariant — relax to "same-origin except AppSync subscription WebSockets."
- §7 R6 CSP consequence — `connect-src 'self' wss://*.appsync-realtime-api.*.amazonaws.com`.
```

- [ ] **Step 4: Commit the charter update**

```bash
git add docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md
git commit -m "spec(charter): record V1 wss-through-cloudfront verification result"
```

---

## Task 9: Tear down the spike infrastructure

**Files:** none modified.

- [ ] **Step 1: Destroy the CloudFront stack**

```bash
cd tools/spikes/wss-cf-spike && npx cdk destroy --force
```
Expected: ~5-10 minutes (CloudFront propagation). On success: stack deleted in CloudFormation console.

- [ ] **Step 2: Verify SSM parameter is gone**

```bash
aws ssm get-parameter --name /nestfolio/spike/wss-cf/distributionDomain --region us-east-1 2>&1 | grep -q ParameterNotFound && echo "Cleaned" || echo "STILL PRESENT"
```
Expected: `Cleaned`. If `STILL PRESENT` — manually delete with `aws ssm delete-parameter --name /nestfolio/spike/wss-cf/distributionDomain --region us-east-1`.

- [ ] **Step 3: Optionally delete the test Cognito user**

```bash
source tools/spikes/wss-cf-spike/.env.local
aws cognito-idp admin-delete-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "$SPIKE_TEST_USERNAME" \
  --region "$AWS_REGION" || echo "(user may not exist; ignore)"
```

---

## Task 10: Decide on retaining or deleting the spike code

**Files:**
- Possibly delete: `tools/spikes/wss-cf-spike/`

The spike code itself is throwaway, but keeping it under `tools/spikes/` provides a reference implementation for any future re-verification (e.g. after a CloudFront/AppSync API change).

- [ ] **Step 1: Decide retention**

Two options:
- **Retain** (default): leave `tools/spikes/wss-cf-spike/` in tree as a documented reference. The README below is required.
- **Delete**: `git rm -r tools/spikes/wss-cf-spike/ && git commit -m "spike(wss-cf): remove spike code after charter §9 V1 was recorded"`. The result lives only in the charter section.

- [ ] **Step 2 (only if retaining): Write the README**

Create `tools/spikes/wss-cf-spike/README.md`:

```markdown
# WSS-through-CloudFront spike

**Status:** Completed 2026-04-24. See `docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` §9 V1 for the verification result.

This is throwaway/reference code. The CDK stack is **not deployed**. To re-run:
1. Provide `.env.local` per the plan (`docs/superpowers/plans/2026-04-24-wss-cloudfront-spike.md` Task 1).
2. `cd tools/spikes/wss-cf-spike && npx cdk deploy --require-approval never`.
3. Capture the spike CF domain into `.env.local` as `SPIKE_CF_DOMAIN`.
4. `npx ts-node src/test-client.ts`.
5. `npx cdk destroy --force` when done.

If the AppSync API or CloudFront WS handling changes, re-run to re-verify.
```

- [ ] **Step 3: Commit (if retaining)**

```bash
git add tools/spikes/wss-cf-spike/README.md
git commit -m "spike(wss-cf): document retained reference spike"
```

---

## Self-check (executor)

After Task 10, verify:

- [ ] No CloudFront distribution named "WSS-through-CloudFront spike" exists in the dev account (`aws cloudfront list-distributions --region us-east-1 --query 'DistributionList.Items[?Comment==\`WSS-through-CloudFront spike — throwaway\`]'` returns `[]`).
- [ ] No SSM parameter at `/nestfolio/spike/*` exists.
- [ ] The charter §9 V1 has a **Status:** line reflecting the result and a **Result:** block with the captured outcome.
- [ ] If retained, `tools/spikes/wss-cf-spike/README.md` is committed; the `.env.local` file is **not** committed.

---

## What this plan does NOT cover

- Implementing the broader MFE charter (federation contract lib, per-app refactors, runtime-config target, CSP single-source, CloudFront unified topology in `investor-web`, per-BFF MFE buckets, shell deploy migration, Apollo per-MFE refactor). These are separate plans, each going through its own brainstorm → plan cycle, sequenced after V1 lands.
- Migration of current code from the existing convention (env-baked URLs, single `investor-web`-owned bucket, etc.) to the charter-conformant target. This is a multi-spec migration plan — out of scope here.
- Any production CloudFront change. The spike is dev-only and torn down at the end.
