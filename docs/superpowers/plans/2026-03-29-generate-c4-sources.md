# generate-c4-sources.mjs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a script that auto-generates all C4 D2 diagram sources (C1/C2/C3) from the CDK `service.stack.ts` files, replacing hand-maintained D2 files.

**Architecture:** Single Node.js ESM script (`tools/generate-c4-sources.mjs`) with three layers: discovery (scan `services/` directory), parsing (regex extraction from TypeScript), and generation (D2 string templates). The script writes `docs/architecture/nestfolio.d2` + `docs/architecture/c3/*.d2`, then the existing `generate-c4-diagrams.mjs` compiles them to SVG.

**Tech Stack:** Node.js ESM, regex-based TypeScript parsing, D2 language output.

---

## File Structure

```
tools/
  generate-c4-sources.mjs          # Main script (CREATE)
test/tools/
  generate-c4-sources.test.mjs     # Unit tests (CREATE)
docs/architecture/
  nestfolio.d2                      # Generated (OVERWRITE)
  c3/*.d2                           # Generated (OVERWRITE)
  icons/cloudfront.svg              # New icon (CREATE — needed for investor-web)
```

## Service Patterns Reference

The parser must detect these 7 service patterns from `service.stack.ts`:

| Pattern | Signature | Examples |
|---------|-----------|----------|
| **Standard ctrl** | State + Ingress + Egress | investor-ctrl, advisory-ctrl, ledger-ctrl |
| **BFF** | State + Ingress + Facade | investor-bff, dashboard-bff, advisory-bff |
| **Orchestrated ctrl** | State + multi-Ingress + Egress + Orchestration | broker-ctrl, decision-workflow-ctrl |
| **Agent BFF** | State + Egress + AgentRuntime + KnowledgeBase | onboarding-bff |
| **Hub** | raw EventBus + Archive (no high-level constructs) | investor-hub, advisory-hub |
| **Cross-domain adapter** | resolveBusArn + Rule + EventBusTarget (no State) | investor-adpt, advisory-adpt |
| **Data adapter** | State + Ingress + Egress + AdapterSchedule | alpha-vantage-adpt, fred-adpt |
| **Web frontend** | Cognito + S3 + CloudFront (no standard constructs) | investor-web |

## Construct → D2 Resource Mapping

| Construct | D2 Group Color | AWS Resources Inside |
|-----------|---------------|---------------------|
| State | `#E3F2FD` / `#2196F3` | DynamoDB Table + Stream; optionally S3 Bucket |
| Ingress | `#FFF8E1` / `#FFC107` | EventBridge Rule + SQS Queue + DLQ + Lambda |
| Egress | `#FBE9E7` / `#FF5722` | Lambda Publisher + EventBridge Bus + DLQ |
| Facade | `#F3E5F5` / `#9C27B0` | AppSync API + JS Resolvers + SSM |
| Orchestration | `#E8F5E9` / `#4CAF50` | Step Functions StateMachine + DLQ |
| AgentRuntime | `#E8F5E9` / `#4CAF50` | Bedrock AgentCore + MCP Gateway |
| KnowledgeBase | `#FFF3E0` / `#FF9800` | Bedrock KB + S3 Bucket |
| AgentMemory | `#E0F2F1` / `#00695C` | Bedrock AgentCore Memory |

---

## Task 1: Service Discovery

**Files:**
- Create: `tools/generate-c4-sources.mjs` (discovery functions only)
- Create: `test/tools/generate-c4-sources.test.mjs`

- [ ] **Step 1: Write failing test for discoverServices()**

```js
// test/tools/generate-c4-sources.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverServices } from '../../tools/generate-c4-sources.mjs';

describe('discoverServices', () => {
  it('returns services grouped by domain', () => {
    const services = discoverServices();
    // Must find 4 domains
    const domains = [...new Set(services.map(s => s.domain))];
    assert.ok(domains.includes('investor'));
    assert.ok(domains.includes('advisory'));
    assert.ok(domains.includes('execution'));
    assert.ok(domains.includes('ledger'));
    // Must find known services
    const names = services.map(s => s.service);
    assert.ok(names.includes('investor-ctrl'));
    assert.ok(names.includes('dashboard-bff'));
    assert.ok(names.includes('broker-ctrl'));
    // Each entry has stackPath pointing to a real file
    for (const s of services) {
      assert.ok(s.stackPath.endsWith('service.stack.ts'));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement discoverServices()**

```js
// tools/generate-c4-sources.mjs
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SERVICES_DIR = join(ROOT, 'services');

/**
 * Scan services/{domain}/{service}/src/service.stack.ts
 * Returns array of { domain, service, stackPath }
 */
export function discoverServices() {
  const results = [];
  for (const domain of readdirSync(SERVICES_DIR, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    const domainDir = join(SERVICES_DIR, domain.name);
    for (const svc of readdirSync(domainDir, { withFileTypes: true })) {
      if (!svc.isDirectory()) continue;
      const stackPath = join(domainDir, svc.name, 'src', 'service.stack.ts');
      if (existsSync(stackPath)) {
        results.push({
          domain: domain.name,
          service: svc.name,
          stackPath,
        });
      }
    }
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add service discovery for C4 source generator"
```

---

## Task 2: Stack Parser — High-Level Constructs

**Files:**
- Modify: `tools/generate-c4-sources.mjs`
- Modify: `test/tools/generate-c4-sources.test.mjs`

The parser reads TypeScript source and extracts construct usage via regex. It does NOT execute TypeScript — it pattern-matches on `new ConstructName(this, 'Id', { props })`.

- [ ] **Step 1: Write failing tests for parseStack()**

```js
describe('parseStack', () => {
  it('detects State construct', () => {
    const src = `const state = new State(this, 'State');`;
    const result = parseStack(src);
    assert.equal(result.constructs.state.length, 1);
    assert.equal(result.constructs.state[0].id, 'State');
  });

  it('detects State with withBucket prop', () => {
    const src = `const state = new State(this, 'State', { withBucket: true });`;
    const result = parseStack(src);
    assert.equal(result.constructs.state[0].withBucket, true);
  });

  it('detects multiple Ingress constructs with eventTypes', () => {
    const src = `
      const ingress = new Ingress(this, 'Ingress', {
        state,
        eventTypes: ['BALANCE_UPDATED', 'PORTFOLIO_UPDATED'],
      });
      const callbackIngress = new Ingress(this, 'CallbackIngress', {
        state,
        eventTypes: ['SIM_ORDER_FILLED', 'SIM_ORDER_REJECTED'],
        entry: join(__dirname, 'handlers', 'callback-resolver.ts'),
      });
    `;
    const result = parseStack(src);
    assert.equal(result.constructs.ingress.length, 2);
    assert.deepEqual(result.constructs.ingress[0].eventTypes, ['BALANCE_UPDATED', 'PORTFOLIO_UPDATED']);
    assert.equal(result.constructs.ingress[0].id, 'Ingress');
    assert.deepEqual(result.constructs.ingress[1].eventTypes, ['SIM_ORDER_FILLED', 'SIM_ORDER_REJECTED']);
  });

  it('detects Ingress eventTypes from enum references', () => {
    const src = `
      new Ingress(this, 'Ingress', {
        state,
        eventTypes: [BrokerSimEventTypes.SIM_ORDER_REQUESTED, BrokerSimEventTypes.SIM_DEPOSIT_INITIATED],
      });
    `;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.ingress[0].eventTypes, ['SIM_ORDER_REQUESTED', 'SIM_DEPOSIT_INITIATED']);
  });

  it('detects Ingress eventTypes from spread variables', () => {
    const src = `
      const TRIGGER_EVENT_TYPES = ['MANDATE_GRANTED', 'GOAL_UPDATED'];
      new Ingress(this, 'TriggerIngress', {
        state,
        eventTypes: [...TRIGGER_EVENT_TYPES],
      });
    `;
    const result = parseStack(src);
    assert.deepEqual(result.constructs.ingress[0].eventTypes, ['MANDATE_GRANTED', 'GOAL_UPDATED']);
  });

  it('detects Egress with publishableTypes', () => {
    const src = `new Egress(this, 'Egress', { state, publishableTypes: ['NormalizedEvent'] });`;
    const result = parseStack(src);
    assert.equal(result.constructs.egress.length, 1);
    assert.deepEqual(result.constructs.egress[0].publishableTypes, ['NormalizedEvent']);
  });

  it('detects Facade with jsResolvers', () => {
    const src = `new Facade(this, 'Facade', { state, jsResolvers: discoverJsResolvers(__dirname) });`;
    const result = parseStack(src);
    assert.equal(result.constructs.facade.length, 1);
    assert.equal(result.constructs.facade[0].hasJsResolvers, true);
  });

  it('detects Orchestration with triggers', () => {
    const src = `
      const orderOrchestration = new Orchestration(this, 'OrderStateMachine', {
        state,
        definitionBody: orderWorkflow.definitionBody,
        triggers: [BrokerCtrlInboundEventTypes.ORDER_SUBMITTED],
        timeout: Duration.hours(1),
      });
    `;
    const result = parseStack(src);
    assert.equal(result.constructs.orchestration.length, 1);
    assert.equal(result.constructs.orchestration[0].id, 'OrderStateMachine');
  });

  it('detects AgentRuntime', () => {
    const src = `new AgentRuntime(this, 'OnboardingAgent', { runtimeName: 'onboarding-agent' });`;
    const result = parseStack(src);
    assert.equal(result.constructs.agentRuntime.length, 1);
  });

  it('detects KnowledgeBase', () => {
    const src = `const kb = new KnowledgeBase(this, 'OnboardingKB', { kbName: 'nestfolio-docs' });`;
    const result = parseStack(src);
    assert.equal(result.constructs.knowledgeBase.length, 1);
  });

  it('detects agentcore.Memory', () => {
    const src = `const memory = new agentcore.Memory(this, 'AgentMemory', { memoryName: 'test' });`;
    const result = parseStack(src);
    assert.equal(result.constructs.agentMemory.length, 1);
    assert.equal(result.constructs.agentMemory[0].id, 'AgentMemory');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL — parseStack not defined

- [ ] **Step 3: Implement parseStack() for high-level constructs**

```js
/**
 * Parse a service.stack.ts source string and extract construct usage.
 * Returns { constructs: { state[], ingress[], egress[], facade[], orchestration[], agentRuntime[], knowledgeBase[] }, raw: { ... } }
 */
export function parseStack(src) {
  const result = {
    constructs: {
      state: [],
      ingress: [],
      egress: [],
      facade: [],
      orchestration: [],
      agentRuntime: [],
      knowledgeBase: [],
      agentMemory: [],
    },
    raw: {
      eventBuses: [],
      archives: [],
      rules: [],
      lambdas: [],
      buckets: [],
      userPools: [],
      distributions: [],
      schedules: [],
    },
  };

  // State: new State(this, 'Id') or new State(this, 'Id', { ... })
  for (const m of src.matchAll(/new\s+State\s*\(\s*this\s*,\s*['"](\w+)['"]\s*(?:,\s*(\{[^)]*\}))?\s*\)/gs)) {
    const entry = { id: m[1], withBucket: false, withTable: true };
    const propsBlock = m[2] || '';
    if (/withBucket\s*:\s*true/.test(propsBlock)) entry.withBucket = true;
    if (/withTable\s*:\s*false/.test(propsBlock)) entry.withTable = false;
    result.constructs.state.push(entry);
  }

  // Ingress: new Ingress(this, 'Id', { eventTypes: [...], ... })
  // Use a two-pass approach: find each Ingress, then extract its props block via brace matching
  for (const m of src.matchAll(/new\s+Ingress\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const entry = { id: m[1], eventTypes: [] };
    // Extract eventTypes from the region after this match
    const after = src.slice(m.index);
    const etMatch = after.match(/eventTypes\s*:\s*\[([\s\S]*?)\]/);
    if (etMatch) {
      // 1. Try string literals: ['EVT_A', 'EVT_B']
      entry.eventTypes = [...etMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
      // 2. Try enum references: EnumType.MEMBER
      if (entry.eventTypes.length === 0) {
        entry.eventTypes = [...etMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]);
      }
      // 3. Try spread variables: [...VAR_NAME] or [...VAR1, ...VAR2]
      if (entry.eventTypes.length === 0) {
        const spreads = [...etMatch[1].matchAll(/\.\.\.(\w+)/g)].map(x => x[1]);
        for (const constName of spreads) {
          const constMatch = src.match(new RegExp(`(?:const|let|export\\s+const)\\s+${constName}\\s*(?::\\s*\\w+(?:\\[\\])?)?\\s*=\\s*\\[([\\s\\S]*?)\\]`));
          if (constMatch) {
            // Extract from the const array (string literals or enum refs)
            const literals = [...constMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
            if (literals.length > 0) entry.eventTypes.push(...literals);
            else entry.eventTypes.push(...[...constMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]));
          }
        }
      }
      // 4. Try single variable reference: eventTypes: VAR_NAME
      if (entry.eventTypes.length === 0) {
        const refMatch = after.match(/eventTypes\s*:\s*(\w+)\s*[,\n}]/);
        if (refMatch) {
          const constName = refMatch[1];
          const constMatch = src.match(new RegExp(`(?:const|let)\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
          if (constMatch) {
            entry.eventTypes = [...constMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
            if (entry.eventTypes.length === 0) {
              entry.eventTypes = [...constMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]);
            }
          }
        }
      }
    }
    // Detect custom entry (handler file)
    const entryMatch = after.match(/entry\s*:\s*(?:join\s*\([^)]*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])/);
    if (entryMatch) {
      entry.handlerFile = entryMatch[1] || entryMatch[2];
    }
    result.constructs.ingress.push(entry);
  }

  // Egress: new Egress(this, 'Id', { state, publishableTypes: [...] })
  for (const m of src.matchAll(/new\s+Egress\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const entry = { id: m[1], publishableTypes: [] };
    const after = src.slice(m.index);
    const ptMatch = after.match(/publishableTypes\s*:\s*\[([\s\S]*?)\]/);
    if (ptMatch) {
      entry.publishableTypes = [...ptMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
    }
    result.constructs.egress.push(entry);
  }

  // Facade: new Facade(this, 'Id', { ... })
  for (const m of src.matchAll(/new\s+Facade\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    const entry = { id: m[1], hasJsResolvers: false, hasLambdaResolvers: false };
    const after = src.slice(m.index, m.index + 500);
    if (/jsResolvers\s*:/.test(after)) entry.hasJsResolvers = true;
    if (/lambdaResolvers\s*:/.test(after)) entry.hasLambdaResolvers = true;
    result.constructs.facade.push(entry);
  }

  // Orchestration: new Orchestration(this, 'Id', { triggers: [...] })
  for (const m of src.matchAll(/new\s+Orchestration\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const entry = { id: m[1], triggers: [] };
    const after = src.slice(m.index);
    const trMatch = after.match(/triggers\s*:\s*\[([\s\S]*?)\]/);
    if (trMatch) {
      entry.triggers = [...trMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
      // Also try extracting enum references like BrokerCtrlInboundEventTypes.ORDER_SUBMITTED
      if (entry.triggers.length === 0) {
        entry.triggers = [...trMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]);
      }
    }
    result.constructs.orchestration.push(entry);
  }

  // AgentRuntime
  for (const m of src.matchAll(/new\s+AgentRuntime\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    const entry = { id: m[1], hasToolTargets: false };
    const after = src.slice(m.index, m.index + 800);
    if (/toolTargets\s*:/.test(after)) entry.hasToolTargets = true;
    result.constructs.agentRuntime.push(entry);
  }

  // KnowledgeBase
  for (const m of src.matchAll(/new\s+KnowledgeBase\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.constructs.knowledgeBase.push({ id: m[1] });
  }

  // AgentCore Memory (agentcore.Memory)
  result.constructs.agentMemory = [];
  for (const m of src.matchAll(/new\s+agentcore\.Memory\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.constructs.agentMemory.push({ id: m[1] });
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add stack parser for high-level CDK constructs"
```

---

## Task 3: Stack Parser — Raw CDK Resources

**Files:**
- Modify: `tools/generate-c4-sources.mjs`
- Modify: `test/tools/generate-c4-sources.test.mjs`

Detect raw CDK resources used by hubs, cross-domain adapters, and investor-web (services that don't use high-level constructs).

- [ ] **Step 1: Write failing tests for raw resource detection**

```js
describe('parseStack — raw resources', () => {
  it('detects EventBus creation (hub pattern)', () => {
    const src = `this.bus = new EventBus(this, 'InvestorBus', { eventBusName: name });`;
    const result = parseStack(src);
    assert.equal(result.raw.eventBuses.length, 1);
    assert.equal(result.raw.eventBuses[0].id, 'InvestorBus');
  });

  it('detects Archive (hub pattern)', () => {
    const src = `new Archive(this, 'Archive', { sourceEventBus: this.bus, retention: Duration.days(365) });`;
    const result = parseStack(src);
    assert.equal(result.raw.archives.length, 1);
  });

  it('detects cross-domain rules with EventBusTarget', () => {
    const src = `
      new Rule(this, 'ToAdvisory', {
        eventBus: investorBus,
        eventPattern: { detailType: ['GOAL_UPDATED', 'RISK_PROFILE_UPDATED'] },
        targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
      });
    `;
    const result = parseStack(src);
    assert.equal(result.raw.rules.length, 1);
    assert.equal(result.raw.rules[0].id, 'ToAdvisory');
    assert.ok(result.raw.rules[0].isCrossDomain);
  });

  it('detects resolveBusArn calls (adapter bus references)', () => {
    const src = `
      const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
      const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    `;
    const result = parseStack(src);
    assert.deepEqual(result.raw.resolvedBuses, ['advisory', 'execution']);
  });

  it('detects resolveBusArn with multiline calls and this.prefix', () => {
    const src = `
      const advisoryBusArn = resolveBusArn(
        this,
        'AdvisoryBus',
        this.prefix,
        'advisory',
        domainAccounts,
      );
    `;
    const result = parseStack(src);
    assert.deepEqual(result.raw.resolvedBuses, ['advisory']);
  });

  it('detects UserPool (web pattern)', () => {
    const src = `const userPool = new UserPool(this, 'UserPool', { userPoolName: 'pool' });`;
    const result = parseStack(src);
    assert.equal(result.raw.userPools.length, 1);
  });

  it('detects Distribution (web pattern)', () => {
    const src = `const dist = new Distribution(this, 'Distribution', {});`;
    const result = parseStack(src);
    assert.equal(result.raw.distributions.length, 1);
  });

  it('detects standalone NodejsFunction', () => {
    const src = `
      const routeOrderFn = new NodejsFunction(this, 'RouteOrderFn', {
        entry: join(__dirname, 'handlers', 'route-order.ts'),
      });
    `;
    const result = parseStack(src);
    assert.equal(result.raw.lambdas.length, 1);
    assert.equal(result.raw.lambdas[0].id, 'RouteOrderFn');
  });

  it('detects AdapterSchedule', () => {
    const src = `new AdapterSchedule(this, 'FetchSchedule', { target: fetchTrigger });`;
    const result = parseStack(src);
    assert.equal(result.raw.schedules.length, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement raw resource detection in parseStack()**

Add these regex detections after the construct detection block in `parseStack()`:

```js
  // --- Raw CDK resources (for hubs, adapters, web) ---

  // EventBus creation
  for (const m of src.matchAll(/new\s+EventBus\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.eventBuses.push({ id: m[1] });
  }

  // Archive
  for (const m of src.matchAll(/new\s+Archive\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.archives.push({ id: m[1] });
  }

  // Cross-domain rules (Rule with EventBusTarget)
  for (const m of src.matchAll(/new\s+Rule\s*\(\s*this\s*,\s*['"](\w+)['"]\s*,/g)) {
    const after = src.slice(m.index, m.index + 600);
    const isCrossDomain = /EventBusTarget/.test(after);
    const eventTypes = [];
    const dtMatch = after.match(/detailType\s*:\s*\[([\s\S]*?)\]/);
    if (dtMatch) {
      eventTypes.push(...[...dtMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]));
      // Also try enum references
      if (eventTypes.length === 0) {
        eventTypes.push(...[...dtMatch[1].matchAll(/\.(\w+)/g)].map(x => x[1]));
      }
    }
    // Detect target bus variable name
    const targetMatch = after.match(/new\s+EventBusTarget\s*\(\s*(\w+)/);
    result.raw.rules.push({
      id: m[1],
      isCrossDomain,
      eventTypes,
      targetBusVar: targetMatch?.[1] || null,
    });
  }

  // resolveBusArn calls — extract domain name
  // Handles multiline calls and this.prefix (e.g. advisory-adpt, ledger-adpt)
  result.raw.resolvedBuses = [];
  for (const m of src.matchAll(/resolveBusArn\s*\([\s\S]*?['"](\w+)['"]\s*,\s*\w+\s*\)/gs)) {
    result.raw.resolvedBuses.push(m[1]);
  }

  // UserPool
  for (const m of src.matchAll(/new\s+UserPool\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.userPools.push({ id: m[1] });
  }

  // Distribution (CloudFront)
  for (const m of src.matchAll(/new\s+Distribution\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.distributions.push({ id: m[1] });
  }

  // Standalone NodejsFunction (outside of constructs — detected by variable assignment)
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*new\s+NodejsFunction\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.lambdas.push({ id: m[2], varName: m[1] });
  }

  // Bucket (standalone, outside State)
  for (const m of src.matchAll(/(?:const|let)\s+\w+\s*=\s*new\s+Bucket\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.buckets.push({ id: m[1] });
  }

  // AdapterSchedule
  for (const m of src.matchAll(/new\s+AdapterSchedule\s*\(\s*this\s*,\s*['"](\w+)['"]/g)) {
    result.raw.schedules.push({ id: m[1] });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add raw CDK resource detection to stack parser"
```

---

## Task 4: C3 D2 Generator — Standard Constructs

**Files:**
- Modify: `tools/generate-c4-sources.mjs`
- Modify: `test/tools/generate-c4-sources.test.mjs`

Generate C3 D2 content for services that use high-level constructs (State, Ingress, Egress, Facade, Orchestration, AgentRuntime, KnowledgeBase).

- [ ] **Step 1: Write failing test for generateC3()**

```js
describe('generateC3', () => {
  it('generates State group with DynamoDB + stream', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [], egress: [], facade: [], orchestration: [],
        agentRuntime: [], knowledgeBase: [], agentMemory: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('investor-ctrl', 'investor', parsed);
    assert.ok(d2.includes('state: "State"'));
    assert.ok(d2.includes('class: aws-dynamodb'));
    assert.ok(d2.includes('class: aws-ddb-stream'));
    assert.ok(d2.includes('table -> stream'));
  });

  it('generates Ingress group with EB Rule + SQS + Lambda + DLQ', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [{ id: 'Ingress', eventTypes: ['EVT_A', 'EVT_B'] }],
        egress: [], facade: [], orchestration: [],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('investor-ctrl', 'investor', parsed);
    assert.ok(d2.includes('ingress: "Ingress"'));
    assert.ok(d2.includes('class: aws-eventbridge'));
    assert.ok(d2.includes('class: aws-sqs'));
    assert.ok(d2.includes('class: aws-lambda'));
    assert.ok(d2.includes('class: aws-dlq'));
    assert.ok(d2.includes('2 events'));
  });

  it('generates multiple Ingress groups with unique names', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [
          { id: 'ModeIngress', eventTypes: ['MODE_CHANGED'] },
          { id: 'CallbackIngress', eventTypes: ['FILLED', 'REJECTED'] },
        ],
        egress: [], facade: [], orchestration: [],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('broker-ctrl', 'execution', parsed);
    assert.ok(d2.includes('mode-ingress: "ModeIngress"'));
    assert.ok(d2.includes('callback-ingress: "CallbackIngress"'));
  });

  it('generates Facade group with AppSync', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [],
        egress: [],
        facade: [{ id: 'Facade', hasJsResolvers: true, hasLambdaResolvers: false }],
        orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('investor-bff', 'investor', parsed);
    assert.ok(d2.includes('facade: "Facade"'));
    assert.ok(d2.includes('class: aws-appsync'));
    assert.ok(d2.includes('class: aws-ssm'));
  });

  it('generates Orchestration group with Step Functions', () => {
    const parsed = {
      constructs: {
        state: [{ id: 'State', withBucket: false, withTable: true }],
        ingress: [], egress: [],  facade: [],
        orchestration: [{ id: 'OrderStateMachine', triggers: ['ORDER_SUBMITTED'] }],
        agentRuntime: [], knowledgeBase: [], agentMemory: [],
      },
      raw: { eventBuses: [], archives: [], rules: [], lambdas: [],
             buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] },
    };
    const d2 = generateC3('broker-ctrl', 'execution', parsed);
    assert.ok(d2.includes('order-state-machine: "Orchestration"'));
    assert.ok(d2.includes('class: aws-stepfunctions'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement generateC3()**

The function takes `(serviceName, domain, parsedStack)` and returns a D2 string. Key logic:

```js
/**
 * Generate C3 D2 content for a single service.
 * @param {string} service - Service name (e.g. 'investor-ctrl')
 * @param {string} domain - Domain name (e.g. 'investor')
 * @param {object} parsed - Output of parseStack()
 * @returns {string} D2 source
 */
export function generateC3(service, domain, parsed) {
  const lines = [];
  const c = parsed.constructs;
  const r = parsed.raw;

  // Determine direction based on service type
  const isAdapter = r.rules.some(rule => rule.isCrossDomain);
  lines.push(`direction: ${isAdapter ? 'right' : 'down'}`);
  lines.push('');

  // Title
  lines.push(`title: "${service}" {`);
  lines.push('  style: { font-size: 40; bold: true; fill: transparent; stroke: transparent }');
  lines.push('}');
  lines.push('');

  // --- High-level constructs ---

  // Facade
  for (const f of c.facade) {
    lines.push(...facadeBlock(f));
  }

  // Ingress(es)
  for (const ing of c.ingress) {
    const blockId = c.ingress.length === 1 ? 'ingress' : toD2Id(ing.id);
    lines.push(...ingressBlock(blockId, ing));
  }

  // State
  for (const st of c.state) {
    lines.push(...stateBlock(st));
  }

  // Egress
  for (const eg of c.egress) {
    lines.push(...egressBlock(eg, domain));
  }

  // Orchestration
  for (const orch of c.orchestration) {
    const blockId = c.orchestration.length === 1 ? 'orchestration' : toD2Id(orch.id);
    lines.push(...orchestrationBlock(blockId, orch));
  }

  // AgentRuntime
  for (const ar of c.agentRuntime) {
    lines.push(...agentRuntimeBlock(ar));
  }

  // KnowledgeBase
  for (const kb of c.knowledgeBase) {
    lines.push(...knowledgeBaseBlock(kb));
  }

  // AgentCore Memory
  for (const mem of c.agentMemory) {
    lines.push(...agentMemoryBlock(mem));
  }

  // --- Raw resources (hub, adapter, web) ---
  // (Implemented in Task 5)

  // --- Flows ---
  lines.push('# Flows');
  lines.push(...generateC3Flows(c, r, domain));

  return lines.join('\n');
}
```

Helper functions for each construct block:

```js
const COLORS = {
  facade:        { fill: '#F3E5F5', stroke: '#9C27B0' },
  ingress:       { fill: '#FFF8E1', stroke: '#FFC107' },
  state:         { fill: '#E3F2FD', stroke: '#2196F3' },
  egress:        { fill: '#FBE9E7', stroke: '#FF5722' },
  orchestration: { fill: '#E8F5E9', stroke: '#4CAF50' },
  agentRuntime:  { fill: '#E8F5E9', stroke: '#4CAF50' },
  knowledgeBase: { fill: '#FFF3E0', stroke: '#FF9800' },
  agentMemory:   { fill: '#E0F2F1', stroke: '#00695C' },
};

function groupStyle(type) {
  const c = COLORS[type];
  return `  style: { fill: "${c.fill}"; stroke: "${c.stroke}"; border-radius: 12; font-size: 28 }`;
}

function toD2Id(id) {
  // PascalCase/camelCase → kebab-case
  return id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function stateBlock(st) {
  const lines = ['state: "State" {', groupStyle('state')];
  if (st.withTable !== false) {
    lines.push('  table: "DynamoDB Table" { class: aws-dynamodb }');
    lines.push('  stream: "DynamoDB Stream\\n[CDC]" { class: aws-ddb-stream }');
    lines.push('  table -> stream');
  }
  if (st.withBucket) {
    lines.push('  bucket: "S3 Bucket" { class: aws-s3 }');
  }
  lines.push('}', '');
  return lines;
}

function ingressBlock(blockId, ing) {
  const evtLabel = ing.eventTypes.length > 0 ? `\\n[${ing.eventTypes.length} events]` : '';
  const lines = [
    `${blockId}: "Ingress" {`,
    groupStyle('ingress'),
    `  rule: "EventBridge Rule${evtLabel}" { class: aws-eventbridge }`,
    '  sqs: "SQS Queue" { class: aws-sqs }',
    '  dlq: "DLQ" { class: aws-dlq }',
    '  handler: "Lambda" { class: aws-lambda }',
    '',
    '  rule -> sqs -> handler',
    '  sqs -> dlq',
    '}',
    '',
  ];
  return lines;
}

function egressBlock(eg, domain) {
  return [
    'egress: "Egress" {',
    groupStyle('egress'),
    '  processor: "Lambda" { class: aws-lambda }',
    `  bus: "EventBridge\\n[${domain}-bus]" { class: aws-eventbridge }`,
    '  dlq: "DLQ" { class: aws-dlq }',
    '',
    '  processor -> bus',
    '}',
    '',
  ];
}

function facadeBlock(f) {
  const lines = [
    'facade: "Facade" {',
    groupStyle('facade'),
    '  appsync: "AppSync API" { class: aws-appsync }',
  ];
  if (f.hasJsResolvers) {
    lines.push('  resolvers: "JS Resolvers" { class: aws-lambda }');
    lines.push('  appsync -> resolvers');
  }
  lines.push('  ssm: "SSM Parameters" { class: aws-ssm }');
  lines.push('}', '');
  return lines;
}

function orchestrationBlock(blockId, orch) {
  return [
    `${blockId}: "Orchestration" {`,
    groupStyle('orchestration'),
    `  state-machine: "Step Functions\\n[${orch.id}]" { class: aws-stepfunctions }`,
    '  dlq: "DLQ" { class: aws-dlq }',
    '}',
    '',
  ];
}

function agentRuntimeBlock(ar) {
  const lines = [
    'agent-runtime: "AgentRuntime" {',
    groupStyle('agentRuntime'),
    '  runtime: "Bedrock AgentCore" { class: aws-bedrock }',
  ];
  if (ar.hasToolTargets) {
    lines.push('  gateway: "MCP Gateway" { class: aws-lambda }');
    lines.push('  runtime -> gateway');
  }
  lines.push('}', '');
  return lines;
}

function knowledgeBaseBlock(kb) {
  return [
    'knowledge-base: "KnowledgeBase" {',
    groupStyle('knowledgeBase'),
    '  kb: "Bedrock Knowledge Base" { class: aws-bedrock }',
    '  s3: "S3 Bucket" { class: aws-s3 }',
    '  s3 -> kb',
    '}',
    '',
  ];
}

function agentMemoryBlock(mem) {
  return [
    'agent-memory: "AgentCore Memory" {',
    groupStyle('agentMemory'),
    '  memory: "Bedrock AgentCore\\n[Memory]" { class: aws-bedrock }',
    '}',
    '',
  ];
}

function generateC3Flows(c, r, domain) {
  const flows = [];
  const hasState = c.state.length > 0 && c.state[0].withTable !== false;

  // Facade → State
  if (c.facade.length > 0 && hasState) {
    flows.push('facade.resolvers -> state.table');
  }

  // Ingress → State
  for (const ing of c.ingress) {
    const blockId = c.ingress.length === 1 ? 'ingress' : toD2Id(ing.id);
    if (hasState) {
      flows.push(`${blockId}.handler -> state.table`);
    }
  }

  // State.stream → Egress
  if (hasState && c.egress.length > 0) {
    flows.push('state.stream -> egress.processor');
  }

  // Ingress → Orchestration (start execution)
  for (const orch of c.orchestration) {
    const orchId = c.orchestration.length === 1 ? 'orchestration' : toD2Id(orch.id);
    // First ingress triggers orchestration
    if (c.ingress.length > 0) {
      const ingId = c.ingress.length === 1 ? 'ingress' : toD2Id(c.ingress[0].id);
      flows.push(`${ingId}.handler -> ${orchId}.state-machine`);
    }
    // Orchestration → State
    if (hasState) {
      flows.push(`${orchId}.state-machine -> state.table`);
    }
  }

  // AgentMemory → Orchestration flow
  if (c.agentMemory.length > 0 && c.orchestration.length > 0) {
    const orchId = c.orchestration.length === 1 ? 'orchestration' : toD2Id(c.orchestration[0].id);
    flows.push(`${orchId}.state-machine -> agent-memory.memory`);
  }

  // AgentRuntime flows
  if (c.agentRuntime.length > 0) {
    if (c.facade.length > 0) {
      flows.push('facade.appsync -> agent-runtime.runtime');
    }
    if (c.knowledgeBase.length > 0) {
      flows.push('agent-runtime.runtime -> knowledge-base.kb');
    }
    if (hasState) {
      flows.push('agent-runtime.runtime -> state.table');
    }
  }

  return flows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add C3 D2 generator for high-level constructs"
```

---

## Task 5: C3 D2 Generator — Raw Resources (Hub, Adapter, Web)

**Files:**
- Modify: `tools/generate-c4-sources.mjs`
- Modify: `test/tools/generate-c4-sources.test.mjs`

- [ ] **Step 1: Write failing tests for raw resource C3 generation**

```js
describe('generateC3 — raw resources', () => {
  it('generates hub pattern (EventBus + Archive)', () => {
    const parsed = {
      constructs: { state: [], ingress: [], egress: [], facade: [],
                    orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] },
      raw: {
        eventBuses: [{ id: 'InvestorBus' }],
        archives: [{ id: 'Archive' }],
        rules: [], lambdas: [], buckets: [], userPools: [],
        distributions: [], schedules: [], resolvedBuses: [],
      },
    };
    const d2 = generateC3('investor-hub', 'investor', parsed);
    assert.ok(d2.includes('class: aws-eventbridge'));
    assert.ok(d2.includes('class: aws-s3'));
    assert.ok(d2.includes('archive'));
  });

  it('generates cross-domain adapter pattern', () => {
    const parsed = {
      constructs: { state: [], ingress: [], egress: [], facade: [],
                    orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] },
      raw: {
        eventBuses: [],
        archives: [],
        rules: [
          { id: 'ToAdvisory', isCrossDomain: true, eventTypes: [], targetBusVar: 'advisoryBus' },
          { id: 'ToExecution', isCrossDomain: true, eventTypes: [], targetBusVar: 'executionBus' },
        ],
        lambdas: [], buckets: [], userPools: [],
        distributions: [], schedules: [],
        resolvedBuses: ['investor', 'advisory', 'execution'],
      },
    };
    const d2 = generateC3('investor-adpt', 'investor', parsed);
    // Should have source bus, rules, and target buses
    assert.ok(d2.includes('source'));
    assert.ok(d2.includes('to-advisory'));
    assert.ok(d2.includes('to-execution'));
  });

  it('generates web frontend pattern (Cognito + S3 + CloudFront)', () => {
    const parsed = {
      constructs: { state: [], ingress: [], egress: [], facade: [],
                    orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] },
      raw: {
        eventBuses: [],
        archives: [],
        rules: [],
        lambdas: [{ id: 'PostConfirmation', varName: 'postConfirmation' }],
        buckets: [{ id: 'AssetsBucket' }],
        userPools: [{ id: 'UserPool' }],
        distributions: [{ id: 'Distribution' }],
        schedules: [], resolvedBuses: [],
      },
    };
    const d2 = generateC3('investor-web', 'investor', parsed);
    assert.ok(d2.includes('class: aws-cognito'));
    assert.ok(d2.includes('class: aws-s3'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement raw resource C3 generation**

Add to `generateC3()` after the high-level construct blocks:

```js
  // --- Raw resources (no wrapper box) ---

  // Hub pattern: EventBus + Archive
  if (r.eventBuses.length > 0) {
    for (const bus of r.eventBuses) {
      const busId = toD2Id(bus.id);
      lines.push(`${busId}: "EventBridge\\n[${domain}-bus]" { class: aws-eventbridge }`);
    }
    for (const arch of r.archives) {
      lines.push(`archive: "Event Archive\\n[365 days]" { class: aws-s3 }`);
    }
    if (r.eventBuses.length > 0 && r.archives.length > 0) {
      const busId = toD2Id(r.eventBuses[0].id);
      lines.push(`${busId} -> archive`);
    }
    lines.push('');
  }

  // Cross-domain adapter pattern
  const crossDomainRules = r.rules.filter(rule => rule.isCrossDomain);
  if (crossDomainRules.length > 0) {
    // Source bus — infer from the service's own domain
    lines.push(`source: "${domain}-bus\\n[Source]" { class: aws-eventbridge }`);
    lines.push('');
    for (const rule of crossDomainRules) {
      const ruleId = toD2Id(rule.id);
      // Infer target domain from variable name (e.g. advisoryBus → advisory)
      const targetDomain = rule.targetBusVar?.replace(/Bus$/, '') || 'target';
      lines.push(`${ruleId}: "${targetDomain}-bus\\n[Target]" { class: aws-eventbridge }`);
      lines.push(`${ruleId}-dlq: "DLQ" { class: aws-dlq }`);
      lines.push(`source -> ${ruleId}`);
      lines.push('');
    }
  }

  // Web frontend pattern
  if (r.userPools.length > 0) {
    lines.push('cognito: "Cognito UserPool" { class: aws-cognito }');
  }
  if (r.distributions.length > 0) {
    lines.push('cdn: "CloudFront" { class: aws-cloudfront }');
  }
  if (r.buckets.length > 0 && c.state.length === 0) {
    // Only show standalone buckets (not State buckets)
    lines.push('assets: "S3 Bucket" { class: aws-s3 }');
  }
  // Standalone lambdas (not inside constructs)
  for (const fn of r.lambdas) {
    lines.push(`${toD2Id(fn.id)}: "Lambda\\n[${fn.id}]" { class: aws-lambda }`);
  }
  if (r.userPools.length > 0 || r.distributions.length > 0 || r.lambdas.length > 0) {
    lines.push('');
    // Web flows
    if (r.distributions.length > 0 && r.buckets.length > 0) {
      lines.push('cdn -> assets');
    }
    if (r.userPools.length > 0 && r.lambdas.length > 0) {
      for (const fn of r.lambdas) {
        lines.push(`cognito -> ${toD2Id(fn.id)}`);
      }
    }
  }

  // Data adapter: schedule
  if (r.schedules.length > 0) {
    lines.push('schedule: "EventBridge Scheduler" { class: aws-eventbridge }');
    // Find the trigger lambda (usually the standalone lambda)
    if (r.lambdas.length > 0) {
      lines.push(`schedule -> ${toD2Id(r.lambdas[0].id)}`);
    }
    lines.push('');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add C3 generator for hub, adapter, and web patterns"
```

---

## Task 6: C2 D2 Generator

**Files:**
- Modify: `tools/generate-c4-sources.mjs`
- Modify: `test/tools/generate-c4-sources.test.mjs`

Generate C2 (container-level) D2 layer for each domain.

- [ ] **Step 1: Write failing test for generateC2()**

```js
describe('generateC2', () => {
  it('generates domain container with services and bus', () => {
    const services = [
      { service: 'investor-ctrl', domain: 'investor' },
      { service: 'investor-bff', domain: 'investor' },
      { service: 'investor-hub', domain: 'investor' },
      { service: 'investor-adpt', domain: 'investor' },
    ];
    const parsedStacks = new Map([
      ['investor-ctrl', { constructs: { state: [{ id: 'State' }], ingress: [{}], egress: [{}], facade: [], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [], archives: [], rules: [], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] } }],
      ['investor-bff', { constructs: { state: [{ id: 'State' }], ingress: [], egress: [], facade: [{ id: 'Facade' }], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [], archives: [], rules: [], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] } }],
      ['investor-hub', { constructs: { state: [], ingress: [], egress: [], facade: [], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [{ id: 'InvestorBus' }], archives: [{}], rules: [], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: [] } }],
      ['investor-adpt', { constructs: { state: [], ingress: [], egress: [], facade: [], orchestration: [], agentRuntime: [], knowledgeBase: [], agentMemory: [] }, raw: { eventBuses: [], archives: [], rules: [{ isCrossDomain: true }], lambdas: [], buckets: [], userPools: [], distributions: [], schedules: [], resolvedBuses: ['advisory'] } }],
    ]);
    const d2 = generateC2('investor', services, parsedStacks);
    // Has title
    assert.ok(d2.includes('Investor Domain'));
    // Has services with correct classes
    assert.ok(d2.includes('investor-ctrl'));
    assert.ok(d2.includes('class: service'));
    // Has bus
    assert.ok(d2.includes('investor-bus'));
    assert.ok(d2.includes('class: bus'));
    // Has adapter with adapter class
    assert.ok(d2.includes('investor-adpt'));
    assert.ok(d2.includes('class: adapter'));
    // Has links to C3 layers
    assert.ok(d2.includes('link: layers.c3-investor-ctrl'));
    // Has layer imports
    assert.ok(d2.includes('...@./c3/investor-ctrl.d2'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement generateC2()**

```js
/**
 * Generate C2 D2 layer for a domain.
 * @param {string} domain - Domain name
 * @param {Array} services - Services in this domain
 * @param {Map} parsedStacks - Map of serviceName → parsed stack
 * @returns {string} D2 layer content
 */
export function generateC2(domain, services, parsedStacks) {
  const lines = [];
  const title = domain.charAt(0).toUpperCase() + domain.slice(1);

  lines.push(`  c2-${domain}: {`);
  lines.push('    direction: down');
  lines.push('');
  lines.push(`    title: "${title} Domain" {`);
  lines.push('      style: { font-size: 42; bold: true; fill: transparent; stroke: transparent }');
  lines.push('    }');
  lines.push('');

  // Classify services
  const hubs = [];
  const adapters = [];
  const frontends = [];
  const regular = [];

  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;

    const isHub = parsed.raw.eventBuses.length > 0;
    const isCrossDomainAdapter = parsed.raw.rules.some(r => r.isCrossDomain);
    const isDataAdapter = parsed.raw.schedules.length > 0 || (svc.service.endsWith('-adpt') && parsed.constructs.state.length > 0);
    const isFrontend = parsed.raw.distributions.length > 0 || svc.service.endsWith('-web');

    if (isHub) hubs.push(svc);
    else if (isCrossDomainAdapter) adapters.push(svc);
    else if (isDataAdapter) adapters.push(svc);  // Data adapters rendered as adapters at C2
    else if (isFrontend) frontends.push(svc);
    else regular.push(svc);
  }

  // Frontends
  for (const svc of frontends) {
    lines.push(`    ${svc.service}: "${svc.service}" {`);
    lines.push('      class: frontend');
    lines.push(`      link: layers.c3-${svc.service}`);
    lines.push('    }');
    lines.push('');
  }

  // Regular services (ctrl, bff, data adapters)
  for (const svc of regular) {
    lines.push(`    ${svc.service}: "${svc.service}" {`);
    lines.push('      class: service');
    lines.push(`      link: layers.c3-${svc.service}`);
    lines.push('    }');
    lines.push('');
  }

  // Domain bus
  lines.push(`    ${domain}-bus: "${domain}-bus\\n[EventBridge]" {class: bus}`);
  lines.push('');

  // Hub
  for (const svc of hubs) {
    lines.push(`    ${svc.service}: "${svc.service}" {`);
    lines.push('      class: service');
    lines.push(`      link: layers.c3-${svc.service}`);
    lines.push('    }');
    lines.push('');
  }

  // Adapter
  for (const svc of adapters) {
    lines.push(`    ${svc.service}: "${svc.service}" {`);
    lines.push('      class: adapter');
    lines.push(`      link: layers.c3-${svc.service}`);
    lines.push('    }');
    lines.push('');
    // Target buses (cross-domain) — show all targets
    const parsed = parsedStacks.get(svc.service);
    if (parsed) {
      for (const targetDomain of parsed.raw.resolvedBuses) {
        if (targetDomain !== domain) {
          lines.push(`    ${targetDomain}-bus: "${targetDomain}-bus\\n[EventBridge]" {class: bus}`);
          lines.push('');
        }
      }
    }
  }

  // Flows: vertical chain
  // BFF/ctrl → bus → hub, bus → adpt → target bus
  for (const svc of regular) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    const hasEgress = parsed.constructs.egress.length > 0;
    if (hasEgress) {
      lines.push(`    ${svc.service} -> ${domain}-bus`);
    }
  }
  for (const svc of hubs) {
    lines.push(`    ${domain}-bus -> ${svc.service}`);
  }
  for (const svc of adapters) {
    lines.push(`    ${domain}-bus -> ${svc.service}`);
    const parsed = parsedStacks.get(svc.service);
    if (parsed) {
      for (const targetDomain of parsed.raw.resolvedBuses) {
        if (targetDomain !== domain) {
          lines.push(`    ${svc.service} -> ${targetDomain}-bus`);
        }
      }
    }
  }

  lines.push('');

  // Layer imports
  lines.push('    layers: {');
  for (const svc of services) {
    lines.push(`      c3-${svc.service}: { ...@./c3/${svc.service}.d2 }`);
  }
  lines.push('    }');
  lines.push('  }');

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add C2 D2 generator for domain container views"
```

---

## Task 7: C1 D2 Generator + Global Styles

**Files:**
- Modify: `tools/generate-c4-sources.mjs`
- Modify: `test/tools/generate-c4-sources.test.mjs`

Generate C1 system context and the full `nestfolio.d2` root document.

- [ ] **Step 1: Write failing tests for generateC1() and generateRoot()**

```js
describe('generateC1', () => {
  it('generates system context with 4 domains', () => {
    const domains = ['investor', 'advisory', 'execution', 'ledger'];
    const d2 = generateC1(domains);
    assert.ok(d2.includes('nestfolio:'));
    assert.ok(d2.includes('investor-domain'));
    assert.ok(d2.includes('advisory-domain'));
    assert.ok(d2.includes('execution-domain'));
    assert.ok(d2.includes('ledger-domain'));
    assert.ok(d2.includes('link: layers.c2-investor'));
  });

  it('generates inter-domain event flows', () => {
    const domains = ['investor', 'advisory', 'execution', 'ledger'];
    const d2 = generateC1(domains);
    assert.ok(d2.includes('investor-domain -> advisory-domain'));
    assert.ok(d2.includes('advisory-domain -> execution-domain'));
    assert.ok(d2.includes('execution-domain -> ledger-domain'));
    assert.ok(d2.includes('ledger-domain -> investor-domain'));
  });
});

describe('generateGlobalStyles', () => {
  it('includes all C1/C2 and AWS resource classes', () => {
    const d2 = generateGlobalStyles();
    assert.ok(d2.includes('person:'));
    assert.ok(d2.includes('system:'));
    assert.ok(d2.includes('domain:'));
    assert.ok(d2.includes('service:'));
    assert.ok(d2.includes('adapter:'));
    assert.ok(d2.includes('bus:'));
    assert.ok(d2.includes('aws-lambda:'));
    assert.ok(d2.includes('aws-dynamodb:'));
    assert.ok(d2.includes('aws-stepfunctions:'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement generateGlobalStyles() and generateC1()**

`generateGlobalStyles()` outputs the static D2 classes block — copy the exact class definitions from the current `nestfolio.d2` lines 1-251 (direction, style, classes). This is a static template string.

`generateC1()` takes the list of domains and generates:
- 4 domain nodes inside `nestfolio` system boundary, each with `link: layers.c2-{domain}`
- `investor-web` frontend node
- Inter-domain event flow edges (circular: investor → advisory → execution → ledger → investor)
- External system nodes inferred from adapter service names

```js
const DOMAIN_FLOW = [
  ['investor', 'advisory'],
  ['advisory', 'execution'],
  ['execution', 'ledger'],
  ['ledger', 'investor'],
];

export function generateC1(domains) {
  const lines = [];

  lines.push('# Nestfolio System Boundary');
  lines.push('nestfolio: "Nestfolio" {');
  lines.push('  class: system');
  lines.push('');

  for (const d of domains) {
    const title = d.charAt(0).toUpperCase() + d.slice(1);
    lines.push(`  ${d}-domain: "${title} Domain" {`);
    lines.push('    class: domain');
    lines.push(`    link: layers.c2-${d}`);
    lines.push('  }');
  }

  lines.push('');
  lines.push('  investor-web: "investor-web\\n[Angular PWA]" {class: frontend}');
  lines.push('');

  // Internal flows
  lines.push('  investor-web -> investor-domain {style.font-size: 28}');
  for (const [from, to] of DOMAIN_FLOW) {
    lines.push(`  ${from}-domain -> ${to}-domain {style.stroke: "#999999"; style.font-size: 28}`);
  }
  lines.push('}');

  return lines.join('\n');
}

export function generateGlobalStyles() {
  // Static template — exact copy of class definitions from current nestfolio.d2
  return `# Nestfolio C4 Architecture — Interactive Layers
# Generated by tools/generate-c4-sources.mjs — DO NOT EDIT
# Navigation: C1 → click domain → C2 → click service → C3 (AWS resources)

direction: down

style: {
  font-size: 34
  stroke-width: 2
}

classes: {
  person: {
    shape: person
    style: {
      fill: "#08427B"
      stroke: "#052E56"
      font-color: "#ffffff"
      font-size: 30
      stroke-width: 2
    }
  }
  system: {
    shape: rectangle
    style: {
      fill: "#D6E4F0"
      stroke: "#1168BD"
      font-color: "#0B4884"
      font-size: 30
      border-radius: 12
      stroke-width: 2
      shadow: true
    }
  }
  external: {
    shape: rectangle
    style: {
      fill: "#8B8B8B"
      stroke: "#666666"
      font-color: "#ffffff"
      font-size: 26
      border-radius: 10
      stroke-width: 1
      stroke-dash: 5
    }
  }
  domain: {
    shape: rectangle
    style: {
      fill: "#438DD5"
      stroke: "#2E6295"
      font-color: "#ffffff"
      font-size: 34
      bold: true
      border-radius: 14
      stroke-width: 3
      shadow: true
    }
  }
  service: {
    shape: rectangle
    style: {
      fill: "#85BBF0"
      stroke: "#4A90D9"
      font-color: "#1A1A1A"
      font-size: 26
      border-radius: 10
      stroke-width: 2
    }
  }
  adapter: {
    shape: hexagon
    style: {
      fill: "#FFB74D"
      stroke: "#E09530"
      font-color: "#1A1A1A"
      font-size: 26
      stroke-width: 2
    }
  }
  frontend: {
    shape: rectangle
    style: {
      fill: "#81C784"
      stroke: "#4CAF50"
      font-color: "#ffffff"
      font-size: 26
      border-radius: 12
      stroke-width: 2
    }
  }
  bus: {
    shape: queue
    style: {
      fill: "#FF7043"
      stroke: "#D84315"
      font-color: "#ffffff"
      font-size: 24
      stroke-width: 2
    }
  }

  # --- AWS Resource Classes (C3) ---
  aws-lambda: {
    shape: rectangle
    icon: ./icons/lambda.svg
    style: { fill: "#FFF3E0"; stroke: "#FF9800"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-dynamodb: {
    shape: rectangle
    icon: ./icons/dynamodb.svg
    style: { fill: "#E3F2FD"; stroke: "#1565C0"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-sqs: {
    shape: rectangle
    icon: ./icons/sqs.svg
    style: { fill: "#FFF3E0"; stroke: "#E65100"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-eventbridge: {
    shape: rectangle
    icon: ./icons/eventbridge.svg
    style: { fill: "#FCE4EC"; stroke: "#C62828"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-appsync: {
    shape: rectangle
    icon: ./icons/appsync.svg
    style: { fill: "#F3E5F5"; stroke: "#7B1FA2"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-stepfunctions: {
    shape: rectangle
    icon: ./icons/stepfunctions.svg
    style: { fill: "#FCE4EC"; stroke: "#AD1457"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-s3: {
    shape: rectangle
    icon: ./icons/s3.svg
    style: { fill: "#E8F5E9"; stroke: "#2E7D32"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-ssm: {
    shape: rectangle
    icon: ./icons/ssm.svg
    style: { fill: "#E3F2FD"; stroke: "#1565C0"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-cloudwatch: {
    shape: rectangle
    icon: ./icons/cloudwatch.svg
    style: { fill: "#FCE4EC"; stroke: "#C62828"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-bedrock: {
    shape: rectangle
    icon: ./icons/bedrock.svg
    style: { fill: "#E0F2F1"; stroke: "#00695C"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-cognito: {
    shape: rectangle
    icon: ./icons/cognito.svg
    style: { fill: "#FBE9E7"; stroke: "#BF360C"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
  aws-ddb-stream: {
    shape: parallelogram
    style: { fill: "#E3F2FD"; stroke: "#1565C0"; font-size: 24; stroke-width: 2 }
  }
  aws-dlq: {
    shape: rectangle
    icon: ./icons/sqs.svg
    style: { fill: "#FFCDD2"; stroke: "#B71C1C"; font-size: 22; border-radius: 8; stroke-width: 2; stroke-dash: 4 }
  }
  aws-cloudfront: {
    shape: rectangle
    icon: ./icons/cloudfront.svg
    style: { fill: "#F3E5F5"; stroke: "#7B1FA2"; font-size: 24; border-radius: 8; stroke-width: 2 }
  }
}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/generate-c4-sources.mjs test/tools/generate-c4-sources.test.mjs
git commit -m "feat(tools): add C1 generator and global styles template"
```

---

## Task 8: Assembly + File Writer

**Files:**
- Modify: `tools/generate-c4-sources.mjs`

Wire everything together: discover → parse → generate → write files. This is the `main()` function.

- [ ] **Step 1: Implement main() function**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ARCH_DIR = join(ROOT, 'docs', 'architecture');
const D2_SOURCE = join(ARCH_DIR, 'nestfolio.d2');
const C3_DIR = join(ARCH_DIR, 'c3');

function main() {
  console.log('Generating C4 D2 sources from CDK stacks...');

  // 1. Discover
  const services = discoverServices();
  console.log(`  found: ${services.length} services in ${[...new Set(services.map(s => s.domain))].length} domains`);

  // 2. Parse all stacks
  const parsedStacks = new Map();
  for (const svc of services) {
    const src = readFileSync(svc.stackPath, 'utf-8');
    parsedStacks.set(svc.service, parseStack(src));
  }
  console.log(`  parsed: ${parsedStacks.size} service stacks`);

  // 3. Generate C3 files
  mkdirSync(C3_DIR, { recursive: true });
  let c3Count = 0;
  for (const svc of services) {
    const parsed = parsedStacks.get(svc.service);
    if (!parsed) continue;
    const d2 = generateC3(svc.service, svc.domain, parsed);
    writeFileSync(join(C3_DIR, `${svc.service}.d2`), d2 + '\n');
    c3Count++;
  }
  console.log(`  wrote: ${c3Count} C3 files to ${C3_DIR}/`);

  // 4. Generate root nestfolio.d2
  const domains = [...new Set(services.map(s => s.domain))].sort();
  const domainServices = new Map();
  for (const d of domains) {
    domainServices.set(d, services.filter(s => s.domain === d));
  }

  const parts = [
    generateGlobalStyles(),
    '',
    '# ===========================================================================',
    '# LAYER: C1 — System Context',
    '# ===========================================================================',
    '',
    generateC1(domains),
    '',
    '# ===========================================================================',
    '# LAYERS',
    '# ===========================================================================',
    'layers: {',
    '',
  ];

  for (const d of domains) {
    parts.push('  # =========================================================================');
    parts.push(`  # C2 — ${d.charAt(0).toUpperCase() + d.slice(1)} Domain`);
    parts.push('  # =========================================================================');
    parts.push(generateC2(d, domainServices.get(d), parsedStacks));
    parts.push('');
  }

  parts.push('}');

  writeFileSync(D2_SOURCE, parts.join('\n') + '\n');
  console.log(`  wrote: ${D2_SOURCE}`);
  console.log('Done. Run `node tools/generate-c4-diagrams.mjs` to compile SVGs.');
}

// Run if invoked directly
const isMain = process.argv[1] && new URL(process.argv[1], 'file://').pathname
  === new URL(import.meta.url).pathname;
if (isMain) main();
```

- [ ] **Step 2: Run the script**

Run: `node tools/generate-c4-sources.mjs`
Expected: Console output showing services found, parsed, C3 files written, root file written.

- [ ] **Step 3: Verify generated files**

Run: `ls docs/architecture/c3/*.d2 | wc -l` — should show 33 files
Run: `head -20 docs/architecture/nestfolio.d2` — should show generated header
Run: `head -20 docs/architecture/c3/investor-ctrl.d2` — should show State + Ingress + Egress

- [ ] **Step 4: Commit**

```bash
git add tools/generate-c4-sources.mjs
git commit -m "feat(tools): add main() assembler for generate-c4-sources"
```

---

## Task 9: Add CloudFront Icon

**Files:**
- Create: `docs/architecture/icons/cloudfront.svg`

The investor-web C3 diagram needs a CloudFront icon. Download or create a minimal AWS CloudFront SVG icon.

- [ ] **Step 1: Download CloudFront icon**

Find the official AWS Architecture icon for CloudFront and save as `docs/architecture/icons/cloudfront.svg`. Can source from the aws-icons package or similar.

- [ ] **Step 2: Verify icon renders**

Run: `ls -la docs/architecture/icons/cloudfront.svg` — should exist with reasonable size

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/icons/cloudfront.svg
git commit -m "feat(tools): add CloudFront SVG icon for C3 diagrams"
```

---

## Task 10: End-to-End Integration Test

**Files:**
- Modify: `test/tools/generate-c4-sources.test.mjs`

- [ ] **Step 1: Run the full pipeline**

```bash
node tools/generate-c4-sources.mjs && node tools/generate-c4-diagrams.mjs
```

Expected: Both scripts succeed, SVGs are generated.

- [ ] **Step 2: Verify SVG output**

```bash
ls docs/architecture/nestfolio/index.svg
ls docs/architecture/nestfolio/c2-investor/c3-dashboard-bff.svg
```

- [ ] **Step 3: Visual spot-check**

Open `docs/architecture/nestfolio/index.svg` in browser — verify C1 shows 4 domains.
Open a C3 SVG — verify constructs are rendered with correct colored boxes and AWS icons.

- [ ] **Step 4: Add integration test**

```js
describe('integration', () => {
  it('generates valid D2 that compiles without errors', () => {
    // Run generate-c4-sources
    const services = discoverServices();
    const parsedStacks = new Map();
    for (const svc of services) {
      parsedStacks.set(svc.service, parseStack(readFileSync(svc.stackPath, 'utf-8')));
    }
    // Verify all services were parsed
    assert.equal(parsedStacks.size, services.length);

    // Verify dashboard-bff now has State (the bug that started this)
    const dashboardBff = parsedStacks.get('dashboard-bff');
    assert.ok(dashboardBff);
    assert.equal(dashboardBff.constructs.state.length, 1);

    // Generate C3 for a few key services and verify structure
    const investorCtrl = generateC3('investor-ctrl', 'investor', parsedStacks.get('investor-ctrl'));
    assert.ok(investorCtrl.includes('state: "State"'));
    assert.ok(investorCtrl.includes('ingress: "Ingress"'));
    assert.ok(investorCtrl.includes('egress: "Egress"'));

    const brokerCtrl = generateC3('broker-ctrl', 'execution', parsedStacks.get('broker-ctrl'));
    assert.ok(brokerCtrl.includes('state: "State"'));
    assert.ok(brokerCtrl.includes('orchestration') || brokerCtrl.includes('order-state-machine'));

    const investorHub = generateC3('investor-hub', 'investor', parsedStacks.get('investor-hub'));
    assert.ok(investorHub.includes('class: aws-eventbridge'));
    assert.ok(!investorHub.includes('state: "State"')); // Hubs have no state

    const investorAdpt = generateC3('investor-adpt', 'investor', parsedStacks.get('investor-adpt'));
    assert.ok(investorAdpt.includes('source'));
    assert.ok(!investorAdpt.includes('state: "State"')); // Adapters have no state
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `node --test test/tools/generate-c4-sources.test.mjs`
Expected: All tests pass.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(tools): complete generate-c4-sources with integration tests"
```
