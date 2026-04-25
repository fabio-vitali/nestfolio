# B1 — CloudFront unified topology in `investor-web` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow `investor-web`'s single CloudFront distribution to serve every BFF's MFE bundle, GraphQL HTTPS endpoint, and AppSync WSS endpoint, all SSM-discovered at deploy time, gated behind a `mfeBehaviors` CDK context flag for cold-start safety.

**Architecture:** Hardcoded `MFE_CATALOG` in investor-web drives a synth-time loop that calls three pure helper functions (`addMfeBucketBehavior`, `addGraphqlBehavior`, `addRealtimeBehavior`) on the existing `Distribution`. AppSync hostnames composed from a new `api/apiId` SSM export added to the shared `Facade` construct. One viewer-request CloudFront Function rewrites `/graphql/<domain>` and `/realtime/<domain>` to `/graphql`. Cold-start handled by a Phase 4 re-deploy of investor-web in `deploy.sh`, mirroring the existing hub re-deploy pattern.

**Tech Stack:** AWS CDK 2.x (TypeScript), `aws-cdk-lib/aws-cloudfront`, `aws-cdk-lib/aws-cloudfront-origins`, `aws-cdk-lib/aws-ssm`, Jest + `aws-cdk-lib/assertions`, `pnpm nx`, bash.

**Spec:** [`docs/superpowers/specs/2026-04-25-b1-cloudfront-unified-topology-design.md`](../specs/2026-04-25-b1-cloudfront-unified-topology-design.md)

---

## File map

**Modified:**
- `libs/cdk-constructs/src/core/facade.ts` — add `api/apiId` `StringParameter`.
- `libs/cdk-constructs/test/core/facade.test.ts` — assert new export.
- `services/investor/investor-web/src/service.stack.ts` — flag-gated B1 wiring.
- `services/investor/investor-web/test/unit/service.stack.test.ts` — flag-on/flag-off + per-behavior assertions.
- `infrastructure/scripts/deploy.sh` — cold-start helper + Phase 4a re-deploy.

**Created:**
- `services/investor/investor-web/src/mfe-catalog.ts` — typed `MFE_CATALOG` constant.
- `services/investor/investor-web/test/unit/mfe-catalog.test.ts` — catalog shape assertions.
- `services/investor/investor-web/src/b1-topology.ts` — three `add*Behavior` helpers.
- `services/investor/investor-web/src/cf-functions/realtime-rewrite.js` — viewer-request rewrite.
- `services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts` — rewrite unit tests.
- `tools/scripts/list-mfe-catalog.mjs` — Node helper that prints catalog as JSON for `deploy.sh`.

---

## Task 1: Add `api/apiId` SSM export to the Facade construct

**Files:**
- Modify: `libs/cdk-constructs/src/core/facade.ts:209-222` (the `// Store API URLs in SSM` block)
- Test: `libs/cdk-constructs/test/core/facade.test.ts`

- [ ] **Step 1: Read the existing facade test to mirror its patterns**

Read `libs/cdk-constructs/test/core/facade.test.ts` and find the test that asserts `api/graphqlUrl` is exported. The new test mirrors it.

- [ ] **Step 2: Write the failing test**

Append to `libs/cdk-constructs/test/core/facade.test.ts`:

```typescript
it('exports api/apiId SSM parameter for the GraphQL API id', () => {
  // Reuses the existing TestStack synthesis pattern in this file.
  // The facade is constructed with at least one resolver so the API exists.
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/nestfolio/test-investor-bff/api/apiId',
    Description: Match.stringLikeRegexp('AppSync API id'),
  });
});
```

If the test file uses a separate `describe` for "SSM exports", add the test inside it. Otherwise add a new `describe('Facade — api/apiId export', ...)`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern facade`
Expected: FAIL — assertion mismatch (parameter `/nestfolio/test-investor-bff/api/apiId` not found).

- [ ] **Step 4: Add the SSM export in `facade.ts`**

In `libs/cdk-constructs/src/core/facade.ts`, in the block that ends around line 222 (after `ApiRealtimeUrlParam`), add inside the `if (this.api)` block:

```typescript
new StringParameter(this, 'ApiIdParam', {
  parameterName: naming.ssmServicePath('api/apiId'),
  stringValue: this.api.apiId,
  description: `AppSync API id for ${id}`,
});
```

`this.api.apiId` is exposed by the `aws-cdk-lib/aws-appsync` `GraphqlApi` class — no extra import needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern facade`
Expected: PASS — all facade tests green, including the new one.

- [ ] **Step 6: Run full cdk-constructs suite to confirm no regression**

Run: `pnpm nx test cdk-constructs`
Expected: PASS — no other test broken by the additional parameter.

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/core/facade.ts libs/cdk-constructs/test/core/facade.test.ts
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add api/apiId SSM export to Facade

Facade now publishes the AppSync GraphQL API id at
/nestfolio/<prefix>-<service>/api/apiId. investor-web (B1) consumes this
to compose AppSync HTTPS + WSS hostnames for CloudFront origins.

Existing api/graphqlUrl + api/realtimeUrl exports unchanged (B3 will use them).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create the `MFE_CATALOG` constant

**Files:**
- Create: `services/investor/investor-web/src/mfe-catalog.ts`
- Test: `services/investor/investor-web/test/unit/mfe-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/investor/investor-web/test/unit/mfe-catalog.test.ts`:

```typescript
import { MFE_CATALOG, type MfeCatalogEntry } from '../../src/mfe-catalog';

describe('MFE_CATALOG', () => {
  it('contains exactly 5 entries for the 5 BFFs', () => {
    expect(MFE_CATALOG).toHaveLength(5);
  });

  it('has the expected mfe keys', () => {
    expect(MFE_CATALOG.map(e => e.key).sort()).toEqual([
      'advisory', 'dashboard', 'investor', 'ledger', 'onboarding',
    ]);
  });

  it('has 4 Facade-bearing entries (onboarding is the exception)', () => {
    const facadeBearing = MFE_CATALOG.filter(e => e.hasFacade);
    expect(facadeBearing).toHaveLength(4);
    expect(facadeBearing.map(e => e.key).sort()).toEqual([
      'advisory', 'dashboard', 'investor', 'ledger',
    ]);
    const onboarding = MFE_CATALOG.find(e => e.key === 'onboarding')!;
    expect(onboarding.hasFacade).toBe(false);
  });

  it('every entry resolves to an existing service name', () => {
    const validServices = [
      'investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff', 'onboarding-bff',
    ];
    for (const entry of MFE_CATALOG) {
      expect(validServices).toContain(entry.service);
    }
  });

  it('entries are typed via MfeCatalogEntry', () => {
    const sample: MfeCatalogEntry = MFE_CATALOG[0];
    expect(typeof sample.key).toBe('string');
    expect(typeof sample.subsystem).toBe('string');
    expect(typeof sample.service).toBe('string');
    expect(typeof sample.hasFacade).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-web --testPathPattern mfe-catalog`
Expected: FAIL — `Cannot find module '../../src/mfe-catalog'`.

- [ ] **Step 3: Create the catalog file**

Create `services/investor/investor-web/src/mfe-catalog.ts`:

```typescript
/**
 * Single source of truth for which BFFs CloudFront wires behaviors for.
 *
 * Charter §5 row 9a + §7 R6: investor-web's distribution serves /mfe/<key>/*
 * for every BFF, and /graphql/<domain> + /realtime/<domain> for every
 * Facade-bearing BFF. onboarding-bff is the documented exception — it has
 * no Facade (CopilotKit bridge instead, served by /api/copilotkit*).
 *
 * Adding a new MFE = one entry here + a new BFF stack with `MfeBucket`
 * (and `Facade`, if it has GraphQL).
 *
 * Read at synth by service.stack.ts and at deploy time by
 * tools/scripts/list-mfe-catalog.mjs.
 */
export interface MfeCatalogEntry {
  /** URL key under /mfe/<key>/* and the <domain> in /graphql/<domain>. */
  readonly key: string;
  /** CDK subsystem (services/<subsystem>/<service>). */
  readonly subsystem: string;
  /** BFF service name; SSM exports live under /nestfolio/<prefix>-<service>/. */
  readonly service: string;
  /** True if the BFF has a Facade (AppSync API). False = no /graphql or /realtime behavior. */
  readonly hasFacade: boolean;
}

export const MFE_CATALOG: readonly MfeCatalogEntry[] = [
  { key: 'investor',   subsystem: 'investor', service: 'investor-bff',   hasFacade: true  },
  { key: 'advisory',   subsystem: 'advisory', service: 'advisory-bff',   hasFacade: true  },
  { key: 'ledger',     subsystem: 'ledger',   service: 'ledger-bff',     hasFacade: true  },
  { key: 'dashboard',  subsystem: 'investor', service: 'dashboard-bff',  hasFacade: true  },
  { key: 'onboarding', subsystem: 'investor', service: 'onboarding-bff', hasFacade: false },
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test investor-web --testPathPattern mfe-catalog`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-web/src/mfe-catalog.ts services/investor/investor-web/test/unit/mfe-catalog.test.ts
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add MFE_CATALOG to investor-web

Single source of truth for the 5 BFFs CloudFront wires behaviors for.
Read by service.stack.ts at synth and (next task) by deploy.sh at deploy
time. Marks onboarding-bff as hasFacade=false (CopilotKit bridge instead
of /graphql).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create the `realtime-rewrite` CloudFront Function

**Files:**
- Create: `services/investor/investor-web/src/cf-functions/realtime-rewrite.js`
- Test: `services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

// realtime-rewrite.js is a literal CloudFront Function source — no
// templating, evaluated as-is in CF. In tests, load the file and
// instantiate the handler in a sandboxed Function.
function loadHandler(): (event: unknown) => unknown {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', 'src', 'cf-functions', 'realtime-rewrite.js'),
    'utf-8',
  );
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  return new Function(`${source}\nreturn handler;`)() as (event: unknown) => unknown;
}

describe('realtime-rewrite CF function', () => {
  const handler = loadHandler();

  function runEvent(uri: string) {
    const event = { request: { uri, querystring: {}, headers: {}, method: 'GET' } };
    const out = handler(event) as { uri: string };
    return out;
  }

  it('rewrites /realtime/<domain> to /graphql', () => {
    expect(runEvent('/realtime/investor').uri).toBe('/graphql');
    expect(runEvent('/realtime/advisory').uri).toBe('/graphql');
    expect(runEvent('/realtime/ledger').uri).toBe('/graphql');
    expect(runEvent('/realtime/dashboard').uri).toBe('/graphql');
  });

  it('rewrites /realtime/<domain>/ (trailing slash) to /graphql', () => {
    expect(runEvent('/realtime/investor/').uri).toBe('/graphql');
  });

  it('rewrites /graphql/<domain> to /graphql', () => {
    expect(runEvent('/graphql/investor').uri).toBe('/graphql');
    expect(runEvent('/graphql/advisory').uri).toBe('/graphql');
  });

  it('rewrites /graphql/<domain>/ (trailing slash) to /graphql', () => {
    expect(runEvent('/graphql/investor/').uri).toBe('/graphql');
  });

  it('does not rewrite /api/copilotkit*', () => {
    expect(runEvent('/api/copilotkit').uri).toBe('/api/copilotkit');
    expect(runEvent('/api/copilotkit/foo').uri).toBe('/api/copilotkit/foo');
  });

  it('does not rewrite the default behavior path', () => {
    expect(runEvent('/').uri).toBe('/');
    expect(runEvent('/index.html').uri).toBe('/index.html');
  });

  it('does not rewrite /mfe/<key>/* paths', () => {
    expect(runEvent('/mfe/investor/index.html').uri).toBe('/mfe/investor/index.html');
    expect(runEvent('/mfe/onboarding/remoteEntry.json').uri).toBe('/mfe/onboarding/remoteEntry.json');
  });

  it('does not rewrite paths that do not match the patterns', () => {
    expect(runEvent('/realtime').uri).toBe('/realtime');           // missing domain
    expect(runEvent('/graphql').uri).toBe('/graphql');              // already /graphql, untouched
    expect(runEvent('/realtimex/foo').uri).toBe('/realtimex/foo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-web --testPathPattern realtime-rewrite`
Expected: FAIL — `ENOENT: no such file or directory ... realtime-rewrite.js`.

- [ ] **Step 3: Create the rewrite Function source**

Create `services/investor/investor-web/src/cf-functions/realtime-rewrite.js`:

```javascript
function handler(event) {
  var request = event.request;
  // Match /realtime/<domain> or /graphql/<domain>; rewrite to /graphql.
  // <domain> is captured but not used — kept for future per-domain routing.
  // Bare /graphql (no <domain>) is intentionally NOT matched, so this function
  // is idempotent on already-rewritten URIs.
  var match = request.uri.match(/^\/(?:realtime|graphql)\/([^/]+)\/?$/);
  if (match) {
    request.uri = '/graphql';
  }
  return request;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test investor-web --testPathPattern realtime-rewrite`
Expected: PASS — all 8 cases green.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-web/src/cf-functions/realtime-rewrite.js services/investor/investor-web/test/unit/cf-functions/realtime-rewrite.test.ts
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add realtime-rewrite CF function

Viewer-request CloudFront Function that strips the <domain> segment from
/realtime/<domain> and /graphql/<domain>, leaving the AppSync-expected
/graphql URI. Lifted from the V1 spike (tools/spikes/wss-cf-spike) that
proved this pattern works for AppSync WSS subscriptions through CloudFront.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `mfeBehaviors` flag and `addMfeBucketBehavior` helper

**Files:**
- Create: `services/investor/investor-web/src/b1-topology.ts`
- Modify: `services/investor/investor-web/src/service.stack.ts` (after the existing copilot block)
- Modify: `services/investor/investor-web/test/unit/service.stack.test.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Append to `services/investor/investor-web/test/unit/service.stack.test.ts`:

```typescript
describe('InvestorWebStack — B1 unified topology (flag off)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorWebStack(app, 'TestStackB1Off', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('CacheBehaviors has exactly 1 entry (the existing /api/copilotkit*)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayEquals([
          Match.objectLike({ PathPattern: '/api/copilotkit*' }),
        ]),
      }),
    });
  });
});

describe('InvestorWebStack — B1 unified topology (flag on, /mfe/<key>/*)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { mfeBehaviors: 'true' } });
    const stack = new InvestorWebStack(app, 'TestStackB1OnMfe', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('adds /mfe/<key>/* behavior for each catalog entry', () => {
    for (const key of ['investor', 'advisory', 'ledger', 'dashboard', 'onboarding']) {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: `/mfe/${key}/*`,
              ViewerProtocolPolicy: 'redirect-to-https',
              AllowedMethods: Match.arrayWith(['GET', 'HEAD']),
            }),
          ]),
        }),
      });
    }
  });

  it('each /mfe/<key>/* origin uses the SSM-discovered bucket name', () => {
    // The Origin DomainName for an S3 origin in CDK is `<bucket>.s3.<region>.amazonaws.com`,
    // and the bucket name itself is a CFN dynamic reference resolving to
    // /nestfolio/test-<service>/mfe/bucketName. We assert the SSM lookup is wired.
    for (const service of ['investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff', 'onboarding-bff']) {
      template.hasParameter('*', {
        Type: 'AWS::SSM::Parameter::Value<String>',
        Default: `/nestfolio/test-${service}/mfe/bucketName`,
      });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test investor-web --testPathPattern service.stack`
Expected: FAIL — flag-off test passes (CacheBehaviors already has only `/api/copilotkit*`); flag-on tests FAIL because no `/mfe/*` behaviors are wired yet.

- [ ] **Step 3: Create the `b1-topology.ts` helper module (just `addMfeBucketBehavior` for now)**

Create `services/investor/investor-web/src/b1-topology.ts`:

```typescript
import { Construct } from 'constructs';
import {
  Distribution, ViewerProtocolPolicy, AllowedMethods, CachePolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { MfeCatalogEntry } from './mfe-catalog';

/**
 * Adds a CloudFront cache behavior for an MFE bundle bucket.
 *
 * Charter §7 R6 row 2: /mfe/<key>/* → that BFF's S3 bucket (SSM-discovered).
 * Bucket policy already grants CloudFront OAC access (provisioned by A3 in
 * the BFF stack).
 */
export function addMfeBucketBehavior(
  scope: Construct,
  distribution: Distribution,
  prefix: string,
  entry: MfeCatalogEntry,
): void {
  const bucketName = StringParameter.valueForStringParameter(
    scope, `/nestfolio/${prefix}-${entry.service}/mfe/bucketName`,
  );
  const bucket = Bucket.fromBucketName(scope, `MfeBucket-${entry.key}`, bucketName);

  distribution.addBehavior(`/mfe/${entry.key}/*`, new S3Origin(bucket), {
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
  });
}
```

- [ ] **Step 4: Wire the flag check + iteration in `service.stack.ts`**

In `services/investor/investor-web/src/service.stack.ts`, immediately after the existing `distribution.addBehavior('/api/copilotkit*', ...)` block (around line 219, before the SSM Parameters block), insert:

```typescript
    // ─── B1: unified topology (flag-gated) ─────────────────────────────────
    // Charter §5 row 9a + §7 R6: per-domain /mfe/<key>/*, /graphql/<domain>,
    // and /realtime/<domain> behaviors discovered via SSM. Cold-start: flag
    // is false on first deploy (BFF SSM exports don't exist yet); deploy.sh
    // re-deploys investor-web with mfeBehaviors=true after BFFs are deployed.
    const mfeBehaviorsEnabled = this.node.tryGetContext('mfeBehaviors') === 'true';
    if (mfeBehaviorsEnabled) {
      for (const entry of MFE_CATALOG) {
        addMfeBucketBehavior(this, distribution, this.prefix, entry);
      }
    }
```

Add imports at the top of the file (alongside existing imports):

```typescript
import { MFE_CATALOG } from './mfe-catalog';
import { addMfeBucketBehavior } from './b1-topology';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx test investor-web --testPathPattern service.stack`
Expected: PASS — flag-off test still green; flag-on `/mfe/<key>/*` tests now green.

- [ ] **Step 6: Run the full investor-web suite to confirm no regression**

Run: `pnpm nx test investor-web`
Expected: PASS — all existing tests still green.

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-web/src/b1-topology.ts services/investor/investor-web/src/service.stack.ts services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add /mfe/<key>/* behaviors gated by mfeBehaviors flag

investor-web's CloudFront distribution now adds a /mfe/<key>/* cache
behavior per MFE_CATALOG entry when CDK context flag mfeBehaviors=true.
Origin = SSM-discovered BFF bucket. Bucket policy already grants OAC (A3).

Flag default false: cold-start safe (Phase 2 deploys before BFFs publish
SSM exports). deploy.sh extension (next task) handles the Phase 4 re-deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `addGraphqlBehavior` helper + rewrite Function instantiation

**Files:**
- Modify: `services/investor/investor-web/src/b1-topology.ts` (add `addGraphqlBehavior`)
- Modify: `services/investor/investor-web/src/service.stack.ts` (instantiate `CfFunction`, call helper)
- Modify: `services/investor/investor-web/test/unit/service.stack.test.ts` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `services/investor/investor-web/test/unit/service.stack.test.ts` a new describe block:

```typescript
describe('InvestorWebStack — B1 unified topology (flag on, /graphql/<domain>)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { mfeBehaviors: 'true' } });
    const stack = new InvestorWebStack(app, 'TestStackB1OnGql', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('adds /graphql/<domain> behavior for each Facade-bearing catalog entry', () => {
    for (const domain of ['investor', 'advisory', 'ledger', 'dashboard']) {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: `/graphql/${domain}`,
              ViewerProtocolPolicy: 'https-only',
              AllowedMethods: Match.arrayWith(['POST']),
              FunctionAssociations: Match.arrayWith([
                Match.objectLike({ EventType: 'viewer-request' }),
              ]),
            }),
          ]),
        }),
      });
    }
  });

  it('does NOT add /graphql/onboarding (onboarding has no Facade)', () => {
    const distConfig = template.findResources('AWS::CloudFront::Distribution');
    const allBehaviors = Object.values(distConfig).flatMap(
      (r: any) => r.Properties.DistributionConfig.CacheBehaviors ?? [],
    );
    const onboardingGql = allBehaviors.filter((b: any) => b.PathPattern === '/graphql/onboarding');
    expect(onboardingGql).toHaveLength(0);
  });

  it('reads api/apiId SSM parameter for each Facade-bearing entry', () => {
    for (const service of ['investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff']) {
      template.hasParameter('*', {
        Type: 'AWS::SSM::Parameter::Value<String>',
        Default: `/nestfolio/test-${service}/api/apiId`,
      });
    }
  });

  it('creates one CloudFront Function for the realtime/graphql rewrite', () => {
    template.resourceCountIs('AWS::CloudFront::Function', 2); // copilot + realtime-rewrite
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test investor-web --testPathPattern service.stack`
Expected: FAIL — `/graphql/<domain>` behaviors absent; only one CF Function (copilot) currently exists.

- [ ] **Step 3: Add `addGraphqlBehavior` to `b1-topology.ts`**

Append to `services/investor/investor-web/src/b1-topology.ts`:

```typescript
import {
  AllowedMethods, CachePolicy, FunctionEventType, OriginRequestPolicy,
  Function as CfFunction, ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Stack } from 'aws-cdk-lib';

/**
 * Adds a CloudFront cache behavior for a BFF's AppSync HTTPS endpoint.
 *
 * Charter §7 R6 row 3: /graphql/<domain> → that BFF's AppSync HTTPS
 * endpoint. Hostname constructed from the SSM-discovered api/apiId
 * + Stack region. Viewer-request rewrite strips /<domain> so AppSync
 * sees /graphql.
 */
export function addGraphqlBehavior(
  scope: Construct,
  distribution: Distribution,
  prefix: string,
  entry: MfeCatalogEntry,
  rewriteFn: CfFunction,
): void {
  if (!entry.hasFacade) {
    throw new Error(`addGraphqlBehavior called for ${entry.key} which has no Facade`);
  }
  const apiId = StringParameter.valueForStringParameter(
    scope, `/nestfolio/${prefix}-${entry.service}/api/apiId`,
  );
  const region = Stack.of(scope).region;
  const httpHost = `${apiId}.appsync-api.${region}.amazonaws.com`;

  distribution.addBehavior(`/graphql/${entry.key}`, new HttpOrigin(httpHost), {
    viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    functionAssociations: [{ function: rewriteFn, eventType: FunctionEventType.VIEWER_REQUEST }],
  });
}
```

(The existing imports at the top of `b1-topology.ts` already cover `Distribution`, `Construct`, `StringParameter`, `MfeCatalogEntry`. Make sure `Stack`, `HttpOrigin`, `AllowedMethods`, `CachePolicy`, `FunctionEventType`, `OriginRequestPolicy`, `Function as CfFunction`, `ViewerProtocolPolicy` are imported alongside the existing ones — collapse imports as needed.)

- [ ] **Step 4: Instantiate the rewrite Function and call the helper in `service.stack.ts`**

In `services/investor/investor-web/src/service.stack.ts`, replace the B1 block from Task 4 with:

```typescript
    // ─── B1: unified topology (flag-gated) ─────────────────────────────────
    // Charter §5 row 9a + §7 R6: per-domain /mfe/<key>/*, /graphql/<domain>,
    // and /realtime/<domain> behaviors discovered via SSM. Cold-start: flag
    // is false on first deploy (BFF SSM exports don't exist yet); deploy.sh
    // re-deploys investor-web with mfeBehaviors=true after BFFs are deployed.
    const mfeBehaviorsEnabled = this.node.tryGetContext('mfeBehaviors') === 'true';
    if (mfeBehaviorsEnabled) {
      const realtimeRewriteFn = new CfFunction(this, 'RealtimeRewriteFn', {
        functionName: `${this.prefix}-investor-web-realtime-rewrite`,
        code: FunctionCode.fromInline(
          readFileSync(join(__dirname, 'cf-functions', 'realtime-rewrite.js'), 'utf-8'),
        ),
        comment: 'Rewrites /realtime/<domain> and /graphql/<domain> to /graphql',
      });

      for (const entry of MFE_CATALOG) {
        addMfeBucketBehavior(this, distribution, this.prefix, entry);
        if (entry.hasFacade) {
          addGraphqlBehavior(this, distribution, this.prefix, entry, realtimeRewriteFn);
        }
      }
    }
```

Update the import at the top:

```typescript
import { addMfeBucketBehavior, addGraphqlBehavior } from './b1-topology';
```

(`CfFunction`, `FunctionCode`, `readFileSync`, `join` are already imported in this file from existing copilot wiring.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx test investor-web --testPathPattern service.stack`
Expected: PASS — `/graphql/<domain>` for 4 BFFs; onboarding negative test passes; CF Function count = 2; SSM lookups present.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-web/src/b1-topology.ts services/investor/investor-web/src/service.stack.ts services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add /graphql/<domain> behaviors + rewrite function

investor-web now adds /graphql/<domain> behaviors for the 4 Facade-bearing
BFFs (investor, advisory, ledger, dashboard). Origin = AppSync HTTPS
hostname constructed from SSM-discovered api/apiId. Viewer-request CF
Function rewrites /<domain> → /graphql so AppSync sees its expected URI.

onboarding-bff is correctly skipped (hasFacade=false; CopilotKit bridge
serves its traffic via /api/copilotkit*).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `addRealtimeBehavior` helper

**Files:**
- Modify: `services/investor/investor-web/src/b1-topology.ts` (add `addRealtimeBehavior`)
- Modify: `services/investor/investor-web/src/service.stack.ts` (call helper inside the loop)
- Modify: `services/investor/investor-web/test/unit/service.stack.test.ts` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `services/investor/investor-web/test/unit/service.stack.test.ts`:

```typescript
describe('InvestorWebStack — B1 unified topology (flag on, /realtime/<domain>)', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { mfeBehaviors: 'true' } });
    const stack = new InvestorWebStack(app, 'TestStackB1OnRt', {
      prefix: 'test',
      service: 'investor-web',
      subsystem: 'investor',
    } as any);
    template = Template.fromStack(stack);
  });

  it('adds /realtime/<domain> behavior for each Facade-bearing catalog entry', () => {
    for (const domain of ['investor', 'advisory', 'ledger', 'dashboard']) {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: `/realtime/${domain}`,
              ViewerProtocolPolicy: 'https-only',
              AllowedMethods: Match.arrayWith(['POST']),
              FunctionAssociations: Match.arrayWith([
                Match.objectLike({ EventType: 'viewer-request' }),
              ]),
            }),
          ]),
        }),
      });
    }
  });

  it('does NOT add /realtime/onboarding (onboarding has no Facade)', () => {
    const distConfig = template.findResources('AWS::CloudFront::Distribution');
    const allBehaviors = Object.values(distConfig).flatMap(
      (r: any) => r.Properties.DistributionConfig.CacheBehaviors ?? [],
    );
    const onboardingRt = allBehaviors.filter((b: any) => b.PathPattern === '/realtime/onboarding');
    expect(onboardingRt).toHaveLength(0);
  });

  it('CacheBehaviors has exactly 14 path-pattern entries when flag is on', () => {
    const distConfig = template.findResources('AWS::CloudFront::Distribution');
    const cacheBehaviors = (Object.values(distConfig)[0] as any).Properties.DistributionConfig.CacheBehaviors;
    expect(cacheBehaviors).toHaveLength(14);
  });

  it('still has exactly 1 CloudFront Function for the realtime/graphql rewrite (reused, not duplicated)', () => {
    template.resourceCountIs('AWS::CloudFront::Function', 2); // copilot + realtime-rewrite
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test investor-web --testPathPattern service.stack`
Expected: FAIL — `/realtime/<domain>` behaviors absent; CacheBehaviors length test fails (currently 10: 1 copilot + 5 `/mfe/*` + 4 `/graphql/*`; needs 14 after Task 6 adds 4 `/realtime/*`).

- [ ] **Step 3: Add `addRealtimeBehavior` to `b1-topology.ts`**

Append to `services/investor/investor-web/src/b1-topology.ts`:

```typescript
/**
 * Adds a CloudFront cache behavior for a BFF's AppSync WSS endpoint.
 *
 * Charter §7 R6 row 4: /realtime/<domain> → that BFF's AppSync WSS endpoint.
 * Hostname constructed from the SSM-discovered api/apiId + Stack region.
 * Viewer-request rewrite strips /<domain> so AppSync sees /graphql (it
 * uses the same /graphql URI for both HTTPS and WSS handshakes).
 *
 * V1 spike validated this transport configuration end-to-end against
 * a real AppSync subscription.
 */
export function addRealtimeBehavior(
  scope: Construct,
  distribution: Distribution,
  prefix: string,
  entry: MfeCatalogEntry,
  rewriteFn: CfFunction,
): void {
  if (!entry.hasFacade) {
    throw new Error(`addRealtimeBehavior called for ${entry.key} which has no Facade`);
  }
  const apiId = StringParameter.valueForStringParameter(
    scope, `/nestfolio/${prefix}-${entry.service}/api/apiId`,
  );
  const region = Stack.of(scope).region;
  const wsHost = `${apiId}.appsync-realtime-api.${region}.amazonaws.com`;

  distribution.addBehavior(`/realtime/${entry.key}`, new HttpOrigin(wsHost), {
    viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    functionAssociations: [{ function: rewriteFn, eventType: FunctionEventType.VIEWER_REQUEST }],
  });
}
```

- [ ] **Step 4: Call the helper in `service.stack.ts`**

In `services/investor/investor-web/src/service.stack.ts`, inside the existing B1 loop, after the `addGraphqlBehavior` call:

```typescript
        if (entry.hasFacade) {
          addGraphqlBehavior(this, distribution, this.prefix, entry, realtimeRewriteFn);
          addRealtimeBehavior(this, distribution, this.prefix, entry, realtimeRewriteFn);
        }
```

Update the import:

```typescript
import { addMfeBucketBehavior, addGraphqlBehavior, addRealtimeBehavior } from './b1-topology';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx test investor-web --testPathPattern service.stack`
Expected: PASS — 4 `/realtime/<domain>` behaviors present; CacheBehaviors length = 14; CF Function count still 2.

- [ ] **Step 6: Run the full investor-web suite to confirm no regression**

Run: `pnpm nx test investor-web`
Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-web/src/b1-topology.ts services/investor/investor-web/src/service.stack.ts services/investor/investor-web/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add /realtime/<domain> behaviors

investor-web now adds /realtime/<domain> behaviors for the 4 Facade-bearing
BFFs. Origin = AppSync WSS hostname (appsync-realtime-api). Reuses the
same viewer-request rewrite function as /graphql/<domain> (single CF
Function, lower cost).

V1 spike (2026-04-24) validated this transport end-to-end. With this
task, charter §7 R6 unified topology is fully wired in CDK; deploy.sh
extension (next task) handles cold-start ordering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create the `list-mfe-catalog.mjs` deploy helper

**Files:**
- Create: `tools/scripts/list-mfe-catalog.mjs`

This script lets `deploy.sh` enumerate the catalog without parsing TypeScript. The catalog file is so simple that a regex pull-out is the simplest robust approach.

- [ ] **Step 1: Create the helper script**

Create `tools/scripts/list-mfe-catalog.mjs`:

```javascript
#!/usr/bin/env node
// Prints services/investor/investor-web/src/mfe-catalog.ts as JSON
// suitable for jq consumption by infrastructure/scripts/deploy.sh.
//
// Usage: node tools/scripts/list-mfe-catalog.mjs
// Output (one JSON array on stdout):
//   [{"key":"investor","service":"investor-bff","hasFacade":true}, ...]
//
// Why a separate helper instead of importing the .ts at deploy time:
// deploy.sh runs in bash before any ts-node bootstrap; node + a regex
// extraction is faster + has zero deps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, '..', '..', 'services', 'investor', 'investor-web', 'src', 'mfe-catalog.ts');
const source = readFileSync(catalogPath, 'utf-8');

// The catalog is a simple `as const` array of object literals. We extract
// the key/service/hasFacade triples. If anyone adds fields, the script
// keeps working as long as these three remain.
const re = /\{\s*key:\s*'([^']+)'[^}]*service:\s*'([^']+)'[^}]*hasFacade:\s*(true|false)\s*[^}]*\}/g;
const entries = [];
for (const m of source.matchAll(re)) {
  entries.push({ key: m[1], service: m[2], hasFacade: m[3] === 'true' });
}

if (entries.length === 0) {
  console.error(`list-mfe-catalog: no entries found in ${catalogPath}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(entries));
```

- [ ] **Step 2: Verify the script runs and produces the expected output**

Run: `node tools/scripts/list-mfe-catalog.mjs | jq .`
Expected output:

```json
[
  {"key": "investor", "service": "investor-bff", "hasFacade": true},
  {"key": "advisory", "service": "advisory-bff", "hasFacade": true},
  {"key": "ledger", "service": "ledger-bff", "hasFacade": true},
  {"key": "dashboard", "service": "dashboard-bff", "hasFacade": true},
  {"key": "onboarding", "service": "onboarding-bff", "hasFacade": false}
]
```

- [ ] **Step 3: Commit**

```bash
git add tools/scripts/list-mfe-catalog.mjs
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): add list-mfe-catalog deploy helper

Reads services/investor/investor-web/src/mfe-catalog.ts and prints the
entries as JSON. Used by deploy.sh (next task) to enumerate which BFF
SSM exports to verify before deploying investor-web with the
mfeBehaviors=true context flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Extend `deploy.sh` for cold-start re-deploy

**Files:**
- Modify: `infrastructure/scripts/deploy.sh`

This task has no automated test — the script's behaviour is verified by `--dry-run` invocation and (during execution) by running it against the dev account. The logic is small enough to read; the surrounding harness is the existing Phase 4 hub re-deploy pattern.

- [ ] **Step 1: Add the `check_all_b1_params_exist` helper and capture the cold-start flag**

In `infrastructure/scripts/deploy.sh`, after the existing `check_all_hub_params_exist` function (around line 147), add:

```bash
check_all_b1_params_exist() {
  if [ "$DRY_RUN" = "true" ]; then return 1; fi
  local region="${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
  local catalog
  catalog=$(node "$REPO_ROOT/tools/scripts/list-mfe-catalog.mjs") || return 1
  while IFS= read -r entry; do
    local svc has_facade
    svc=$(echo "$entry" | jq -r '.service')
    has_facade=$(echo "$entry" | jq -r '.hasFacade')
    aws ssm get-parameter --name "/nestfolio/${PREFIX}-${svc}/mfe/bucketName" \
      --region "$region" --query 'Parameter.Value' --output text >/dev/null 2>&1 || return 1
    if [ "$has_facade" = "true" ]; then
      aws ssm get-parameter --name "/nestfolio/${PREFIX}-${svc}/api/apiId" \
        --region "$region" --query 'Parameter.Value' --output text >/dev/null 2>&1 || return 1
    fi
  done < <(echo "$catalog" | jq -c '.[]')
  return 0
}
```

- [ ] **Step 2: Pass the flag at investor-web's Phase 2 deploy**

The `deploy_service` function currently builds `cdk deploy` with `-c` flags but doesn't accept extra context. We need a way to pass `-c mfeBehaviors=<bool>` to investor-web specifically.

Find the Phase loop body where services are deployed (around line 198-218). Above the parallel-deploy `while IFS= read -r cfg; do` block, capture the cold-start state once per phase:

```bash
    # Capture B1 readiness ONCE before this phase's deploys, since BFF
    # exports get published during Phase 3 itself.
    if [ "$PHASE" = "2" ]; then
      if check_all_b1_params_exist; then
        B1_BOOTSTRAP_NEEDED=false
        MFE_BEHAVIORS_PHASE2=true
      else
        B1_BOOTSTRAP_NEEDED=true
        MFE_BEHAVIORS_PHASE2=false
      fi
    fi
```

Then extend `deploy_service` to accept extra `-c` flags. Modify the function signature near line 82:

```bash
deploy_service() {
  local svc="$1"
  local region="${2:-}"
  local account="${3:-}"
  local config_json="$4"
  shift 4  # remaining args become extra -c flags appended to cdk deploy

  # ... existing body ...
```

And in the cdk deploy invocation (around line 109), append `"$@"`:

```bash
  env $env_vars npx cdk deploy \
    --app "npx ts-node -r ./tools/register-paths.js $app_path" \
    --require-approval never \
    --output "cdk.out.$svc" \
    -c prefix="$PREFIX" \
    -c tier="$RESOLVER_TIER" \
    -c observability="$observability" \
    -c logRetention="$log_retention" \
    -c protectedResources="$protected_resources" \
    -c region="$region_flag" \
    "$@"
```

In the Phase 2 deploy loop, when `SVC == investor-web`, pass the extra flag:

```bash
      if is_service_included "$SVC"; then
        if [ "$PHASE" = "2" ] && [ "$SVC" = "investor-web" ]; then
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" \
            -c mfeBehaviors="$MFE_BEHAVIORS_PHASE2"
        else
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg"
        fi
      fi
```

(Apply this change to **both** the serial-deploy and parallel-deploy `while` blocks in the Phase loop.)

- [ ] **Step 3: Add Phase 4a re-deploy of investor-web (cold-start only)**

Just before the existing `# Phase 4: Re-deploy hubs` block (around line 245), insert:

```bash
  # Phase 4a: Re-deploy investor-web with full B1 topology (only on cold start).
  # B1_BOOTSTRAP_NEEDED was captured at Phase 2 — by Phase 4 the BFFs have
  # published their api/apiId + mfe/bucketName SSM exports, so investor-web
  # can now synth + deploy with mfeBehaviors=true.
  if [ "${B1_BOOTSTRAP_NEEDED:-false}" = "true" ]; then
    if is_service_included "investor-web"; then
      echo ""
      echo "Phase 4a (investor-web re-deploy — cold-start B1 wiring):"
      INVESTOR_WEB_CFG=$(echo "$CONFIGS" | jq -c '.[] | select(.service == "investor-web")' | head -n1)
      deploy_service "investor-web" "$TARGET_REGION" "$TARGET_ACCOUNT" "$INVESTOR_WEB_CFG" \
        -c mfeBehaviors=true
    fi
  fi
```

- [ ] **Step 4: Verify the script with --dry-run**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --dry-run`
Expected: completes without error; in the printed Phase 2 output, investor-web's `[DRY RUN] Would deploy with: ...` line is followed by the `cdk deploy ... -c mfeBehaviors=...` invocation reflected in the trace; no Phase 4a output (because `--dry-run` skips the SSM existence check).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/scripts/deploy.sh
git commit -m "$(cat <<'EOF'
feat(b1-cloudfront-unified-topology): cold-start re-deploy of investor-web in deploy.sh

Phase 2 now passes mfeBehaviors=true to investor-web only when all BFF
SSM exports (api/apiId + mfe/bucketName) already exist. On a cold start
(first-ever deploy), Phase 2 deploys with mfeBehaviors=false and Phase 4a
re-deploys with mfeBehaviors=true after BFFs in Phase 3 have published
their exports. Mirrors the existing hub Phase 4 re-deploy pattern.

list-mfe-catalog.mjs is the single source of truth for which BFFs to
enumerate, matching the catalog read by service.stack.ts at synth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update investor-web service card

**Files:**
- Modify: `services/investor/investor-web/CLAUDE.md`

The CLAUDE.md is currently stale — A1 (CSP single-source) and A3 (per-BFF MFE bucket) are absent. B1 is the right moment to refresh it because the stack's role just expanded materially.

- [ ] **Step 1: Regenerate the service card via the audit-service skill**

Run the `audit-service` skill against `investor-web`. It will read the current code and emit a refreshed CLAUDE.md.

The refreshed card MUST include:
- **CSP source** is read at synth from `apps/nestfolio-host/csp.txt` (A1).
- The `mfeBehaviors` CDK context flag and the 13 B1 behaviors (5 × `/mfe/*`, 4 × `/graphql/*`, 4 × `/realtime/*`).
- The `realtime-rewrite` CloudFront Function and its rule (one Function for both `/graphql/*` and `/realtime/*`).
- New SSM **consumed** at deploy time: `/nestfolio/<prefix>-<service>/mfe/bucketName` (×5), `/nestfolio/<prefix>-<service>/api/apiId` (×4 Facade-bearing BFFs).
- **MFE_CATALOG** as the single source of truth for which BFFs are wired.
- **Cold-start contract:** Phase 2 may deploy with `mfeBehaviors=false`; deploy.sh re-deploys in Phase 4a with `mfeBehaviors=true`.

- [ ] **Step 2: Manual review of the regenerated card**

Read the regenerated `services/investor/investor-web/CLAUDE.md` and confirm the bullets above are present. If any are missing, edit them in.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-web/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(b1-cloudfront-unified-topology): refresh investor-web service card

Updates the service card to reflect A1 (CSP single-source), A3 (MfeBucket
read of web/distributionId via OAC), and B1 (MFE_CATALOG-driven /mfe/*,
/graphql/*, /realtime/* behaviors gated by mfeBehaviors flag, realtime
rewrite CF function, SSM consumption from BFFs).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Manual deploy verification (operator)

**Files:** None. This task verifies the work end-to-end against the dev AWS account.

- [ ] **Step 1: Confirm full test suite passes**

Run: `pnpm nx run-many -t test -p investor-web,cdk-constructs`
Expected: PASS — all tests green.

- [ ] **Step 2: Confirm CDK synth on its own**

Run: `pnpm nx run investor-web:synth -c prefix=dev -c mfeBehaviors=true`
Expected: synth completes with no errors. (If this target doesn't exist, fall back to `npx cdk synth --app "npx ts-node -r ./tools/register-paths.js services/investor/investor-web/src/main.ts" -c prefix=dev -c mfeBehaviors=true`.)

- [ ] **Step 3: Deploy to the dev account**

Steady-state path (BFFs already deployed, SSM exports exist):

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web
```

Expected output: investor-web's Phase 2 deploy passes `-c mfeBehaviors=true`; no Phase 4a runs.

- [ ] **Step 4: Inspect the live distribution**

Run: `aws cloudfront list-distributions --query 'DistributionList.Items[].[Id,Comment]' --output table` to find the investor-web distribution id.

Then: `aws cloudfront get-distribution --id <id> --query 'Distribution.DistributionConfig.{cacheBehaviors:CacheBehaviors.Items[].PathPattern, originCount:length(Origins.Items)}'`

Expected: 14 path patterns, 15 origins.

- [ ] **Step 5: Curl-test reachability of the new behaviors**

```bash
DIST=$(aws ssm get-parameter --name /nestfolio/dev-investor/web/distributionUrl --query 'Parameter.Value' --output text)
curl -i -o /dev/null -w "%{http_code}\n" "$DIST/mfe/investor/remoteEntry.json"        # 200 if bucket has assets, 403/404 if empty — both confirm origin reachable
curl -i -X POST -H "Content-Type: application/json" -d '{"query":"{__typename}"}' "$DIST/graphql/investor"   # 401 (auth-rejected) — confirms rewrite + reachability
```

Expected: each curl returns a real HTTP status (not 502/504). 401 from `/graphql/investor` confirms the viewer-request rewrite ran and AppSync responded.

- [ ] **Step 6: Cold-start verification (optional, requires fresh prefix)**

If verifying the cold-start path: pick a new prefix (e.g. `b1test`), tear down any existing stacks under it, then run:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=b1test
```

Expected: Phase 2 deploys investor-web with `mfeBehaviors=false`. Phase 3 deploys all BFFs (publishing exports). Phase 4a re-deploys investor-web with `mfeBehaviors=true`. Final state matches steady-state.

- [ ] **Step 7: No commit (verification only).**

If issues are found, return to the relevant task and fix; otherwise B1 is complete.

---

## Task 11: Open the pull request

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/b1-cloudfront-unified-topology`

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "feat(b1): CloudFront unified topology in investor-web" --body "$(cat <<'EOF'
## Summary
- investor-web's single CloudFront distribution now serves /mfe/<key>/*, /graphql/<domain>, and /realtime/<domain> for every BFF, all SSM-discovered at deploy time.
- Cold-start safe via mfeBehaviors CDK context flag + Phase 4a re-deploy in deploy.sh, mirroring the existing hub re-deploy pattern.
- Single shared-library change: Facade publishes a new api/apiId SSM export; existing api/graphqlUrl + api/realtimeUrl exports unchanged.

Implements charter §5 row 9a, §7 R6, §4 Pillar 5. Spec: docs/superpowers/specs/2026-04-25-b1-cloudfront-unified-topology-design.md.

## Test plan
- [ ] `pnpm nx run-many -t test -p investor-web,cdk-constructs` passes locally
- [ ] Steady-state deploy to dev: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web` succeeds with mfeBehaviors=true on the first pass
- [ ] `aws cloudfront get-distribution` against the live distribution shows 14 path-pattern cache behaviors + 15 origins
- [ ] `curl /mfe/investor/remoteEntry.json` returns a real status code (not 502/504)
- [ ] `curl -X POST /graphql/investor` returns 401 (auth-rejected, confirms rewrite + AppSync reachability)
- [ ] (Optional) Cold-start path on a fresh prefix verifies Phase 4a re-deploy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL to user.**

---

## Self-review summary

**Spec coverage:**
- §4 Architecture overview → Tasks 4–6.
- §6 Components and files touched → Tasks 1–9.
- §7 Data flow → Tasks 4 (mfe), 5 (graphql), 6 (realtime).
- §8 Cold-start and steady-state deploy → Tasks 7–8.
- §9 Error handling and rollback → flag-default behavior verified by Task 4 flag-off test; rollback path is operator-level (see Task 10 step 6 for cold-start, and `mfeBehaviors=false` reverts at any time).
- §10 Testing strategy → Tasks 1–6 each include the assertions enumerated in the spec; Task 10 covers manual verification.
- §11 Open questions → all closed in spec; this plan does not re-open any.

**Naming consistency check:** all helpers use the same names across tasks (`addMfeBucketBehavior`, `addGraphqlBehavior`, `addRealtimeBehavior`); the rewrite Function is referred to consistently as `realtimeRewriteFn` in code and `realtime-rewrite` as the file/comment label; SSM parameter names match the spec verbatim.

**Type consistency:** `MfeCatalogEntry` is defined in Task 2 and used unchanged through Tasks 4, 5, 6. The `hasFacade` flag controls iteration in Task 5/6 and is also asserted in Task 7's deploy helper.

**Dependencies between tasks:** Task 1 is independent. Task 2 must precede Tasks 4–6 (catalog used in iteration). Task 3 must precede Task 5 (rewrite function tested before instantiation). Task 7 must precede Task 8 (deploy.sh consumes the helper). Task 9 (CLAUDE.md) and Task 10 (manual verification) come after the code is in. Task 11 closes out.
