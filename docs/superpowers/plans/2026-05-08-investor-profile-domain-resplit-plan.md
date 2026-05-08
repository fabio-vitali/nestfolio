# InvestorProfile Domain Resplit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-split Mandate as a sibling aggregate, relocate the GUARDRAIL_TABLE policy into compliance-ctrl, and introduce a 3-tier event topology (carrier + semantic + lifecycle) via a new declarative `onFieldChange` extension to `libs/cdk-constructs`. Eliminates the architectural class of bug surfaced by the missing-`updateOperatingMode` gap.

**Architecture:** Five phases, all on a single feature branch in a worktree, single deploy at the end. Phase 1 is the foundational lib extension (TDD on the lib first). Phase 2 wires the producer (investor-bff). Phase 3 relocates policy ownership (compliance-ctrl). Phase 4 aligns downstream consumers (investor-ctrl, dashboard-bff, adapters, decision-workflow-ctrl). Phase 5 rewrites E2Es, updates docs, deploys, and runs the validation gate.

**Tech Stack:** TypeScript · AWS CDK · Lambda · DynamoDB Streams · EventBridge · AppSync (JS resolvers) · Jest · `@nestfolio/event-processor` · `@nestfolio/cdk-constructs` · `@nestfolio/event-types` · `@nestfolio/integration-testing` · `@nestfolio/test-support`

**Spec:** `docs/superpowers/specs/2026-05-08-investor-profile-domain-resplit-design.md`
**Backlog:** `docs/backlog/investor-profile-domain-resplit.md` (status=active)

---

## Worktree setup

- [ ] **Step 0.1: Create worktree on a feature branch**

Run:
```bash
git worktree add -b feat/investor-profile-domain-resplit \
  /Users/fabiovitali/WebstormProjects/nestfolio/.worktrees/investor-profile-domain-resplit \
  main
cd /Users/fabiovitali/WebstormProjects/nestfolio/.worktrees/investor-profile-domain-resplit
```

Expected: `Preparing worktree (new branch 'feat/investor-profile-domain-resplit')` followed by `HEAD is now at 55001fed docs(backlog): file ci-pipeline-bring-up …`.

- [ ] **Step 0.2: Install deps for the worktree**

Run:
```bash
pnpm install --frozen-lockfile
```

Expected: `Done in <…>s`. No lockfile changes.

---

## Phase 1 — `libs/cdk-constructs` `onFieldChange` foundation

The lib extension lands first and is independently testable. No service-side change yet.

### Task 1.1: Extend `EventTypesMap` types with `ModifyEmission`

**Files:**
- Modify: `libs/cdk-constructs/src/core/event-types.ts`
- Test: `libs/cdk-constructs/test/core/event-types.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/core/event-types.test.ts`:

```ts
import { buildRuntimeConfig, collectAllEventTypes, extractFilters } from '../../src/core/event-types';
import type { EventTypesMap } from '../../src/core/event-types';
import { eventName } from '@nestfolio/event-types';

describe('onFieldChange ModifyEmission', () => {
  const map: EventTypesMap = {
    InvestorProfile: {
      insert: eventName('INVESTOR_PROFILE_CREATED'),
      modify: {
        always: eventName('INVESTOR_PROFILE_UPDATED'),
        onFieldChange: {
          operatingMode: eventName('OPERATING_MODE_CHANGED'),
          goal: eventName('GOAL_UPDATED'),
        },
      },
    },
  };

  it('flattens onFieldChange into the runtime config under MODIFY action', () => {
    const config = buildRuntimeConfig(map);
    expect(config['InvestorProfile:MODIFY']).toEqual({
      always: 'INVESTOR_PROFILE_UPDATED',
      onFieldChange: {
        operatingMode: 'OPERATING_MODE_CHANGED',
        goal: 'GOAL_UPDATED',
      },
    });
    expect(config['InvestorProfile:INSERT']).toBe('INVESTOR_PROFILE_CREATED');
  });

  it('collectAllEventTypes returns carrier + every semantic event', () => {
    const types = collectAllEventTypes(map);
    expect(types).toEqual(expect.arrayContaining([
      'INVESTOR_PROFILE_CREATED',
      'INVESTOR_PROFILE_UPDATED',
      'OPERATING_MODE_CHANGED',
      'GOAL_UPDATED',
    ]));
    expect(types).toHaveLength(4);
  });

  it('extractFilters emits one MODIFY filter per record-type even with onFieldChange', () => {
    const filters = extractFilters(map);
    expect(filters).toEqual([
      { typeName: 'InvestorProfile', action: 'INSERT' },
      { typeName: 'InvestorProfile', action: 'MODIFY' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run cdk-constructs:test --testPathPatterns event-types`
Expected: FAIL — the new `ModifyEmission` shape isn't accepted by `EventTypesMap` yet (TS compile error or assertion mismatch).

- [ ] **Step 3: Extend the type definitions**

Replace lines 6-26 of `libs/cdk-constructs/src/core/event-types.ts` with:

```ts
// libs/cdk-constructs/src/core/event-types.ts
import type { EventName } from '@nestfolio/event-types';

// ── Type definitions ──────────────────────────────────────────────

export type FieldDispatch = {
  field: string;
  map: Record<string, EventName>;
  default?: EventName;
};

export type Passthrough = {
  field: string;
  passthrough: true;
  emits: EventName[];
};

/**
 * Modify-action emission with optional producer-side field-diff fan-out.
 * `always` fires on any modify; `onFieldChange` fires additional semantic
 * events when specific fields differ between OldImage and NewImage.
 */
export type ModifyEmission = {
  always: EventName;
  onFieldChange?: Record<string, EventName>;
};

export type ActionMapping = EventName | FieldDispatch | Passthrough | ModifyEmission;

export type RecordTypeConfig = {
  insert?: ActionMapping;
  modify?: ActionMapping;
  remove?: ActionMapping;
};

export type EventTypesMap = Record<string, RecordTypeConfig>;
```

- [ ] **Step 4: Extend the runtime config types**

Replace lines 28-42 of the same file with:

```ts
// ── Runtime config types (serialized to EVENT_TYPE_MAP env var) ──

export type RuntimeFieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

export type RuntimePassthrough = {
  field: string;
  passthrough: true;
};

export type RuntimeModifyEmission = {
  always: string;
  onFieldChange?: Record<string, string>;
};

export type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough | RuntimeModifyEmission;
export type RuntimeConfig = Record<string, RuntimeMapping>;
```

- [ ] **Step 5: Update `buildRuntimeConfig` to flatten ModifyEmission**

Replace `buildRuntimeConfig` (currently lines 50-71) with:

```ts
export function buildRuntimeConfig(eventTypes: EventTypesMap): RuntimeConfig {
  const config: RuntimeConfig = {};

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    for (const action of ['insert', 'modify', 'remove'] as const) {
      const mapping = recordConfig[action];
      if (!mapping) continue;
      const ddbAction = action.toUpperCase();
      if (typeof mapping === 'string') {
        config[`${recordType}:${ddbAction}`] = mapping;
      } else if ('passthrough' in mapping) {
        config[`${recordType}:${ddbAction}`] = { field: mapping.field, passthrough: true };
      } else if ('always' in mapping) {
        const entry: RuntimeModifyEmission = { always: mapping.always as string };
        if (mapping.onFieldChange) {
          entry.onFieldChange = mapping.onFieldChange as Record<string, string>;
        }
        config[`${recordType}:${ddbAction}`] = entry;
      } else {
        const entry: RuntimeFieldDispatch = { field: mapping.field, map: mapping.map as Record<string, string> };
        if (mapping.default) entry.default = mapping.default as string;
        config[`${recordType}:${ddbAction}`] = entry;
      }
    }
  }

  return config;
}
```

- [ ] **Step 6: Update `collectAllEventTypes` to include semantic events**

Replace `collectAllEventTypes` (currently lines 76-94) with:

```ts
export function collectAllEventTypes(eventTypes: EventTypesMap): EventName[] {
  const types: EventName[] = [];

  for (const recordConfig of Object.values(eventTypes)) {
    for (const mapping of [recordConfig.insert, recordConfig.modify, recordConfig.remove]) {
      if (!mapping) continue;
      if (typeof mapping === 'string') {
        types.push(mapping as EventName);
      } else if ('passthrough' in mapping) {
        types.push(...mapping.emits);
      } else if ('always' in mapping) {
        types.push(mapping.always);
        if (mapping.onFieldChange) {
          types.push(...Object.values(mapping.onFieldChange));
        }
      } else {
        types.push(...Object.values(mapping.map));
        if (mapping.default) types.push(mapping.default);
      }
    }
  }

  return [...new Set(types)] as EventName[];
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm nx run cdk-constructs:test --testPathPatterns event-types`
Expected: PASS — all `ModifyEmission` cases plus the existing `FieldDispatch`/`Passthrough` cases.

- [ ] **Step 8: Commit**

```bash
git add libs/cdk-constructs/src/core/event-types.ts libs/cdk-constructs/test/core/event-types.test.ts
git commit -m "feat(cdk-constructs): add ModifyEmission with onFieldChange"
```

### Task 1.2: Wire `onFieldChange` diff-emit in the CDC pipeline

**Files:**
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts`
- Test: `libs/event-processor/test/pipelines/change-data-capture.test.ts` (create if missing)

- [ ] **Step 1: Locate or create the test file**

Run: `ls libs/event-processor/test/pipelines/change-data-capture.test.ts 2>&1`

If missing, create it with the standard imports stub:

```ts
import { changeDataCapture } from '../../src/pipelines/change-data-capture';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ebMock = mockClient(EventBridgeClient);

describe('changeDataCapture — onFieldChange diff-emit', () => {
  beforeEach(() => {
    ebMock.reset();
    process.env.SERVICE_NAME = 'investor-bff';
    process.env.BUS_NAME = 'investor-bus';
    process.env.EVENT_TYPE_MAP = JSON.stringify({});
  });
});
```

- [ ] **Step 2: Write the failing test**

Append the four scenarios:

```ts
  it('emits carrier + matched semantic events when watched fields change', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'InvestorProfile:MODIFY': {
        always: 'INVESTOR_PROFILE_UPDATED',
        onFieldChange: { operatingMode: 'OPERATING_MODE_CHANGED', goal: 'GOAL_UPDATED' },
      },
    });
    ebMock.on(PutEventsCommand).resolves({ Entries: [{}, {}] });

    const handler = changeDataCapture();
    await handler({
      Records: [{
        eventName: 'MODIFY',
        eventID: 'r1',
        dynamodb: {
          NewImage: {
            pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'InvestorProfile' },
            __typename: { S: 'InvestorProfile' }, tenantId: { S: 't1' }, userId: { S: 'u1' }, region: { S: 'us-east-1' },
            operatingMode: { S: 'AGGRESSIVE' }, goal: { M: { objective: { S: 'RETIREMENT' } } },
          },
          OldImage: {
            pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'InvestorProfile' },
            __typename: { S: 'InvestorProfile' }, tenantId: { S: 't1' }, userId: { S: 'u1' }, region: { S: 'us-east-1' },
            operatingMode: { S: 'CONSERVATIVE' }, goal: { M: { objective: { S: 'RETIREMENT' } } },
          },
        },
      }] as any,
    });

    const calls = ebMock.commandCalls(PutEventsCommand);
    const entries = calls.flatMap(c => c.args[0].input.Entries ?? []);
    const types = entries.map(e => e.DetailType);
    expect(types).toEqual(expect.arrayContaining(['INVESTOR_PROFILE_UPDATED', 'OPERATING_MODE_CHANGED']));
    expect(types).not.toContain('GOAL_UPDATED');

    const semantic = entries.find(e => e.DetailType === 'OPERATING_MODE_CHANGED')!;
    const detail = JSON.parse(semantic.Detail!);
    expect(detail.subject.operatingMode).toBe('AGGRESSIVE');
    expect(detail.previousSubject.operatingMode).toBe('CONSERVATIVE');
  });

  it('emits only the carrier when no watched field changed', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'InvestorProfile:MODIFY': {
        always: 'INVESTOR_PROFILE_UPDATED',
        onFieldChange: { operatingMode: 'OPERATING_MODE_CHANGED' },
      },
    });
    ebMock.on(PutEventsCommand).resolves({ Entries: [{}] });

    const handler = changeDataCapture();
    await handler({
      Records: [{
        eventName: 'MODIFY',
        eventID: 'r1',
        dynamodb: {
          NewImage: {
            pk: { S: 'p' }, sk: { S: 's' }, __typename: { S: 'InvestorProfile' },
            tenantId: { S: 't' }, userId: { S: 'u' }, region: { S: 'r' },
            operatingMode: { S: 'BALANCED' }, email: { S: 'new@x' },
          },
          OldImage: {
            pk: { S: 'p' }, sk: { S: 's' }, __typename: { S: 'InvestorProfile' },
            tenantId: { S: 't' }, userId: { S: 'u' }, region: { S: 'r' },
            operatingMode: { S: 'BALANCED' }, email: { S: 'old@x' },
          },
        },
      }] as any,
    });
    const types = ebMock.commandCalls(PutEventsCommand)
      .flatMap(c => c.args[0].input.Entries ?? [])
      .map(e => e.DetailType);
    expect(types).toEqual(['INVESTOR_PROFILE_UPDATED']);
  });

  it('treats nested-object inequality as a change (deep equal)', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'InvestorProfile:MODIFY': {
        always: 'INVESTOR_PROFILE_UPDATED',
        onFieldChange: { goal: 'GOAL_UPDATED' },
      },
    });
    ebMock.on(PutEventsCommand).resolves({ Entries: [{}, {}] });

    const handler = changeDataCapture();
    await handler({
      Records: [{
        eventName: 'MODIFY',
        eventID: 'r1',
        dynamodb: {
          NewImage: {
            pk: { S: 'p' }, sk: { S: 's' }, __typename: { S: 'InvestorProfile' },
            tenantId: { S: 't' }, userId: { S: 'u' }, region: { S: 'r' },
            goal: { M: { objective: { S: 'RETIREMENT' }, timeHorizonMonths: { N: '240' } } },
          },
          OldImage: {
            pk: { S: 'p' }, sk: { S: 's' }, __typename: { S: 'InvestorProfile' },
            tenantId: { S: 't' }, userId: { S: 'u' }, region: { S: 'r' },
            goal: { M: { objective: { S: 'RETIREMENT' }, timeHorizonMonths: { N: '120' } } },
          },
        },
      }] as any,
    });
    const types = ebMock.commandCalls(PutEventsCommand)
      .flatMap(c => c.args[0].input.Entries ?? [])
      .map(e => e.DetailType);
    expect(types).toEqual(expect.arrayContaining(['INVESTOR_PROFILE_UPDATED', 'GOAL_UPDATED']));
  });

  it('falls back to "always-only" when OldImage is missing (defensive)', async () => {
    process.env.EVENT_TYPE_MAP = JSON.stringify({
      'InvestorProfile:MODIFY': {
        always: 'INVESTOR_PROFILE_UPDATED',
        onFieldChange: { operatingMode: 'OPERATING_MODE_CHANGED' },
      },
    });
    ebMock.on(PutEventsCommand).resolves({ Entries: [{}] });
    const handler = changeDataCapture();
    await handler({
      Records: [{
        eventName: 'MODIFY', eventID: 'r1',
        dynamodb: {
          NewImage: {
            pk: { S: 'p' }, sk: { S: 's' }, __typename: { S: 'InvestorProfile' },
            tenantId: { S: 't' }, userId: { S: 'u' }, region: { S: 'r' },
            operatingMode: { S: 'AGGRESSIVE' },
          },
        },
      }] as any,
    });
    const types = ebMock.commandCalls(PutEventsCommand)
      .flatMap(c => c.args[0].input.Entries ?? [])
      .map(e => e.DetailType);
    expect(types).toEqual(['INVESTOR_PROFILE_UPDATED']);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm nx run event-processor:test --testPathPatterns change-data-capture`
Expected: FAIL — current code doesn't recognize `ModifyEmission` runtime shape.

- [ ] **Step 4: Update `RuntimeMapping` types**

Replace lines 8-20 of `libs/event-processor/src/pipelines/change-data-capture.ts` with:

```ts
type RuntimeFieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

type RuntimePassthrough = {
  field: string;
  passthrough: true;
};

type RuntimeModifyEmission = {
  always: string;
  onFieldChange?: Record<string, string>;
};

type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough | RuntimeModifyEmission;
type RuntimeConfig = Record<string, RuntimeMapping>;
```

- [ ] **Step 5: Replace `resolveEventType` with a multi-emit resolver**

Replace `resolveEventType` (currently lines 32-58) with:

```ts
type Emission = { eventType: string; previousSubject?: Record<string, unknown> };

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const arrB = b as unknown[];
    if (a.length !== arrB.length) return false;
    return a.every((v, i) => deepEqual(v, arrB[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function resolveEmissions(
  record: StreamRecord,
  ctx: StreamContext,
  eventName: string,
  config: RuntimeConfig,
): Emission[] {
  const key = `${record.__typename}:${eventName}`;
  const mapping = config[key];
  if (!mapping) {
    throw new Error(`Event name resolution failed: unmapped CDC record ${key}`);
  }

  if (typeof mapping === 'string') return [{ eventType: mapping }];

  if ('passthrough' in mapping) {
    const raw = (record as Record<string, unknown>)[mapping.field] as string;
    if (!raw) {
      throw new Error(`Event name resolution failed: passthrough field "${mapping.field}" is falsy for ${record.__typename}`);
    }
    const idx = raw.indexOf('#');
    return [{ eventType: idx > 0 ? raw.slice(0, idx) : raw }];
  }

  if ('always' in mapping) {
    const emissions: Emission[] = [{ eventType: mapping.always }];
    if (mapping.onFieldChange && ctx.oldImage && ctx.newImage) {
      for (const [field, semanticType] of Object.entries(mapping.onFieldChange)) {
        const oldVal = ctx.oldImage[field];
        const newVal = ctx.newImage[field];
        if (!deepEqual(oldVal, newVal)) {
          emissions.push({ eventType: semanticType, previousSubject: ctx.oldImage });
        }
      }
    }
    return emissions;
  }

  // FieldDispatch
  const value = (record as Record<string, unknown>)[mapping.field] as string;
  const eventType = mapping.map[value] ?? mapping.default ?? null;
  return eventType ? [{ eventType }] : [];
}
```

- [ ] **Step 6: Update `buildEntry` to optionally include `previousSubject`**

Replace `buildEntry` (currently lines 60-92) with:

```ts
function buildEntry(
  record: StreamRecord,
  ctx: StreamContext,
  emission: Emission,
  busName: string,
  serviceName: string,
  transform?: ChangeDataCaptureConfig['transform'],
): PutEventsRequestEntry {
  const detail: Record<string, unknown> = {
    id: ctx.record.eventID ?? getUUID(),
    type: emission.eventType,
    timestamp: new Date().toISOString(),
    subject: transform ? transform(record, emission.eventType) : record,
    context: {
      tenantId: record.tenantId,
      userId: record.userId,
      region: record.region,
    },
  };
  if (emission.previousSubject) detail.previousSubject = emission.previousSubject;

  const isTestTenant = record.tenantId?.startsWith('integ-');
  const source = isTestTenant
    ? `integration-test:${serviceName}`
    : `${busName}@${serviceName}`;

  return {
    EventBusName: busName,
    Source: source,
    DetailType: emission.eventType,
    Detail: JSON.stringify(detail),
  };
}
```

- [ ] **Step 7: Update `processRecord` and `processGroup` to fan-out emissions**

Replace lines 102-119 with:

```ts
  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const emissions = resolveEmissions(record, ctx, record.eventName, runtimeConfig);
    if (emissions.length === 0) return;
    const entries = emissions.map(em => buildEntry(record, ctx, em, busName, serviceName, config.transform));
    await publisher.publish(entries);
  };

  const processGroup = async (_groupKey: string, records: StreamRecord[], ctx: StreamContext): Promise<void> => {
    const entries: PutEventsRequestEntry[] = [];
    for (const record of records) {
      const emissions = resolveEmissions(record, ctx, record.eventName, runtimeConfig);
      for (const em of emissions) {
        entries.push(buildEntry(record, ctx, em, busName, serviceName, config.transform));
      }
    }
    if (entries.length > 0) {
      await publisher.publish(entries);
    }
  };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm nx run event-processor:test --testPathPatterns change-data-capture`
Expected: PASS — all four scenarios.

- [ ] **Step 9: Run the full event-processor suite to confirm no regression**

Run: `pnpm nx run event-processor:test`
Expected: PASS — preserved behavior for `FieldDispatch`, `Passthrough`, plain string mappings.

- [ ] **Step 10: Commit**

```bash
git add libs/event-processor/src/pipelines/change-data-capture.ts libs/event-processor/test/pipelines/change-data-capture.test.ts
git commit -m "feat(event-processor): emit semantic events on field change with previousSubject"
```

### Task 1.3: Update Egress construct subscription wiring

The Egress construct synthesizes the EVENT_TYPE_MAP env var via `buildRuntimeConfig`. With the type extension already in place, no source change is needed beyond a regression test.

**Files:**
- Test: `libs/cdk-constructs/test/core/egress.test.ts`

- [ ] **Step 1: Add a regression test asserting the runtime config shape**

Append to `libs/cdk-constructs/test/core/egress.test.ts`:

```ts
import { Match, Template } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { Egress } from '../../src/core/egress';
import { State } from '../../src/core/state';
import { eventName } from '@nestfolio/event-types';

describe('Egress — onFieldChange runtime config wiring', () => {
  it('serializes ModifyEmission with onFieldChange to EVENT_TYPE_MAP env', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const state = new State(stack, 'State', { tableProps: { partitionKey: { name: 'pk', type: 'STRING' as any } } });
    new Egress(stack, 'Egress', {
      state,
      eventTypes: {
        InvestorProfile: {
          insert: eventName('INVESTOR_PROFILE_CREATED'),
          modify: {
            always: eventName('INVESTOR_PROFILE_UPDATED'),
            onFieldChange: {
              operatingMode: eventName('OPERATING_MODE_CHANGED'),
              goal: eventName('GOAL_UPDATED'),
            },
          },
        },
      },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          EVENT_TYPE_MAP: Match.serializedJson(Match.objectLike({
            'InvestorProfile:MODIFY': {
              always: 'INVESTOR_PROFILE_UPDATED',
              onFieldChange: {
                operatingMode: 'OPERATING_MODE_CHANGED',
                goal: 'GOAL_UPDATED',
              },
            },
            'InvestorProfile:INSERT': 'INVESTOR_PROFILE_CREATED',
          })),
        }),
      },
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm nx run cdk-constructs:test --testPathPatterns egress`
Expected: PASS — the construct already calls `buildRuntimeConfig` so no code change needed; this guards against future regressions.

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/test/core/egress.test.ts
git commit -m "test(cdk-constructs): cover onFieldChange in EVENT_TYPE_MAP synth"
```

### Task 1.4: Phase 1 gate — run full lib test suites

- [ ] **Step 1: Run cdk-constructs + event-processor**

Run: `pnpm nx run-many -t test --projects=cdk-constructs,event-processor`
Expected: PASS — all unit tests across both libs.

---

## Phase 2 — `investor-bff` producer

### Task 2.1: Add new event names

**Files:**
- Modify: `services/investor/investor-bff/src/domain/events.ts`

- [ ] **Step 1: Read the current events file**

Run: `cat services/investor/investor-bff/src/domain/events.ts | head -40`

- [ ] **Step 2: Add the new event names + rename MANDATE_ACCEPTED**

In `services/investor/investor-bff/src/domain/events.ts`:
- Replace `MANDATE_ACCEPTED: eventName('MANDATE_ACCEPTED'),` with `MANDATE_ISSUED: eventName('MANDATE_ISSUED'),`
- Add new entries inside the `InvestorBffEventTypes` literal:
  ```ts
  OPERATING_MODE_CHANGED: eventName('OPERATING_MODE_CHANGED'),
  GOAL_UPDATED: eventName('GOAL_UPDATED'),
  ```

- [ ] **Step 3: Search for all `MANDATE_ACCEPTED` references workspace-wide**

Run: `grep -rln "MANDATE_ACCEPTED" --include="*.ts" --include="*.js" --include="*.md" --include="*.yaml" 2>&1 | grep -v node_modules | grep -v ".worktrees"`

Expected: a list across investor-bff, investor-ctrl, advisory-adpt, dashboard-bff, decision-workflow-ctrl, e2e tests, and docs.

- [ ] **Step 4: Rename via sed across the codebase**

Run:
```bash
git grep -l 'MANDATE_ACCEPTED' | xargs sed -i '' 's/MANDATE_ACCEPTED/MANDATE_ISSUED/g'
```

Note: the docs and historical specs/plans get this rename too — that's fine; they're going to be updated in Phase 5 anyway.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm nx run-many -t typecheck --projects=investor-bff,investor-ctrl,advisory-adpt,dashboard-bff,decision-workflow-ctrl,investor-adpt,compliance-ctrl`

Expected: PASS or only failures from the *new* event types not yet being added to consumers' lookup maps. Consumers wired in Phase 3 + 4.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(events): rename MANDATE_ACCEPTED → MANDATE_ISSUED, add OPERATING_MODE_CHANGED + GOAL_UPDATED"
```

### Task 2.2: Update domain models — slim `Mandate`, add separate aggregate

**Files:**
- Modify: `services/investor/investor-bff/src/domain/models.ts`

- [ ] **Step 1: Inspect current Mandate type**

Run: `grep -n -A 12 'interface Mandate\|type Mandate ' services/investor/investor-bff/src/domain/models.ts`

- [ ] **Step 2: Replace the Mandate type and add a separate row interface**

In `services/investor/investor-bff/src/domain/models.ts`, replace the `Mandate` definition with:

```ts
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
export type MandateStatusValue = 'ACTIVE' | 'REVOKED';

/** Authority grant — sibling row at sk='Mandate'. Lifecycle only, no policy fields. */
export interface Mandate {
  readonly mandateId: string;
  readonly level: MandateLevel;
  readonly status: MandateStatusValue;
  readonly effectiveDate: string;
  readonly revokedAt: string | null;
}
```

- [ ] **Step 3: Update InvestorProfile to drop nested mandate guardrails**

In the same file, find the `InvestorProfile` interface and replace its `mandate: { … }` block with:

```ts
  readonly mandateLevel: MandateLevel;
  readonly mandateId: string;
```

(Mirrored fields for read-side ergonomics — the source of truth is the Mandate row, written atomically by transforms.)

- [ ] **Step 4: Run typecheck to surface every consumer**

Run: `pnpm nx typecheck investor-bff 2>&1 | tail -30`

Expected: ~15-25 errors pointing to `mandate.maxSingleTradePercent` accesses across the package — these are the consumer sites that will be fixed in subsequent tasks (transforms, repositories, resolver tests).

- [ ] **Step 5: Commit (intentionally red)**

```bash
git add services/investor/investor-bff/src/domain/models.ts
git commit -m "refactor(investor-bff): slim Mandate to lifecycle-only, separate aggregate"
```

### Task 2.3: Delete `guardrail-params` from investor-bff

**Files:**
- Delete: `services/investor/investor-bff/src/domain/guardrail-params.ts`
- Delete: `services/investor/investor-bff/test/unit/domain/guardrail-params.test.ts`

- [ ] **Step 1: Capture the guardrail table contents for Phase 3**

Run: `cp services/investor/investor-bff/src/domain/guardrail-params.ts /tmp/guardrail-params-source.ts`

- [ ] **Step 2: Delete both files**

Run:
```bash
git rm services/investor/investor-bff/src/domain/guardrail-params.ts services/investor/investor-bff/test/unit/domain/guardrail-params.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(investor-bff): remove guardrail-params (relocating to compliance-ctrl)"
```

### Task 2.4: Rewrite `onboarding-completed` transform — drop guardrail expansion, write Mandate row

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`
- Modify: `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts`

- [ ] **Step 1: Update the failing test for the new write shape**

Replace the body of `onboarding-completed.test.ts` with:

```ts
import { onboardingCompleted } from '../../../src/transforms/onboarding-completed';
import { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

jest.mock('../../../src/repositories/investor-profile.repository');

describe('onboardingCompleted transform', () => {
  const baseSubject = {
    tenantId: 't1', userId: 'u1', email: 'u1@example.com',
    goal: { objective: 'RETIREMENT' }, horizonYears: 20,
    accountMode: 'simulation' as const, capitalAmount: 100000, currency: 'EUR',
    riskTolerance: 3, riskExperience: 2,
    operatingMode: 'BALANCED' as const, mandateAccepted: true as const,
  };
  const ctx = { region: 'us-east-1', tenantId: 't1', userId: 'u1', eventId: 'e1',
                eventType: 'ONBOARDING_COMPLETED', timestamp: '2026-05-08T00:00:00Z' };

  beforeEach(() => {
    (InvestorProfileRepository as jest.MockedClass<typeof InvestorProfileRepository>).prototype.transactWrite =
      jest.fn().mockResolvedValue(undefined);
    process.env.TABLE_NAME = 'test-table';
  });

  it('writes InvestorProfile row sans nested mandate guardrails', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const profile = items.find((i: any) => i.Put?.Item.sk === 'InvestorProfile').Put.Item;
    expect(profile.operatingMode).toBe('BALANCED');
    expect(profile.mandateLevel).toBe('DISCRETIONARY'); // tenantId 't1' lacks 'e2e-' prefix → default DISCRETIONARY
    expect(profile.mandate).toBeUndefined(); // numeric guardrails no longer nested
    expect(profile.mandateId).toEqual(expect.any(String));
  });

  it('writes a sibling Mandate row with status=ACTIVE and operatingMode denormalized', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate).toMatchObject({
      __typename: 'Mandate',
      tenantId: 't1', userId: 'u1',
      status: 'ACTIVE',
      revokedAt: null,
      level: 'DISCRETIONARY',
      operatingMode: 'BALANCED', // denormalized so MANDATE_ISSUED carries it for compliance projection
    });
    expect(mandate.mandateId).toEqual(expect.any(String));
  });

  it('does NOT write a MandateStatus row anymore', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    expect(items.find((i: any) => i.Put?.Item.sk === 'MandateStatus')).toBeUndefined();
  });

  it('writes Deposit when capitalAmount > 0', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    expect(items.some((i: any) => i.Put?.Item.__typename === 'Deposit')).toBe(true);
  });

  it('e2e- tenant defaults mandate level to ADVISORY', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, tenantId: 'e2e-foo' } } as any,
                              { ...ctx, tenantId: 'e2e-foo' } as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate.level).toBe('ADVISORY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns onboarding-completed`
Expected: FAIL — current transform writes the old shape.

- [ ] **Step 3: Replace the transform**

Replace the body of `services/investor/investor-bff/src/transforms/onboarding-completed.ts` with:

```ts
import { skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { computeRiskProfile } from '../domain/risk-profile.service';

interface OnboardingCompletedSubject {
  tenantId: string;
  userId: string;
  email: string;
  goal: { objective: string };
  horizonYears: number;
  accountMode: 'simulation' | 'live';
  capitalAmount: number;
  currency: string;
  riskTolerance: number;
  riskExperience: number;
  operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  mandateLevel?: 'ADVISORY' | 'DISCRETIONARY';
  mandateAccepted: true;
}

export async function onboardingCompleted(
  payload: EventPayload,
  ctx: EventContext,
): Promise<WriteIntent> {
  const s = payload.subject as unknown as OnboardingCompletedSubject;
  const tableName = process.env['TABLE_NAME']!;
  const repo = new InvestorProfileRepository(tableName);
  const now = getTime();
  const pk = `InvestorProfile#${s.tenantId}#${s.userId}`;
  const risk = computeRiskProfile(s.riskTolerance, s.riskExperience);
  const mandateId = getUUID();
  const depositId = getUUID();
  const mandateLevel =
    s.mandateLevel ?? (s.tenantId.startsWith('e2e-') ? 'ADVISORY' : 'DISCRETIONARY');

  await repo.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: {
            pk,
            sk: 'InvestorProfile',
            __typename: 'InvestorProfile',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            email: s.email,
            operatingMode: s.operatingMode,
            executionMode: 'simulation',
            accountMode: { mode: s.accountMode, capitalAmount: s.capitalAmount, currency: s.currency },
            goal: {
              objective: s.goal.objective,
              timeHorizonMonths: s.horizonYears * 12,
              targetAmountCents: 0,
              currency: s.currency,
              targetReturn: 0,
            },
            riskProfile: {
              score: risk.score,
              band: risk.band,
              toleranceResponse: risk.tolerance,
              experienceLevel: risk.experienceLevel,
            },
            mandateId,
            mandateLevel,
            onboardingCompletedAt: now,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            pk,
            sk: 'Mandate',
            __typename: 'Mandate',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            mandateId,
            level: mandateLevel,
            status: 'ACTIVE',
            operatingMode: s.operatingMode,
            effectiveDate: now,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
        },
      },
      ...(s.capitalAmount > 0
        ? [
            {
              Put: {
                TableName: tableName,
                Item: {
                  pk,
                  sk: `Deposit#${depositId}`,
                  __typename: 'Deposit',
                  tenantId: s.tenantId,
                  userId: s.userId,
                  region: ctx.region,
                  createdAt: now,
                  depositId,
                  amountCents: s.capitalAmount,
                  currency: s.currency,
                  status: 'INITIATED',
                  initiatedAt: now,
                  timestamp: now,
                } satisfies TableEntry,
              },
            },
          ]
        : []),
    ],
  });

  return skip();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns onboarding-completed`
Expected: PASS — all 5 assertions.

- [ ] **Step 5: Update sibling test file if it exists**

Run: `ls services/investor/investor-bff/test/unit/transforms/onboarding-completed-transform.test.ts 2>&1`

If the file exists, run `pnpm nx run investor-bff:test --testPathPatterns onboarding-completed-transform` and update assertions to match the new write shape (drop assertions on `mandate.maxSingleTradePercent` etc., add Mandate-row assertions). If the file is a near-duplicate of the one rewritten above, delete it: `git rm <path>`.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/transforms/onboarding-completed.ts services/investor/investor-bff/test/unit/transforms/onboarding-completed*.test.ts
git commit -m "refactor(investor-bff): onboarding writes lean InvestorProfile + sibling Mandate row"
```

### Task 2.5: Rewrite `InvestorProfileRepository` — Mandate row, drop MandateStatus

**Files:**
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
- Modify: `services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts`

- [ ] **Step 1: Read the current repo to understand existing methods**

Run: `grep -n 'readonly \|async \|class ' services/investor/investor-bff/src/repositories/investor-profile.repository.ts | head -30`

- [ ] **Step 2: Update the test file**

Replace the relevant `describe('setOperatingMode')` and any `MandateStatus` blocks in `services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts` with:

```ts
  describe('setOperatingMode', () => {
    it('updates operatingMode without touching mandate fields', async () => {
      const send = jest.fn().mockResolvedValue({});
      const repo = new InvestorProfileRepository('test-table');
      (repo as any).docClient = { send };
      await repo.setOperatingMode({ tenantId: 't1', userId: 'u1', region: 'us-east-1' } as any, 'AGGRESSIVE');
      const cmd = send.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toMatch(/SET operatingMode = :mode/);
      expect(cmd.input.UpdateExpression).not.toMatch(/mandate\./);
    });
  });

  describe('revokeMandate (Mandate row)', () => {
    it('writes status=REVOKED + revokedAt to sk=Mandate, conditional on status=ACTIVE', async () => {
      const send = jest.fn().mockResolvedValue({});
      const repo = new InvestorProfileRepository('test-table');
      (repo as any).docClient = { send };
      await repo.revokeMandate({ tenantId: 't1', userId: 'u1', region: 'us-east-1' } as any);
      const cmd = send.mock.calls[0][0];
      expect(cmd.input.Key.sk).toBe('Mandate');
      expect(cmd.input.UpdateExpression).toMatch(/SET #status = :revoked/);
      expect(cmd.input.ConditionExpression).toMatch(/#status = :active/);
    });
  });
```

Remove any `setMandateGuardrails` / `MandateStatus` repo tests.

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns investor-profile.repository`
Expected: FAIL — `revokeMandate` doesn't exist on the repo, `setOperatingMode` may still try to derive guardrails.

- [ ] **Step 4: Update the repository implementation**

In `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`:

- Remove any helper that derives or sets guardrail fields (e.g. `setMandateGuardrails`).
- Verify `setOperatingMode` (around line 182) writes only `operatingMode` + timestamps (no mandate.*).
- Add a new `revokeMandate` method (replaces any MandateStatus update path):

```ts
  readonly revokeMandate = this.log('revokeMandate',
    async (ctx: RequestContext): Promise<{ status: 'REVOKED'; revokedAt: string }> => {
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'Mandate' },
          UpdateExpression:
            'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
          ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':revoked': 'REVOKED', ':now': now, ':active': 'ACTIVE' },
          ConditionExpression: '#status = :active',
        }),
      );
      return { status: 'REVOKED', revokedAt: now };
    },
  );
```

- Remove any MandateStatus-row writers (search for `'MandateStatus'` in the file).

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns investor-profile.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/repositories/investor-profile.repository.ts services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts
git commit -m "refactor(investor-bff): repo writes Mandate row directly, drops MandateStatus"
```

### Task 2.6: GraphQL schema — drop guardrail fields, drop `updateMandate`, add `updateOperatingMode`, retarget `revokeMandate`

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`

- [ ] **Step 1: Apply the schema diff**

Edit `services/investor/investor-bff/src/schema.graphql`:

Replace the `Mutation` block (lines 9-21) with:
```graphql
type Mutation {
  updateGoal(input: GoalInput!): Goal!
  updateOperatingMode(mode: OperatingMode!): InvestorProfile!
  revokeMandate: Mandate!
  initiateDeposit(input: DepositInput!): Deposit!
  requestWithdrawal(input: WithdrawalInput!): WithdrawalRequest!
  requestAccountClosure: ClosureRequest!
  markNotificationRead(notificationId: ID!): Notification!
  updateFeatureFlag(name: String!, enabled: Boolean!, reason: String): FeatureFlag!
    @aws_iam
  publishDepositEvent(input: DepositEventInput!): DepositEvent!
    @aws_iam
}
```

Replace `type Mandate { … }` (lines 105-118) with:
```graphql
type Mandate {
  mandateId: ID!
  level: MandateLevel!
  status: MandateStatusValue!
  effectiveDate: String!
  revokedAt: String
}
```

Delete the `type MandateStatus { … }` block (lines 120-124).

Delete `input MandateInput` if it exists (search for `input MandateInput`).

- [ ] **Step 2: Verify schema parses**

Run: `pnpm nx run investor-bff:build 2>&1 | tail -10`
Expected: build succeeds (or fails only on resolver references that get fixed in the next tasks).

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/schema.graphql
git commit -m "refactor(investor-bff): schema — drop updateMandate, add updateOperatingMode, slim Mandate"
```

### Task 2.7: Delete `update-mandate.fn.js` + tests

**Files:**
- Delete: `services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js`
- Delete: `services/investor/investor-bff/test/unit/graphql/update-mandate.test.ts`

- [ ] **Step 1: Remove**

Run:
```bash
git rm services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js \
       services/investor/investor-bff/test/unit/graphql/update-mandate.test.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(investor-bff): remove updateMandate mutation + test"
```

### Task 2.8: Add `update-operating-mode.fn.js`

**Files:**
- Create: `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js`
- Create: `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts`:

```ts
import { request, response } from '../../../src/graphql/js-function/update-operating-mode.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1' },
  arguments: { mode: 'AGGRESSIVE' },
  result: { operatingMode: 'AGGRESSIVE', updatedAt: '2026-05-08T00:00:00Z' },
};

describe('updateOperatingMode resolver', () => {
  it('produces an UpdateItem on sk=InvestorProfile setting only operatingMode + timestamps', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('UpdateItem');
    expect(req.key.sk.S).toBe('InvestorProfile');
    expect(req.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(req.update.expression).toBe('SET operatingMode = :mode, updatedAt = :now, #ts = :now');
    expect(req.condition.expression).toBe('attribute_exists(pk)');
  });

  it('rejects an invalid mode', () => {
    expect(() => request({ ...baseCtx, arguments: { mode: 'YOLO' } } as any))
      .toThrow();
  });

  it('returns the updated profile from response handler', () => {
    expect(response(baseCtx as any)).toEqual(baseCtx.result);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns update-operating-mode`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the resolver**

Create `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js`:

```js
import { util } from '@aws-appsync/utils';

const VALID_MODES = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const mode = ctx.arguments.mode;
  if (!VALID_MODES.includes(mode)) {
    util.error(`Invalid operatingMode: ${mode}`, 'ValidationError');
  }
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'InvestorProfile',
    }),
    update: {
      expression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :now',
      expressionNames: { '#ts': 'timestamp' },
      expressionValues: util.dynamodb.toMapValues({ ':mode': mode, ':now': now }),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns update-operating-mode`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts
git commit -m "feat(investor-bff): add updateOperatingMode JS resolver"
```

### Task 2.9: Retarget `revoke-mandate.fn.js` to Mandate row

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js`
- Modify: `services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts`

- [ ] **Step 1: Update the test**

Replace the body of `services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts` with:

```ts
import { request, response } from '../../../src/graphql/js-function/revoke-mandate.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1' },
  arguments: {},
  result: { mandateId: 'm1', level: 'DISCRETIONARY', status: 'REVOKED', effectiveDate: '2026-05-08T00:00:00Z', revokedAt: '2026-05-08T00:00:01Z' },
};

describe('revokeMandate resolver', () => {
  it('targets sk=Mandate row, not MandateStatus', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('UpdateItem');
    expect(req.key.sk.S).toBe('Mandate');
    expect(req.update.expression).toMatch(/SET #status = :revoked/);
    expect(req.condition.expression).toMatch(/#status = :active/);
  });

  it('returns the full Mandate row from response', () => {
    expect(response(baseCtx as any)).toEqual(baseCtx.result);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns revoke-mandate`
Expected: FAIL — current resolver targets `sk='MandateStatus'`.

- [ ] **Step 3: Replace the resolver**

Replace the body of `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js` with:

```js
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'Mandate',
    }),
    update: {
      expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
      expressionNames: { '#status': 'status', '#ts': 'timestamp' },
      expressionValues: util.dynamodb.toMapValues({
        ':revoked': 'REVOKED',
        ':active': 'ACTIVE',
        ':now': now,
      }),
    },
    condition: {
      expression: 'attribute_exists(pk) AND #status = :active',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns revoke-mandate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts
git commit -m "refactor(investor-bff): revokeMandate writes to sk=Mandate row directly"
```

### Task 2.10: Convert `get-profile.fn.js` to a pipeline resolver

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/get-profile.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/get-profile-mandate.fn.js`
- Modify: `services/investor/investor-bff/test/unit/graphql/get-profile.test.ts`

- [ ] **Step 1: Read the current resolver**

Run: `cat services/investor/investor-bff/src/graphql/js-function/get-profile.fn.js`

Expected: a single Get on `sk='InvestorProfile'`.

- [ ] **Step 2: Inspect how the facade discovers pipeline resolvers**

Run: `grep -rn 'discoverJsResolvers\|preSteps\|pipeline' libs/cdk-constructs/src/core/facade.ts services/investor/investor-bff/src/service.stack.ts | head -10`

Expected: the facade auto-discovers JS functions; pipeline ordering is filename-driven (numeric prefix `get-profile.1.fn.js`, `get-profile.2.fn.js`, …) — confirm convention before writing files. If the convention is different, follow whatever the existing pipeline resolvers in the repo use.

- [ ] **Step 3: Update the test file**

Replace the body of `services/investor/investor-bff/test/unit/graphql/get-profile.test.ts` with:

```ts
import * as fn1 from '../../../src/graphql/js-function/get-profile.fn.js';
import * as fn2 from '../../../src/graphql/js-function/get-profile-mandate.fn.js';

describe('getProfile pipeline resolver', () => {
  const baseCtx = {
    stash: { tenantId: 't1', userId: 'u1' },
    prev: { result: { tenantId: 't1', userId: 'u1', email: 'u1@x', operatingMode: 'BALANCED', mandateId: 'm1', mandateLevel: 'DISCRETIONARY' } },
    result: { mandateId: 'm1', level: 'DISCRETIONARY', status: 'ACTIVE', effectiveDate: '2026-05-08T00:00:00Z', revokedAt: null },
  };

  it('function 1: gets the InvestorProfile row', () => {
    const req = fn1.request({ stash: { tenantId: 't1', userId: 'u1' } } as any);
    expect(req.operation).toBe('GetItem');
    expect(req.key.sk.S).toBe('InvestorProfile');
  });

  it('function 2: gets the Mandate row using the same pk', () => {
    const req = fn2.request(baseCtx as any);
    expect(req.operation).toBe('GetItem');
    expect(req.key.sk.S).toBe('Mandate');
    expect(req.key.pk.S).toBe('InvestorProfile#t1#u1');
  });

  it('function 2 response merges Mandate row into profile.mandate', () => {
    const merged = fn2.response(baseCtx as any);
    expect(merged.email).toBe('u1@x');
    expect(merged.mandate).toEqual({
      mandateId: 'm1', level: 'DISCRETIONARY', status: 'ACTIVE',
      effectiveDate: '2026-05-08T00:00:00Z', revokedAt: null,
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns get-profile`
Expected: FAIL — the second module doesn't exist yet.

- [ ] **Step 5: Update function 1 (`get-profile.fn.js`) to keep its current GetItem on InvestorProfile**

Verify current content of `services/investor/investor-bff/src/graphql/js-function/get-profile.fn.js` already does:

```js
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'InvestorProfile',
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('InvestorProfile not found', 'NotFound');
  return ctx.result;
}
```

If different, replace with the above.

- [ ] **Step 6: Create function 2 (`get-profile-mandate.fn.js`)**

Create `services/investor/investor-bff/src/graphql/js-function/get-profile-mandate.fn.js`:

```js
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'Mandate',
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const profile = ctx.prev.result;
  return { ...profile, mandate: ctx.result };
}
```

- [ ] **Step 7: Wire function 2 into the pipeline (consult facade discovery convention)**

If `discoverJsResolvers` uses filename ordering, rename function 1 to `get-profile.1.fn.js` and function 2 to `get-profile.2.fn.js`. If it uses an explicit pipeline declaration in the schema or service.stack.ts, add the entry. Use whatever convention the existing pipeline resolvers in this repo follow — search:

```bash
ls services/investor/investor-bff/src/graphql/js-function/
ls services/*/*-bff/src/graphql/js-function/ 2>/dev/null
```

If no precedent, declare the pipeline inline in `service.stack.ts` via the `Facade` construct's pipeline option (look for `preSteps` in `cdk-constructs/src/core/facade.ts`).

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns get-profile`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/get-profile*.fn.js services/investor/investor-bff/test/unit/graphql/get-profile.test.ts services/investor/investor-bff/src/service.stack.ts
git commit -m "refactor(investor-bff): getProfile pipeline merges Mandate row into profile.mandate"
```

### Task 2.11: Update `service.stack.ts` — eventTypes uses ModifyEmission, add Mandate row, drop MandateStatus

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`

- [ ] **Step 1: Edit the eventTypes map**

Replace lines 61-83 (the `eventTypes:` block) with:

```ts
      eventTypes: {
        'InvestorProfile': {
          insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
          modify: {
            always: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
            onFieldChange: {
              operatingMode: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
              goal: InvestorBffEventTypes.GOAL_UPDATED,
            },
          },
        },
        'Mandate': {
          insert: InvestorBffEventTypes.MANDATE_ISSUED,
          modify: InvestorBffEventTypes.MANDATE_REVOKED,
        },
        'Deposit': {
          insert: InvestorBffEventTypes.DEPOSIT_INITIATED,
          modify: InvestorBffEventTypes.DEPOSIT_UPDATED,
        },
        'Withdrawal': {
          insert: InvestorBffEventTypes.WITHDRAWAL_REQUESTED,
          modify: InvestorBffEventTypes.WITHDRAWAL_UPDATED,
        },
        'ExecutionModeChange': {
          insert: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
          modify: InvestorBffEventTypes.EXECUTION_MODE_CHANGE_UPDATED,
        },
        'Notification': { modify: InvestorBffEventTypes.NOTIFICATION_READ },
      },
```

- [ ] **Step 2: Verify the unit + synth tests still pass**

Run: `pnpm nx run investor-bff:test`
Expected: PASS — service-stack tests, transform tests, resolver tests.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts
git commit -m "feat(investor-bff): eventTypes — Mandate aggregate, onFieldChange semantic events"
```

### Task 2.12: Phase 2 gate — investor-bff full suite

- [ ] **Step 1: Run full test suite**

Run: `pnpm nx run investor-bff:test`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm nx run investor-bff:typecheck`
Expected: PASS.

- [ ] **Step 3: Run integration tests (still using old shape — expect failures, deferred to Phase 5)**

Run: `pnpm nx run investor-bff:test-integration 2>&1 | tail -30`
Expected: failures only on assertions about MandateStatus / mandate.* numeric fields. Note them; they are addressed in Phase 5 (integration test rewrites against deployed dev).

---

## Phase 3 — `compliance-ctrl` policy relocation

### Task 3.1: Move GUARDRAIL_TABLE into compliance-ctrl

**Files:**
- Create: `services/advisory/compliance-ctrl/src/rules/guardrail-params.ts`
- Create: `services/advisory/compliance-ctrl/test/unit/rules/guardrail-params.test.ts`

- [ ] **Step 1: Create the new file at the new home**

Copy `/tmp/guardrail-params-source.ts` (saved in Task 2.3) into the compliance-ctrl rules directory. Adjust the import path for `OperatingMode` / `RebalanceCadence`:

```ts
// services/advisory/compliance-ctrl/src/rules/guardrail-params.ts
import type { OperatingMode, RebalanceCadence } from './rule-engine';

export interface GuardrailParams {
  readonly maxSingleTradePercent: number;
  readonly monthlyTurnoverCapPercent: number;
  readonly coolDownDays: number;
  readonly rebalanceCadence: RebalanceCadence | 'BI_WEEKLY';
  readonly equityRiskBandPercent: number;
  readonly driftTriggerPercent: number;
  readonly singleEtfConcentrationPercent: number;
  readonly drawdownCircuitBreakerPercent: number;
}

const GUARDRAIL_TABLE: Record<OperatingMode, GuardrailParams> = {
  CONSERVATIVE: {
    maxSingleTradePercent: 5, monthlyTurnoverCapPercent: 10, coolDownDays: 10,
    rebalanceCadence: 'QUARTERLY', equityRiskBandPercent: 3, driftTriggerPercent: 2,
    singleEtfConcentrationPercent: 20, drawdownCircuitBreakerPercent: 8,
  },
  BALANCED: {
    maxSingleTradePercent: 10, monthlyTurnoverCapPercent: 25, coolDownDays: 5,
    rebalanceCadence: 'MONTHLY', equityRiskBandPercent: 6, driftTriggerPercent: 4,
    singleEtfConcentrationPercent: 30, drawdownCircuitBreakerPercent: 12,
  },
  AGGRESSIVE: {
    maxSingleTradePercent: 20, monthlyTurnoverCapPercent: 50, coolDownDays: 2,
    rebalanceCadence: 'BI_WEEKLY', equityRiskBandPercent: 10, driftTriggerPercent: 7,
    singleEtfConcentrationPercent: 40, drawdownCircuitBreakerPercent: 18,
  },
};

export function resolveGuardrailParams(mode: OperatingMode): GuardrailParams {
  return GUARDRAIL_TABLE[mode];
}
```

- [ ] **Step 2: Add a unit test**

Create `services/advisory/compliance-ctrl/test/unit/rules/guardrail-params.test.ts`:

```ts
import { resolveGuardrailParams } from '../../../src/rules/guardrail-params';

describe('resolveGuardrailParams', () => {
  it.each([
    ['CONSERVATIVE', 5, 10, 'QUARTERLY'],
    ['BALANCED', 10, 25, 'MONTHLY'],
    ['AGGRESSIVE', 20, 50, 'BI_WEEKLY'],
  ] as const)('mode %s → %d/%d/%s', (mode, singleTrade, turnover, cadence) => {
    const p = resolveGuardrailParams(mode);
    expect(p.maxSingleTradePercent).toBe(singleTrade);
    expect(p.monthlyTurnoverCapPercent).toBe(turnover);
    expect(p.rebalanceCadence).toBe(cadence);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm nx run compliance-ctrl:test --testPathPatterns guardrail-params`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/compliance-ctrl/src/rules/guardrail-params.ts services/advisory/compliance-ctrl/test/unit/rules/guardrail-params.test.ts
git commit -m "feat(compliance-ctrl): own GUARDRAIL_TABLE policy"
```

### Task 3.2: Update `MandateSnapshot` shape

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/rules/rule-engine.ts`

- [ ] **Step 1: Replace the MandateSnapshot interface**

In `services/advisory/compliance-ctrl/src/rules/rule-engine.ts` (around line 7), replace `interface MandateSnapshot` with:

```ts
export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type RebalanceCadence = 'MONTHLY' | 'QUARTERLY';
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';

export interface MandateSnapshot {
  level: MandateLevel;
  status: 'ACTIVE' | 'REVOKED';
  operatingMode: OperatingMode;
  effectiveDate: string;
}
```

- [ ] **Step 2: Surface compile errors**

Run: `pnpm nx run compliance-ctrl:typecheck 2>&1 | tail -30`
Expected: errors in guardrail-evaluator.ts, mandate-validator.ts, suitability-checker.ts, authority-resolver.ts, compliance.repository.ts, event-listener.ts (all sites that read the dropped fields).

- [ ] **Step 3: Commit (intentionally red)**

```bash
git add services/advisory/compliance-ctrl/src/rules/rule-engine.ts
git commit -m "refactor(compliance-ctrl): MandateSnapshot drops 8 numeric fields, adds operatingMode"
```

### Task 3.3: Rewrite GuardrailEvaluator to derive thresholds at eval time

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts`
- Modify: `services/advisory/compliance-ctrl/test/unit/guardrail-evaluator.test.ts`

- [ ] **Step 1: Update the test to reflect mode-aware behavior**

Read `services/advisory/compliance-ctrl/test/unit/guardrail-evaluator.test.ts` — replace assertions that read `snapshot.maxSingleTradePercent` (etc.) with `snapshot.operatingMode = 'CONSERVATIVE'` (etc.), and assert on the BLOCK/PASS outcome that the resolved policy implies.

Example change:
```ts
// BEFORE
const snapshot = { maxSingleTradePercent: 5, monthlyTurnoverCapPercent: 10, … };
// AFTER
const snapshot: MandateSnapshot = {
  operatingMode: 'CONSERVATIVE', level: 'DISCRETIONARY', status: 'ACTIVE', effectiveDate: '…',
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run compliance-ctrl:test --testPathPatterns guardrail-evaluator`
Expected: FAIL.

- [ ] **Step 3: Update the implementation**

In `services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts`, add at the top:

```ts
import { resolveGuardrailParams } from './guardrail-params';
```

Replace every direct read of `mandate.maxSingleTradePercent` (etc.) with:

```ts
const params = resolveGuardrailParams(mandate.operatingMode);
// then use params.maxSingleTradePercent, params.monthlyTurnoverCapPercent, …
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run compliance-ctrl:test --testPathPatterns guardrail-evaluator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts services/advisory/compliance-ctrl/test/unit/guardrail-evaluator.test.ts
git commit -m "refactor(compliance-ctrl): GuardrailEvaluator derives thresholds at eval time"
```

### Task 3.4: Update remaining rule files for new MandateSnapshot shape

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/rules/mandate-validator.ts` + test
- Modify: `services/advisory/compliance-ctrl/src/rules/suitability-checker.ts` + test
- Modify: `services/advisory/compliance-ctrl/src/rules/authority-resolver.ts` + test
- Modify: `services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts` + test

- [ ] **Step 1: Per-file pattern**

For each of the 4 files above, perform these steps in sequence:

a) Read the file: `cat <path>`
b) Identify every read of one of the 8 dropped fields. If the field's purpose is policy enforcement, replace with `resolveGuardrailParams(snapshot.operatingMode).<field>`. If the field was carried purely for serialization (e.g. compliance.repository.ts persistence), drop it.
c) Update the corresponding test file to use the new MandateSnapshot shape (`{level, status, operatingMode, effectiveDate}`) and pass through scenarios per mode.
d) Run the file's test: `pnpm nx run compliance-ctrl:test --testPathPatterns <name>` — expect PASS.

- [ ] **Step 2: Run the whole compliance-ctrl unit suite**

Run: `pnpm nx run compliance-ctrl:test`
Expected: PASS — all unit tests except event-listener (deferred to Task 3.5).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/compliance-ctrl/src/rules/mandate-validator.ts services/advisory/compliance-ctrl/src/rules/suitability-checker.ts services/advisory/compliance-ctrl/src/rules/authority-resolver.ts services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts services/advisory/compliance-ctrl/test/unit/
git commit -m "refactor(compliance-ctrl): mandate validator + suitability + authority + repo use new MandateSnapshot"
```

### Task 3.5: Rewrite event-listener subscriptions

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts`
- Modify: `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Update the test**

In `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`:

- Add a `describe('MANDATE_ISSUED handler')` block asserting it creates a fresh MandateSnapshot from `{level, mandateId, effectiveDate, status: 'ACTIVE'}` + `subject.operatingMode` (which the producer-side adapter forwards alongside).

   Wait — under the new model, MANDATE_ISSUED carries the Mandate row only. operatingMode lives on InvestorProfile. So the handler needs the mode from somewhere. Two options:
   1. Read it from DDB at handler time (cross-service Get).
   2. Have investor-bff include `operatingMode` in the Mandate row (denormalized — small, immutable until `OPERATING_MODE_CHANGED` fires).

   Pick option 2 — denormalize `operatingMode` onto the Mandate row at issue time. Update Task 2.4's onboarding transform Mandate write to include `operatingMode: s.operatingMode`. (Add this Step.)

   Add an `OPERATING_MODE_CHANGED` test asserting the handler updates `MandateSnapshot.operatingMode` (status/level untouched).
   Add a `MANDATE_REVOKED` test (probably already exists; verify it still asserts status='REVOKED').
   Drop tests that subscribe to `INVESTOR_PROFILE_CREATED` / `INVESTOR_PROFILE_UPDATED`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run compliance-ctrl:test --testPathPatterns event-listener`
Expected: FAIL.

- [ ] **Step 3: Verify `operatingMode` is denormalized on the Mandate row**

The Mandate row Put in `onboarding-completed.ts` (Task 2.4) already includes `operatingMode: s.operatingMode,`. The MANDATE_ISSUED CDC event therefore carries `subject.operatingMode` for compliance-ctrl to project from. If the Mandate row is missing this field, add it now and re-run `pnpm nx run investor-bff:test --testPathPatterns onboarding-completed`.

Note: `OPERATING_MODE_CHANGED` only updates the InvestorProfile row (mode is on InvestorProfile; Mandate's `operatingMode` is a snapshot at issue time). The compliance-ctrl handler updates `MandateSnapshot.operatingMode` from the new event payload, NOT from the Mandate row. So the Mandate-row `operatingMode` field remains historical/at-issue and is only read by the MANDATE_ISSUED projection.

- [ ] **Step 4: Update the handler**

Replace the `processInvestorProfileEvent` function in `compliance-ctrl/src/handlers/event-listener.ts` with:

```ts
function processMandateIssued(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const mandateId = subject.mandateId as string;
  const level = subject.level as MandateLevel;
  const operatingMode = subject.operatingMode as OperatingMode;
  const effectiveDate = subject.effectiveDate as string;

  if (!mandateId || !level || !operatingMode) {
    throw new NotRetryableError(
      `MANDATE_ISSUED missing required fields: mandateId=${mandateId} level=${level} operatingMode=${operatingMode}`,
    );
  }

  return update('MandateSnapshot',
    { tenantId, userId, mandateId, level, status: 'ACTIVE', operatingMode, effectiveDate },
    {
      condition: 'attribute_not_exists(#mandate_status) OR #mandate_status <> :revoked',
      conditionNames: { '#mandate_status': 'status' },
      conditionValues: { ':revoked': 'REVOKED' },
      overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' },
    },
  );
}

function processOperatingModeChanged(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as OperatingMode;
  if (!operatingMode) {
    throw new NotRetryableError(`OPERATING_MODE_CHANGED missing operatingMode`);
  }
  return update('MandateSnapshot',
    { tenantId, userId, operatingMode },
    {
      condition: 'attribute_exists(pk) AND #mandate_status <> :revoked',
      conditionNames: { '#mandate_status': 'status' },
      conditionValues: { ':revoked': 'REVOKED' },
      overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' },
    },
  );
}
```

Replace the handler-map registration block with:

```ts
  handlers[InvestorBffEventTypes.MANDATE_ISSUED] = (payload, ctx) =>
    processMandateIssued(payload, ctx);

  handlers[InvestorBffEventTypes.OPERATING_MODE_CHANGED] = (payload, ctx) =>
    processOperatingModeChanged(payload, ctx);

  handlers[InvestorBffEventTypes.MANDATE_REVOKED] = (payload, ctx) =>
    processMandateRevoked(payload, ctx);
```

Remove the old `INVESTOR_PROFILE_CREATED` / `INVESTOR_PROFILE_UPDATED` handlers and their helpers.

- [ ] **Step 5: Update `service.stack.ts` subscription list**

In `services/advisory/compliance-ctrl/src/service.stack.ts`, replace the ingress subscription list block with:

```ts
      eventTypes: [
        AdvisoryAdptEventTypes.RECOMMENDATION_PROPOSED,
        InvestorBffEventTypes.MANDATE_ISSUED,
        InvestorBffEventTypes.OPERATING_MODE_CHANGED,
        InvestorBffEventTypes.MANDATE_REVOKED,
      ],
```

(Use whatever the actual import names are; adjust if `InvestorBffEventTypes` is namespaced via the adapter.)

- [ ] **Step 6: Run tests to verify**

Run: `pnpm nx run compliance-ctrl:test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/compliance-ctrl/src/handlers/event-listener.ts services/advisory/compliance-ctrl/src/service.stack.ts services/advisory/compliance-ctrl/test/unit/event-listener.test.ts services/investor/investor-bff/src/transforms/onboarding-completed.ts services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts
git commit -m "refactor(compliance-ctrl): subscribe to MANDATE_ISSUED + OPERATING_MODE_CHANGED, drop carrier subs"
```

### Task 3.6: Phase 3 gate

- [ ] **Step 1: Run compliance-ctrl + investor-bff full suites**

Run: `pnpm nx run-many -t test --projects=compliance-ctrl,investor-bff,event-processor,cdk-constructs`
Expected: PASS.

---

## Phase 4 — downstream alignment

### Task 4.1: investor-ctrl — drop diff handler, add direct subscriptions

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/src/service.stack.ts`
- Modify: `services/investor/investor-ctrl/test/unit/event-listener.test.ts`
- Modify: `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`

- [ ] **Step 1: Update tests**

In `event-listener.test.ts`, replace the `describe('INVESTOR_PROFILE_UPDATED diff')` block with two blocks:
- `describe('OPERATING_MODE_CHANGED handler')` asserting one notification fires with body matching the operating-mode change.
- `describe('GOAL_UPDATED handler')` asserting one notification fires for the goal change.

Drop diff-detection tests entirely.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-ctrl:test --testPathPatterns event-listener`
Expected: FAIL.

- [ ] **Step 3: Update the handler**

In `services/investor/investor-ctrl/src/handlers/event-listener.ts`:
- Delete the `deriveProfileUpdateNotifications` helper (lines ~191-230).
- Delete the `[InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED]` handler (line ~275).
- Add direct handlers:

```ts
  handlers[InvestorBffEventTypes.OPERATING_MODE_CHANGED] = async (payload, ctx) => {
    return notificationLifecycle.derive('OPERATING_MODE_CHANGED', payload, ctx);
  };
  handlers[InvestorBffEventTypes.GOAL_UPDATED] = async (payload, ctx) => {
    return notificationLifecycle.derive('GOAL_UPDATED', payload, ctx);
  };
```

(Adapt to the actual `notificationLifecycle` API — read it first.)

- [ ] **Step 4: Update `service.stack.ts` subscriptions**

Replace the ingress eventTypes list, removing `INVESTOR_PROFILE_UPDATED` and adding `OPERATING_MODE_CHANGED` + `GOAL_UPDATED`.

- [ ] **Step 5: Update `notification-lifecycle.service.ts`**

If it pivots on event type names (string literals), update them. If it uses InvestorBffEventTypes constants, just verify it has cases for `OPERATING_MODE_CHANGED` and `GOAL_UPDATED`.

- [ ] **Step 6: Run tests**

Run: `pnpm nx run investor-ctrl:test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-ctrl/
git commit -m "refactor(investor-ctrl): subscribe to OPERATING_MODE_CHANGED + GOAL_UPDATED directly, drop diff handler"
```

### Task 4.2: dashboard-bff — verify carrier subscription holds, sweep mandate.* reads

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`
- Modify: `services/investor/dashboard-bff/test/unit/transforms/investor-snapshot.test.ts`

- [ ] **Step 1: Inspect investor-snapshot.ts for mandate.* numeric reads**

Run: `grep -n 'maxSingleTradePercent\|monthlyTurnoverCapPercent\|equityRiskBandPercent\|driftTriggerPercent\|singleEtfConcentrationPercent\|drawdownCircuitBreakerPercent\|coolDownDays\|rebalanceCadence' services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`

If any results, remove those reads (the snapshot doesn't surface guardrails to the UI per Finding 2 of the spec).

- [ ] **Step 2: Run dashboard-bff tests**

Run: `pnpm nx run dashboard-bff:test`
Expected: PASS — should already work since dashboard-bff stays on the carrier subscription.

- [ ] **Step 3: Commit if any change**

```bash
git add services/investor/dashboard-bff/
git commit -m "chore(dashboard-bff): drop mandate.* numeric reads (no longer in payload)"
```

### Task 4.3: advisory-adpt — update forwarding rules

**Files:**
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts`
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts`
- Modify: `services/advisory/advisory-adpt/test/unit/service.stack.test.ts`

- [ ] **Step 1: Add new event types to domain/events.ts**

Add to the imported event-name registry:
```ts
  MANDATE_ISSUED: eventName('MANDATE_ISSUED'),  // (already added by sed in Task 2.1; verify)
  OPERATING_MODE_CHANGED: eventName('OPERATING_MODE_CHANGED'),
  GOAL_UPDATED: eventName('GOAL_UPDATED'),
```

- [ ] **Step 2: Update service.stack.ts forwarding rules**

In the AdvisoryIngestEventTypes adapter rules, ADD `OPERATING_MODE_CHANGED` to the forwarded list (it's needed by compliance-ctrl). MANDATE_ISSUED replaces MANDATE_ACCEPTED (already renamed in Task 2.1).

Decision per CLAUDE.md "BFF MUST serve MFE" — check whether `INVESTOR_PROFILE_CREATED/UPDATED` is still needed by any AdvisoryBus consumer. compliance-ctrl drops it; decision-workflow-ctrl keeps it (TRIGGER use). So it stays in the forwarding list.

- [ ] **Step 3: Update tests**

In `test/unit/service.stack.test.ts`, assert the new forwarded-events list.

- [ ] **Step 4: Run tests**

Run: `pnpm nx run advisory-adpt:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-adpt/
git commit -m "refactor(advisory-adpt): forward OPERATING_MODE_CHANGED + MANDATE_ISSUED"
```

### Task 4.4: investor-adpt + decision-workflow-ctrl

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/events.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` (verify only)

- [ ] **Step 1: investor-adpt — verify OPERATING_MODE_CHANGED entry exists**

Run: `grep -n 'OPERATING_MODE_CHANGED' services/investor/investor-adpt/src/domain/events.ts`

It already does (legacy entry). No change needed beyond the sed rename in Task 2.1.

- [ ] **Step 2: decision-workflow-ctrl — verify TRIGGER_EVENT_TYPES still has the carrier**

Run: `grep -n 'TRIGGER_EVENT_TYPES\|INVESTOR_PROFILE' services/advisory/decision-workflow-ctrl/src/domain/events.ts`

Confirm `INVESTOR_PROFILE_CREATED` + `INVESTOR_PROFILE_UPDATED` remain in the trigger list (carrier-based per spec §3.3).

- [ ] **Step 3: Run tests**

Run: `pnpm nx run-many -t test --projects=investor-adpt,decision-workflow-ctrl`
Expected: PASS.

- [ ] **Step 4: Commit if any change**

```bash
git add services/investor/investor-adpt/ services/advisory/decision-workflow-ctrl/
git commit -m "chore: align investor-adpt + decision-workflow-ctrl with new event topology"
```

### Task 4.5: Phase 4 gate — full unit + typecheck across affected services

- [ ] **Step 1: Run**

Run: `pnpm nx run-many -t test typecheck --projects=investor-bff,investor-ctrl,dashboard-bff,investor-adpt,advisory-adpt,compliance-ctrl,decision-workflow-ctrl,cdk-constructs,event-processor`
Expected: PASS.

---

## Phase 5 — E2E + docs + deploy + validation

### Task 5.1: Delete `update-mandate.e2e.test.ts`

**Files:**
- Delete: `apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts`

- [ ] **Step 1: Remove**

```bash
git rm apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts
git commit -m "chore(e2e): remove update-mandate scenario (mutation deleted)"
```

### Task 5.2: Add `update-operating-mode.e2e.test.ts`

**Files:**
- Create: `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts`

- [ ] **Step 1: Write the scenario**

Create the file. Pattern: follow `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts` for fixture setup. The test should:
1. Onboard a fresh user (e2e- tenant) with `operatingMode: 'CONSERVATIVE'`.
2. Wait for first decision cycle to settle (assert MandateSnapshot exists with operatingMode=CONSERVATIVE).
3. Call `updateOperatingMode(mode: AGGRESSIVE)` via AppSync.
4. Wait for `OPERATING_MODE_CHANGED` to be observed (event-bus trap fixture) AND `MandateSnapshot.operatingMode` to be `AGGRESSIVE`.
5. Trigger a new RECOMMENDATION_PROPOSED via test fixture; assert the resulting compliance check uses AGGRESSIVE thresholds (`maxSingleTradePercent=20` allowed; assert PASS for a trade size that would have BLOCKED under CONSERVATIVE).

Use `apps/e2e-feature-tests/src/helpers/fixtures.ts` builders. Add new builders if needed.

- [ ] **Step 2: Skip running until deploy (Task 5.7)**

These tests run against deployed dev. Don't run yet.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts apps/e2e-feature-tests/src/helpers/fixtures.ts
git commit -m "test(e2e): updateOperatingMode end-to-end re-derivation scenario"
```

### Task 5.3: Update existing E2E tests for new event/row topology

**Files:**
- Modify: `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`

- [ ] **Step 1: revoke-mandate.e2e.test.ts**

Update DDB row assertions: assert on `sk='Mandate'` row (status='REVOKED') instead of `sk='MandateStatus'`. Update event-bus trap to listen for `MANDATE_REVOKED` (no change to event name; just verify path).

- [ ] **Step 2: operating-mode-authority.e2e.test.ts + operating-mode-recommendation-shape.e2e.test.ts**

Wherever the assertion reads `mandate.maxSingleTradePercent` (etc.) from a payload or row, switch to asserting on `MandateSnapshot.operatingMode` and the BLOCK/PASS outcome it implies.

- [ ] **Step 3: helpers/fixtures.ts**

Update Mandate fixture builder to produce the new shape (drop the 8 numeric fields). Add MandateSnapshot fixture builder if absent.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/
git commit -m "test(e2e): align profile + advisory scenarios with new Mandate row + MandateSnapshot shape"
```

### Task 5.4: Update integration tests

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts`
- Modify: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`
- Modify: `services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: investor-bff integration**

Update assertions on the post-onboarding DDB state — assert two rows: composite InvestorProfile (no mandate.* numeric fields), Mandate row with `status='ACTIVE'`. Update `revokeMandate` assertions to check the Mandate row updates. Add a new `updateOperatingMode` test path.

- [ ] **Step 2: compliance-ctrl integration**

Drop `INVESTOR_PROFILE_CREATED/UPDATED` event-injection cases. Add `MANDATE_ISSUED` and `OPERATING_MODE_CHANGED` event-injection cases. Verify MandateSnapshot shape `{operatingMode, level, status}`. Verify rule engine outcomes still match per mode.

- [ ] **Step 3: compliance-ctrl resilience**

Same shape updates for any duplicate-delivery / order-agnostic test fixtures.

- [ ] **Step 4: investor-ctrl onboarding-notification**

The notification flow now triggers on `MANDATE_ISSUED` + `OPERATING_MODE_CHANGED` + `GOAL_UPDATED`. Update fixtures + assertions.

- [ ] **Step 5: dashboard-bff integration**

Verify carrier-subscription path still works. If the test injects `INVESTOR_PROFILE_UPDATED` with `mandate.*` numeric fields, simplify the injected payload (drop those fields).

- [ ] **Step 6: advisory-adpt integration**

Update forwarding test — should now forward `OPERATING_MODE_CHANGED` and `MANDATE_ISSUED` as well.

- [ ] **Step 7: decision-workflow-ctrl integration**

Verify still triggered by carrier events; should be no behavioral change.

- [ ] **Step 8: Run all integration suites**

Run: `pnpm nx run-many -t test-integration --projects=investor-bff,compliance-ctrl,investor-ctrl,dashboard-bff,advisory-adpt,decision-workflow-ctrl`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/
git commit -m "test(integration): align all 8 integration suites with new domain shape + event topology"
```

### Task 5.5: Update architecture + flow docs

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`
- Modify: `docs/architecture/SERVICE-INVENTORY.md`
- Modify: `docs/data-flows/README.md`
- Modify: `docs/data-flows/investor-onboarding.md`
- Modify: `docs/data-flows/advisory-cycle.md`
- Modify: `flows/investor-onboarding.flow.yaml`
- Modify: `flows/advisory-cycle.flow.yaml`
- Modify: `flows/incident-escalation.flow.yaml`

- [ ] **Step 1: SYSTEM-ARCHITECTURE.md — event taxonomy section**

Find the section listing InvestorBus events. Update:
- Add: `OPERATING_MODE_CHANGED`, `GOAL_UPDATED`, `MANDATE_ISSUED` (renamed from `MANDATE_ACCEPTED`).
- Document the 3-tier topology principle (carrier + semantic + lifecycle) with a short subsection explaining when to add a semantic event vs reusing the carrier.
- Update any diagram that shows `mandate.*` flowing from investor-bff to compliance-ctrl — now policy resolution happens in compliance-ctrl.

- [ ] **Step 2: SERVICE-INVENTORY.md**

For investor-bff: update events published list (add the 3, rename `MANDATE_ACCEPTED → MANDATE_ISSUED`, drop the implication that mandate.* numeric fields are part of the payload).
For compliance-ctrl: update events consumed list (drop `INVESTOR_PROFILE_*`, add `MANDATE_ISSUED`, `OPERATING_MODE_CHANGED`).
For investor-ctrl: same for consumed list.
For dashboard-bff: no change.
For advisory-adpt: forwarded list update.
For decision-workflow-ctrl: triggers list unchanged.

- [ ] **Step 3: data-flows/README.md + investor-onboarding.md + advisory-cycle.md**

Update event sequences and Mermaid diagrams. Highlight the new producer-side fan-out at investor-bff egress.

- [ ] **Step 4: flow YAMLs**

Run: `cat flows/investor-onboarding.flow.yaml | head -40`
Update event sequences in the YAML to reflect:
- onboarding emits INVESTOR_PROFILE_CREATED + MANDATE_ISSUED + (conditional) DEPOSIT_INITIATED.
- mode change emits INVESTOR_PROFILE_UPDATED + OPERATING_MODE_CHANGED.

Same for advisory-cycle (compliance subscribes to MANDATE_ISSUED + OPERATING_MODE_CHANGED) and incident-escalation (revoke path emits MANDATE_REVOKED on the Mandate row).

- [ ] **Step 5: Run validate-flow skill on each**

Run: per `flows/*.flow.yaml`, manually verify against code. (The `validate-flow` skill is a manual sanity check, not a CI gate.)

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/ docs/data-flows/ flows/
git commit -m "docs(architecture): update event taxonomy + service inventory + flow specs for resplit"
```

### Task 5.6: Update per-service CLAUDE.md cards + skills

**Files:**
- Modify: `services/investor/investor-bff/CLAUDE.md`
- Modify: `services/investor/investor-ctrl/CLAUDE.md`
- Modify: `services/investor/dashboard-bff/CLAUDE.md`
- Modify: `services/advisory/compliance-ctrl/CLAUDE.md`
- Modify: `services/advisory/advisory-adpt/CLAUDE.md`
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md`
- Modify: `services/investor/investor-adpt/CLAUDE.md`
- Modify: `.claude/skills/audit-domain/SKILL.md`
- Modify: `.claude/skills/audit-e2e-test/SKILL.md`

- [ ] **Step 1: Update each service card**

For each `CLAUDE.md` file, regenerate the State / Ingress / Egress / Handlers / Event Types sections to match new code state. Use the `audit-service` skill if needed.

- [ ] **Step 2: Update skill examples**

In `audit-domain/SKILL.md` and `audit-e2e-test/SKILL.md`, update any example referencing `INVESTOR_PROFILE_UPDATED` carrier-only behavior to instead show the 3-tier topology as the canonical pattern.

- [ ] **Step 3: Commit**

```bash
git add services/*/CLAUDE.md services/*/*/CLAUDE.md .claude/skills/audit-domain/SKILL.md .claude/skills/audit-e2e-test/SKILL.md
git commit -m "docs(cards): regenerate service cards + skill examples for new topology"
```

### Task 5.7: Deploy + smoke validation

- [ ] **Step 1: Deploy affected services to dev sandbox**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --services=investor-bff,investor-ctrl,dashboard-bff,investor-adpt,advisory-adpt,compliance-ctrl,decision-workflow-ctrl \
  | tee /tmp/resplit-deploy.log
```

Expected: clean deploy, no errors. Check tail: `tail -50 /tmp/resplit-deploy.log`.

- [ ] **Step 2: Sanity check DDB row shapes**

Run: `aws dynamodb scan --table-name dev-investor-bff-... --max-items 3 --output json --region us-east-1 2>&1 | head -60`

(Replace `...` with actual table suffix from CDK output. Or use the deploy log to find the table name.)

Expected: see `sk='InvestorProfile'` rows with no `mandate.*` numeric fields, and `sk='Mandate'` rows.

If existing rows in dev have the old shape, redeploy the test tenant flow to materialize new ones (or wipe + reseed via fresh onboarding).

- [ ] **Step 3: Run E2E feature tests**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev NODE_OPTIONS='--experimental-vm-modules' \
  pnpm nx run e2e-feature-tests:test-e2e-features 2>&1 | tee /tmp/resplit-e2e.log | tail -40
```

Expected: all profile + advisory scenarios PASS, including the new `update-operating-mode.e2e.test.ts`.

- [ ] **Step 4: Run Playwright smoke**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e 2>&1 | tail -40
```

Expected: onboarding + first-decision scenarios PASS.

- [ ] **Step 5: Commit deploy artifacts (if any synth output is tracked)**

(Likely none — CDK synth output isn't committed.)

### Task 5.8: Update memory + close backlog

**Files:**
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_investor_profile_collapse.md`
- Modify: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`
- Modify: `docs/backlog/investor-profile-domain-resplit.md`

- [ ] **Step 1: Extend the topic dossier**

Append a "## Resplit (2026-05-08)" section to `project_investor_profile_collapse.md` summarising:
- Why the resplit (root cause: policy denormalization across domains).
- What changed (Mandate sibling row, GUARDRAIL_TABLE in compliance-ctrl, 3-tier event topology).
- What didn't change (Goal/RiskProfile/AccountMode stay nested on InvestorProfile).
- Validation: integration + e2e GREEN, deploy clean, mode change re-derives compliance thresholds end-to-end.

- [ ] **Step 2: Refresh MEMORY.md description**

Update the index line for `project_investor_profile_collapse.md` to mention "+ Resplit 2026-05-08".

- [ ] **Step 3: Mark backlog item shipped**

Edit `docs/backlog/investor-profile-domain-resplit.md` frontmatter:
- `status: shipped`
- `closed: "2026-05-08"`
- `validation_gate: "<paste actual gate-check output: deploy clean; integration N/N; e2e M/M; aws dynamodb scan confirms new row shape>"`

- [ ] **Step 4: Run backlog-lint --fix**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: GREEN — `BACKLOG.md` regenerates with the resplit moved to "Recently Shipped".

- [ ] **Step 5: Commit**

```bash
git add docs/backlog/investor-profile-domain-resplit.md docs/BACKLOG.md ~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/
git commit -m "docs(backlog): ship investor-profile-domain-resplit; extend topic dossier"
```

### Task 5.9: Mark superseded specs/plans inline

**Files:**
- Modify: `docs/superpowers/specs/2026-05-03-investor-profile-collapse-design.md`
- Modify: `docs/superpowers/plans/2026-05-03-investor-profile-collapse-plan.md`
- Modify: `docs/superpowers/specs/2026-05-03-investor-profile-collapse-deep-review.md`
- Modify: `docs/superpowers/specs/2026-04-14-operating-mode-implementation-design.md`
- Modify: `docs/superpowers/plans/2026-04-14-operating-mode-implementation.md`
- Modify: `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md`

- [ ] **Step 1: Add a top-of-doc note to each**

Insert after the `# Title` line of each:

```markdown
> **Partially superseded by [2026-05-08-investor-profile-domain-resplit-design.md](./2026-05-08-investor-profile-domain-resplit-design.md)** — the parts dealing with mandate-on-InvestorProfile, MandateStatus sibling, and carrier-only event topology are reversed. Other parts (multi-row YAGNI removal, plural-Goal removal, version-field cleanup) remain canonical.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/
git commit -m "docs(specs): mark partial supersedence on collapse + operating-mode specs"
```

### Task 5.10: Final validation gate

- [ ] **Step 1: Run the full validation gate per spec §9**

Run all 8 gate items in order:

```bash
# Gate 1
pnpm nx run-many -t test --projects=investor-bff,investor-ctrl,dashboard-bff,investor-adpt,advisory-adpt,compliance-ctrl,decision-workflow-ctrl,cdk-constructs,event-processor

# Gate 2
pnpm nx run-many -t test-integration --projects=investor-bff,compliance-ctrl,investor-ctrl,dashboard-bff,advisory-adpt,decision-workflow-ctrl

# Gate 3 (already done in Task 5.7)
echo "Deploy: see /tmp/resplit-deploy.log"

# Gate 4 (already done in Task 5.7)
NESTFOLIO_INTEG_PREFIX=dev NODE_OPTIONS='--experimental-vm-modules' pnpm nx run e2e-feature-tests:test-e2e-features

# Gate 5
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e

# Gate 6
node .claude/skills/backlog-lint/lint.mjs

# Gate 7 — manual DDB inspection (run from Task 5.7)

# Gate 8 — manual: change mode via AppSync, observe CloudWatch, observe MandateSnapshot, observe gating
```

Expected: every gate item PASS or returns the expected manual-confirmation output.

- [ ] **Step 2: Final commit if any cleanup**

```bash
git status
# if clean, no commit
```

- [ ] **Step 3: Report ready for merge**

Print: "Workstream `investor-profile-domain-resplit` is shippable. Branch: `feat/investor-profile-domain-resplit`. Validation gate: 8/8 PASS."

---

## Self-review notes

This plan covers all 11 sections of the spec:
- §1 Goal — Phases 1-4 implement the three concrete moves.
- §2 Why — captured in spec; no additional task needed.
- §3 Settled decisions §3.1-§3.8 — Tasks 1.1-2.11 + 3.5 (incl. operatingMode denormalization on Mandate row decision in Task 3.5).
- §4 Code surface — Phases 1-4, file-by-file.
- §5 Test surface — Tasks 1.1, 1.2, 1.3, 2.4, 2.5, 2.8, 2.9, 2.10, 3.1, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1-5.4.
- §6 Doc surface — Tasks 5.5, 5.6, 5.8, 5.9.
- §7 Out of scope — referenced; nothing implemented from it.
- §8 Resolved decisions — applied throughout.
- §9 Validation gate — Task 5.10.
- §10 Risks — mitigations applied via tests at each layer.
- §11 Plan structure — five phases match the suggestion.

The `audit-system` and `audit-domain` skills could be invoked between phases as a sanity check; not required by the validation gate but encouraged.
