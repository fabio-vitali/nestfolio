# WS-C — Consumer projectVersioned Conversions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the four *clean* DWC + dashboard-bff read-model mirror projections to versioned `projectVersioned` P1 projections, and refine the drift-checker's R4 rule to per-service scope so the owner-vs-mirror same-typename registrations are legal.

**Architecture:** Each mirror projection currently writes via `record()`/`update()`/`project()` with no version guard. We (a) refine `tools/check-read-model-drift.mjs` so its registry is keyed by `(service, typename)` — letting `MarketSnapshot`/`InvestorProfileSnapshot` be `CommandOwned` in their owner and `Projection<'P1'>` in DWC's mirror without an R4 conflict; (b) convert the four call sites to `projectVersioned` keyed on the upstream version carried by CDC (`__version` for IP/Market mirrors, `snapshot.lastEventSequence` for the Ledger mirror, `lastEventSequence` for dashboard time-travel); (c) register the four typenames `Projection<'P1'>`. `MandateSnapshot` is **out of scope** (split to `read-model-ownership-mandate-projection-fix`). Conversions land *before* registrations so the drift-checker (R2) stays green at every commit. Type enforcement is per-service automatically (each service compiles its own `read-model-ownership.ts`); only the whole-repo drift-checker needs the R4 refinement.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` intent factories (`projectVersioned`), Jest (ts-jest) unit tests, `node:test` for the drift-checker, nx targets (`test`, `lint`, `typecheck`, `event-processor:read-model-drift`).

---

## Background facts (verified against code at plan time)

- `projectVersioned(typename, fields, { version, overrides })` returns a `ProjectVersionedIntent` (`_tag: 'projectVersioned'`, with `typename`, `fields`, `version`, optional `overrides`). It is part of the `WriteIntent` union (`libs/event-processor/src/types/write-intent.ts:79`), so any function typed `=> WriteIntent` can return it. (`libs/event-processor/src/intents/project-versioned.ts:18-57`)
- A handler/transform that returns `undefined` yields **zero** intents — `normalize-handler.ts:18` filters non-WriteIntents. This is the documented "drop, don't write" path and is how `investorSnapshot`/`advisoryStatus` already drop on absent `__version`. So returning `undefined` on absent version is safe for both the DWC map handlers and the dashboard single transform.
- DWC compiles only its own `read-model-ownership.ts`; MI-ctrl/IP-ctrl compile theirs. So `MarketSnapshot = P1` (DWC) and `MarketSnapshot = CommandOwned` (MI-ctrl) coexist at the type level with no clash. The clash is only in the drift-checker's single whole-repo scan → Task 1 fixes that.
- Upstream version sources (confirmed): `MARKET_SNAPSHOT_UPDATED` and `INVESTOR_PROFILE_SNAPSHOT_*` carry top-level `subject.__version` (producer uses `update({ add: { __version: 1 } })`). `PORTFOLIO_UPDATED` carries `subject.snapshot.lastEventSequence`. `LEDGER_ENTRY_RECORDED` carries top-level `subject.lastEventSequence`.

---

## Task 1: Drift-checker R4 per-service scoping (PREREQUISITE)

**Files:**
- Modify: `tools/check-read-model-drift.mjs` (`parseRegistry` ~83-109, `evaluate` ~152-192)
- Test: `tools/check-read-model-drift.test.mjs`

- [ ] **Step 1: Write the failing test — per-service registry + the real owner/mirror case**

Add these tests to `tools/check-read-model-drift.test.mjs` (after the existing `parseRegistry` tests, ~line 74):

```js
test('parseRegistry keys by (service, typename): same typename, different tag in DIFFERENT services is NOT a conflict', () => {
  withTree({
    'services/advisory/market-intelligence-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: CommandOwned; }`,
    'services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: Projection<'P1'>; }`,
  }, (root) => {
    const { conflicts, registry } = parseRegistry(root);
    assert.equal(conflicts.length, 0);
    assert.equal(registry['market-intelligence-ctrl'].MarketSnapshot.tag, 'CommandOwned');
    assert.equal(registry['decision-workflow-ctrl'].MarketSnapshot.tag, 'P1');
  });
});

test('parseRegistry flags a conflicting tag for the same typename WITHIN ONE service', () => {
  withTree({
    'services/a/a-bff/src/read-model-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P1'>; }`,
    'services/a/a-bff/src/other-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P2'>; }`,
  }, (root) => {
    const { conflicts } = parseRegistry(root);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].typename, 'Shared');
  });
});

test('R2 lookup is per-service: a P1 typename in service A does not constrain a project() in service B', () => {
  const { errors } = evalTree({
    'services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: Projection<'P1'>; }`,
    // DWC's own mirror call must be projectVersioned (no error):
    'services/advisory/decision-workflow-ctrl/src/t.ts':
      `projectVersioned('MarketSnapshot', {}, { version: 1 });`,
    // MI-ctrl owns the same typename via update() but registers it CommandOwned —
    // must NOT trip R2 (its own registry entry is CommandOwned, not P1):
    'services/advisory/market-intelligence-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: CommandOwned; }`,
    'services/advisory/market-intelligence-ctrl/src/u.ts':
      `update('MarketSnapshot', {});`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
});
```

Then **update the two existing tests that assumed global scoping** so they exercise within-service conflict (per-service scoping makes their cross-service form non-conflicting):

Replace the body of `test('parseRegistry flags a conflicting tag for the same typename', …)` (~line 50-61) — put both registrations under the SAME service:

```js
test('parseRegistry flags a conflicting tag for the same typename', () => {
  withTree({
    'services/a/a-bff/src/read-model-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P1'>; }`,
    'services/a/a-bff/src/legacy-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P2'>; }`,
  }, (root) => {
    const { conflicts } = parseRegistry(root);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].typename, 'Shared');
  });
});
```

Replace the body of `test('R4: a registry conflict surfaces as an error', …)` (~line 167-173) — same service:

```js
test('R4: a registry conflict surfaces as an error', () => {
  const { errors } = evalTree({
    'services/a/a-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Shared: Projection<'P1'>; }`,
    'services/a/a-bff/src/legacy.ts': `interface ReadModelOwnership { Shared: CommandOwned; }`,
  });
  assert.equal(errors.filter(e => e.rule === 'registry-conflict').length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/check-read-model-drift.test.mjs`
Expected: FAIL — the new per-service tests fail because `parseRegistry` is still global (`registry[typename]`), so `registry['market-intelligence-ctrl']` is `undefined` and the cross-service case reports a conflict.

- [ ] **Step 3: Refactor `parseRegistry` to per-service keying**

In `tools/check-read-model-drift.mjs`, replace `parseRegistry` (lines ~83-109) with:

```js
// services/<domain>/<service>/... → "<service>". Mirrors the repo layout.
function serviceOf(rel) {
  const parts = rel.split('/');
  return parts[2] ?? rel;
}

// Parse every `interface ReadModelOwnership { ... }` block under services/**,
// keyed by (service, typename) so a typename may be CommandOwned in its owning
// service and Projection<'P1'> in a mirroring service without conflict.
export function parseRegistry(root) {
  const registry = {}; // { [service]: { [typename]: { tag, file } } }
  const conflicts = [];
  for (const file of walk(join(root, 'services'))) {
    if (!file.endsWith('.ts')) continue;
    if (EXCLUDED_BASENAME_SUFFIXES.some(s => file.endsWith(s))) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    if (!text.includes('interface ReadModelOwnership')) continue;
    const rel = relative(root, file).split(sep).join('/');
    const service = serviceOf(rel);
    const body = text.slice(text.indexOf('interface ReadModelOwnership'));
    const entryRe = /([A-Za-z0-9_]+)\s*:\s*(Projection<\s*'(P[123])'\s*>|CommandOwned)/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      const typename = m[1];
      const tag = m[3] ? m[3] : 'CommandOwned';
      const svcReg = (registry[service] ??= {});
      const existing = svcReg[typename];
      if (existing && existing.tag !== tag) {
        conflicts.push({ service, typename, tags: [existing.tag, tag], files: [existing.file, rel] });
      } else if (!existing) {
        svcReg[typename] = { tag, file: rel };
      }
    }
  }
  return { registry, conflicts };
}
```

- [ ] **Step 4: Refactor `evaluate` to per-service lookups**

Replace `evaluate` (lines ~152-192) with:

```js
export function evaluate(registry, conflicts, calls, commands) {
  const errors = [];
  const tagOf = (service, t) => registry[service]?.[t]?.tag;
  const isProjection = (service, t) => {
    const tag = tagOf(service, t);
    return !!tag && tag.startsWith('P');
  };

  for (const c of calls) {
    const service = serviceOf(c.file);
    if (c.factory === 'accumulate' && isProjection(service, c.typename)) {
      errors.push({ rule: 'accumulate-on-projection', typename: c.typename, file: c.file, line: c.line,
        msg: `Projection '${c.typename}' written via accumulate() — projections never accumulate across events` });
    }
    if (tagOf(service, c.typename) === 'P1' && c.factory !== 'projectVersioned') {
      errors.push({ rule: 'p1-without-version-guard', typename: c.typename, file: c.file, line: c.line,
        msg: `Projection<'P1'> '${c.typename}' written via ${c.factory}() — P1 rows must use projectVersioned()` });
    }
  }

  // R3 dual-writer — per (service, typename): a command write and an event-side
  // ONGOING intent in the SAME service. record()-only seed is allowed.
  const seenCmd = new Set();
  for (const cmd of commands) {
    const service = serviceOf(cmd.file);
    const key = `${service}::${cmd.typename}`;
    if (seenCmd.has(key)) continue;
    seenCmd.add(key);
    const ongoing = calls.find(c =>
      c.typename === cmd.typename && serviceOf(c.file) === service && ONGOING_FACTORIES.has(c.factory));
    if (ongoing) {
      errors.push({ rule: 'dual-writer', typename: cmd.typename, file: ongoing.file, line: ongoing.line,
        msg: `'${cmd.typename}' written by a command (${cmd.file}:${cmd.line}) AND an event-side ${ongoing.factory}() in ${service} — dual authority; only the record()-seed pattern may coexist with a command` });
    }
  }

  for (const c of conflicts) {
    errors.push({ rule: 'registry-conflict', typename: c.typename, file: c.files.join(' / '), line: 0,
      msg: `'${c.typename}' registered with conflicting tags ${c.tags.join(' vs ')} within service ${c.service} (${c.files.join(', ')})` });
  }

  const seen = new Set();
  const info = [];
  for (const c of [...calls, ...commands]) {
    const service = serviceOf(c.file);
    const key = `${service}::${c.typename}`;
    if (registry[service]?.[c.typename] || seen.has(key)) continue;
    seen.add(key);
    info.push({ typename: c.typename, file: c.file, line: c.line, factory: c.factory ?? 'command' });
  }
  info.sort((a, b) => a.typename.localeCompare(b.typename));

  return { errors, info };
}
```

Also update the CLI summary count in `main()` (line ~208): `Object.keys(registry).length` now counts services, not typenames. Replace with a typename count:

```js
    const typenameCount = Object.values(registry).reduce((n, svc) => n + Object.keys(svc).length, 0);
    console.log(`read-model-drift: OK (${typenameCount} registered typename(s), 0 drift)`);
```

Update the header doc comment line ~19 (`R4 registry-conflict — the same typename registered with different tags.`) to: `R4 registry-conflict — the same typename registered with different tags WITHIN ONE service (per-service scoped: a typename may be CommandOwned in its owner and Projection<'P1'> in a mirror).`

- [ ] **Step 5: Run all drift-checker tests to verify they pass**

Run: `node --test tools/check-read-model-drift.test.mjs`
Expected: PASS — all tests including the new per-service ones and the two updated ones.

- [ ] **Step 6: Run the whole-repo drift-checker to confirm still green (no registrations changed yet)**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: `read-model-drift: OK (… registered typename(s), 0 drift)` — exit 0. (Nothing converted/registered yet; this proves the refactor didn't regress the current green state.)

- [ ] **Step 7: Commit**

```bash
git add tools/check-read-model-drift.mjs tools/check-read-model-drift.test.mjs
git commit -m "refactor(read-model-drift): scope registry + rules per (service, typename)

R4 now flags conflicts only within one service. A typename may be CommandOwned
in its owning service and Projection<'P1'> in a mirroring service (MarketSnapshot,
InvestorProfileSnapshot) — prerequisite for WS-C's DWC mirror P1 registrations."
```

---

## Task 2: Convert DWC snapshot-projector calls to projectVersioned

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts`

(Calls are converted here, registrations land in Task 3. Until registered, the typenames degrade to `string`, so `projectVersioned` compiles and the drift-checker leaves them as INFO — green at this commit.)

- [ ] **Step 1: Rewrite the unit tests to expect projectVersioned**

Replace the three projection-shape tests in `snapshot-projector.test.ts`. First, the IP CREATED + UPDATED tests (lines ~26-86) become version-keyed `projectVersioned` assertions. Replace both `it(...)` blocks (CREATED record + UPDATED update) with:

```ts
  it('INVESTOR_PROFILE_SNAPSHOT_CREATED → projectVersioned keyed on subject.__version', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      payload({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: { riskScore: 55, riskTolerance: 'MODERATE' },
        sourceEventId: 'src-e1',
        __version: 1,
      }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_CREATED'),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('InvestorProfileSnapshot');
    expect((intent as { version: number }).version).toBe(1);
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(
      projectedIpSnapshotPk('tenant-1', 'user-1'),
    );
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(PROJECTED_IP_SNAPSHOT_SK);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.tenantId).toBe('tenant-1');
    expect(fields.userId).toBe('user-1');
    expect(JSON.parse(fields.agentOutput as string)).toEqual({ riskScore: 55, riskTolerance: 'MODERATE' });
    expect(fields.sourceEventId).toBe('src-e1');
    expect(typeof fields.updatedAt).toBe('string');
  });

  it('INVESTOR_PROFILE_SNAPSHOT_UPDATED → projectVersioned with the incremented version', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
      payload({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: { riskScore: 70 },
        sourceEventId: 'src-e2',
        __version: 4,
      }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('InvestorProfileSnapshot');
    expect((intent as { version: number }).version).toBe(4);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(JSON.parse(fields.agentOutput as string)).toEqual({ riskScore: 70 });
    expect(fields.sourceEventId).toBe('src-e2');
  });

  it('IP snapshot drops (undefined) when __version is absent', async () => {
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_UPDATED(
      payload({ tenantId: 'tenant-1', userId: 'user-1', agentOutput: { riskScore: 1 } }),
      ctx('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
    );
    expect(result).toBeUndefined();
  });
```

Keep the existing `falls back to ctx.eventId when sourceEventId missing` test but add `__version: 1` to its payload and change its final assertion to read `.fields.sourceEventId`. Keep the `IP snapshot handlers throw NotRetryableError when agentOutput missing` test as-is **but add `__version: 1`** to each payload so the agentOutput guard (not the version guard) is what throws.

Replace the MarketSnapshot record test (lines ~103-127) with:

```ts
  it('MARKET_SNAPSHOT_UPDATED → projectVersioned keyed on subject.__version', async () => {
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      payload({
        region: 'us-east-1',
        agentOutput: { signals: ['risk-on'], regime: 'BULL' },
        fastComponentsAt: '2026-05-17T12:00:00Z',
        __version: 9,
      }),
      ctx('MARKET_SNAPSHOT_UPDATED', { tenantId: 'SYSTEM' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('MarketSnapshot');
    expect((intent as { version: number }).version).toBe(9);
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(
      projectedMarketSnapshotPk('us-east-1'),
    );
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(PROJECTED_MARKET_SNAPSHOT_SK);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.region).toBe('us-east-1');
    expect(JSON.parse(fields.agentOutput as string)).toEqual({ signals: ['risk-on'], regime: 'BULL' });
    expect(fields.pk).toBeUndefined();
    expect(fields.sk).toBeUndefined();
  });
```

Update the `defaults region to us-east-1` test to add `__version: 1` and assert `_tag === 'projectVersioned'`. Keep the Market `throws NotRetryableError when agentOutput missing` test but add `__version: 1`.

Replace the LedgerSnapshot test (lines ~154-184) `expect(intent._tag).toBe('update')` → `'projectVersioned'`, read `.fields` instead of `.updates`, and assert version:

```ts
  it('projects PORTFOLIO_UPDATED into a LedgerSnapshot projectVersioned keyed on lastEventSequence', async () => {
    const result = await handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
      payload({
        tenantId: 'tenant-abc',
        snapshot: {
          positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
          cashBalanceCents: 5_000_00,
          lastEventSequence: 7,
        },
      }),
      ctx('PORTFOLIO_UPDATED', { tenantId: 'tenant-abc', eventId: 'evt-1' }),
    );
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent!._tag).toBe('projectVersioned');
    expect(intent!.typename).toBe('LedgerSnapshot');
    expect((intent as { version: number }).version).toBe(7);
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.pk).toBe(
      projectedLedgerSnapshotPk('tenant-abc'),
    );
    expect((intent as { overrides?: { pk?: string; sk?: string } }).overrides?.sk).toBe(PROJECTED_LEDGER_SNAPSHOT_SK);
    const fields = (intent as { fields: Record<string, unknown> }).fields;
    expect(fields.tenantId).toBe('tenant-abc');
    expect(fields.lastEventSequence).toBe(7);
    const parsed = JSON.parse(fields.state as string);
    expect(parsed.positions.VTI.quantity).toBe(10);
    expect(parsed.cashBalanceCents).toBe(500_000);
    expect(fields.sourceEventId).toBe('evt-1');
  });
```

Keep the `raises NotRetryableError when subject.snapshot is missing` test as-is.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test decision-workflow-ctrl --testFile=snapshot-projector.test.ts`
Expected: FAIL — current handlers return `record`/`update` intents, so `_tag` assertions and `.version` reads fail.

- [ ] **Step 3: Convert `snapshot-projector.ts` to projectVersioned**

Edit `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`.

Change the import (line 1-9) to add `projectVersioned` and drop the now-unused `record`/`update` (keep `materializeToTable`, `NotRetryableError`, types):

```ts
import {
  materializeToTable,
  projectVersioned,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
```

Replace `projectIpSnapshot` (lines 22-47) — drop the `mode` param, key on `__version`, drop on absent version:

```ts
function projectIpSnapshot(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent | undefined {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.agentOutput for tenant=${tenantId} user=${userId}`,
    );
  }
  const version = subject.__version;
  if (typeof version !== 'number') return undefined;
  const fields = {
    tenantId,
    userId,
    agentOutput: JSON.stringify(agentOutput),
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  return projectVersioned('InvestorProfileSnapshot', fields, {
    version,
    overrides: { pk: projectedIpSnapshotPk(tenantId, userId), sk: PROJECTED_IP_SNAPSHOT_SK },
  });
}
```

Replace `projectMarketSnapshot` (lines 49-67):

```ts
function projectMarketSnapshot(payload: EventPayload): WriteIntent | undefined {
  const subject = payload.subject ?? {};
  const region = (subject.region as string) ?? 'us-east-1';
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) {
    throw new NotRetryableError(
      `MARKET_SNAPSHOT_UPDATED missing subject.agentOutput for region=${region}`,
    );
  }
  const version = subject.__version;
  if (typeof version !== 'number') return undefined;
  return projectVersioned(
    'MarketSnapshot',
    {
      region,
      agentOutput: JSON.stringify(agentOutput),
      updatedAt: new Date().toISOString(),
    },
    {
      version,
      overrides: { pk: projectedMarketSnapshotPk(region), sk: PROJECTED_MARKET_SNAPSHOT_SK },
    },
  );
}
```

Replace `projectLedgerSnapshot` (lines 69-103) — key on `snapshot.lastEventSequence`:

```ts
function projectLedgerSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent | undefined {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const snapshot = subject.snapshot as
    | { positions: Record<string, unknown>; cashBalanceCents: number; lastEventSequence: number }
    | undefined;
  if (!snapshot) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.snapshot for tenant=${tenantId}`,
    );
  }
  const version = snapshot.lastEventSequence;
  if (typeof version !== 'number') return undefined;
  const fields = {
    tenantId,
    state: JSON.stringify({
      positions: snapshot.positions,
      cashBalanceCents: snapshot.cashBalanceCents,
    }),
    lastEventSequence: snapshot.lastEventSequence,
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  // PORTFOLIO_UPDATED is both create + update. projectVersioned's guard
  // (attribute_not_exists(pk) OR __version < :version) makes the first write
  // a create and later writes version-ordered upserts, dropping stale/replayed
  // emits — keyed on the ledger's monotonic lastEventSequence.
  return projectVersioned('LedgerSnapshot', fields, {
    version,
    overrides: {
      pk: projectedLedgerSnapshotPk(tenantId),
      sk: PROJECTED_LEDGER_SNAPSHOT_SK,
    },
  });
}
```

Update `createHandlers` (lines 105-122) — both IP events call the param-less `projectIpSnapshot`:

```ts
export const createHandlers = () => ({
  [InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectIpSnapshot(p, c),
  [InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectIpSnapshot(p, c),
  [MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED]: async (
    p: EventPayload,
    _c: EventContext,
  ) => projectMarketSnapshot(p),
  [LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: async (
    p: EventPayload,
    c: EventContext,
  ) => projectLedgerSnapshot(p, c),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test decision-workflow-ctrl --testFile=snapshot-projector.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm drift-checker still green (typenames not yet registered → INFO)**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: exit 0. `InvestorProfileSnapshot`/`MarketSnapshot`/`LedgerSnapshot` appear in the INFO list (unregistered), not as errors.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts \
        services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts
git commit -m "refactor(decision-workflow-ctrl): snapshot mirrors -> projectVersioned

LedgerSnapshot (lastEventSequence), InvestorProfileSnapshot + MarketSnapshot
(__version) mirrors now version-guarded; absent version drops. Fixes the latent
out-of-order clobber (CREATED record() after UPDATED update())."
```

---

## Task 3: Register DWC mirrors as Projection<'P1'>

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts`

- [ ] **Step 1: Add the P1 trip-wire assertions to the type-test**

Append to `services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts` before `export {};`:

```ts
// Mirror rows are Projection<'P1'> in DWC — projectVersioned only.
projectVersioned('LedgerSnapshot', { a: 1 }, { version: 1 });
projectVersioned('InvestorProfileSnapshot', { a: 1 }, { version: 1 });
projectVersioned('MarketSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error LedgerSnapshot is P1 in DWC — update() is forbidden
update('LedgerSnapshot', { a: 1 });
// @ts-expect-error InvestorProfileSnapshot is P1 in DWC — update() is forbidden
update('InvestorProfileSnapshot', { a: 1 });
// @ts-expect-error MarketSnapshot is P1 in DWC's mirror — update() is forbidden
update('MarketSnapshot', { a: 1 });
```

- [ ] **Step 2: Run the type-test to verify it fails**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: FAIL — the three `@ts-expect-error` directives are unused (the typenames are not yet registered P1, so `update(...)` currently compiles), producing "Unused '@ts-expect-error' directive" errors.

- [ ] **Step 3: Register the mirrors as P1**

Replace `services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts` with:

```ts
/**
 * decision-workflow-ctrl read-model ownership registration.
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionPacket : CommandOwned own-aggregate (update() + self-incremented
 *     __version) → projectVersioned fails typecheck.
 *   - LedgerSnapshot / InvestorProfileSnapshot / MarketSnapshot : DWC-local
 *     MIRRORS of rows owned elsewhere (ledger-ctrl / investor-profile-ctrl /
 *     market-intelligence-ctrl). Projection<'P1'> → projectVersioned only,
 *     keyed on the upstream version carried by CDC (WS-C). The owners register
 *     the same typenames CommandOwned in their own services — legal because the
 *     drift-checker's R4 is per-service scoped.
 *
 * MandateSnapshot is NOT registered here — split to
 * read-model-ownership-mandate-projection-fix (blocked on an investor-bff
 * producer fix); it stays drift-checker INFO until that ships.
 */
import type { CommandOwned, Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionPacket: CommandOwned;
    LedgerSnapshot: Projection<'P1'>;
    InvestorProfileSnapshot: Projection<'P1'>;
    MarketSnapshot: Projection<'P1'>;
  }
}

export {};
```

- [ ] **Step 4: Run the type-test to verify it passes**

Run: `pnpm nx run decision-workflow-ctrl:typecheck`
Expected: PASS — every `@ts-expect-error` now fires (`update(...)` on a P1 typename is rejected), and the `projectVersioned(...)` lines compile.

- [ ] **Step 5: Run the whole-repo drift-checker — confirm R2 + R4 green**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: exit 0. The three typenames move from INFO to registered; R2 passes (calls are `projectVersioned`); R4 does NOT fire for `MarketSnapshot`/`InvestorProfileSnapshot` despite MI-ctrl/IP-ctrl registering them `CommandOwned` (per-service scoping, Task 1).

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts \
        services/advisory/decision-workflow-ctrl/test/types/read-model-ownership.type-test.ts
git commit -m "feat(decision-workflow-ctrl): register Ledger/IP/Market mirrors as Projection<P1>

Activates the projectVersioned trip-wire on the three DWC mirror rows. Legal
alongside the owners' CommandOwned registrations via per-service R4."
```

---

## Task 4: Convert dashboard-bff TimeTravelAvailability to projectVersioned

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/time-travel-availability.ts`
- Test: `services/investor/dashboard-bff/test/unit/transforms/time-travel-availability.test.ts`

- [ ] **Step 1: Rewrite the unit test to expect projectVersioned keyed on lastEventSequence**

Replace `services/investor/dashboard-bff/test/unit/transforms/time-travel-availability.test.ts` with:

```ts
import { projectVersioned } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { timeTravelAvailability } from '../../../src/transforms/time-travel-availability';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('timeTravelAvailability transform', () => {
  const makeUow = (subject: Record<string, unknown>): TestUow => ({
    event: {
      id: 'e1',
      type: 'LEDGER_ENTRY_RECORDED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  it('returns projectVersioned keyed on subject.lastEventSequence', () => {
    expect(
      timeTravelAvailability(makeUow({ snapshotAt: '2026-01-01T12:00:00.000Z', lastEventSequence: 12 })),
    ).toEqual(
      projectVersioned('TimeTravelAvailability', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        available: true,
        snapshotAt: '2026-01-01T12:00:00.000Z',
        latestDate: '2026-01-01',
      }, {
        version: 12,
        overrides: { pk: 'T#t1', sk: 'TimeTravelAvailability' },
      }),
    );
  });

  it('falls back to event timestamp for snapshotAt', () => {
    expect(timeTravelAvailability(makeUow({ lastEventSequence: 3 }))).toEqual(
      projectVersioned('TimeTravelAvailability', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        available: true,
        snapshotAt: '2026-01-01T00:00:00.000Z',
        latestDate: '2026-01-01',
      }, {
        version: 3,
        overrides: { pk: 'T#t1', sk: 'TimeTravelAvailability' },
      }),
    );
  });

  it('drops (undefined) when lastEventSequence is absent', () => {
    expect(timeTravelAvailability(makeUow({ snapshotAt: '2026-01-01T12:00:00.000Z' }))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-bff --testFile=time-travel-availability.test.ts`
Expected: FAIL — transform still returns `project(...)`, not `projectVersioned(...)`, and has no drop path.

- [ ] **Step 3: Convert the transform**

Replace `services/investor/dashboard-bff/src/transforms/time-travel-availability.ts` with:

```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

/**
 * Versioned P1 projection of TimeTravelAvailability from LEDGER_ENTRY_RECORDED.
 * Keyed on the ledger's monotonic `lastEventSequence` carried top-level on the
 * event subject. Returns undefined when it is absent (dropped, not written —
 * mirrors investor-snapshot.ts / advisory-status.ts).
 */
export const timeTravelAvailability = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  const version = payload.lastEventSequence;
  if (typeof version !== 'number') return undefined;

  const snapshotAt = (payload.snapshotAt as string) ?? event.timestamp;
  const latestDate = snapshotAt.slice(0, 10);

  return projectVersioned('TimeTravelAvailability', {
    tenantId,
    userId,
    region,
    available: true,
    snapshotAt,
    latestDate,
  }, {
    version,
    overrides: { pk: `T#${tenantId}`, sk: 'TimeTravelAvailability' },
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test dashboard-bff --testFile=time-travel-availability.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm drift-checker still green (unregistered → INFO)**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: exit 0; `TimeTravelAvailability` in INFO list.

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/time-travel-availability.ts \
        services/investor/dashboard-bff/test/unit/transforms/time-travel-availability.test.ts
git commit -m "refactor(dashboard-bff): TimeTravelAvailability -> projectVersioned

Keyed on LEDGER_ENTRY_RECORDED's lastEventSequence; absent version drops."
```

---

## Task 5: Register dashboard-bff TimeTravelAvailability as P1

**Files:**
- Modify: `services/investor/dashboard-bff/src/read-model-ownership.ts`
- Test: `services/investor/dashboard-bff/test/types/read-model-ownership.type-test.ts`

- [ ] **Step 1: Add the trip-wire assertion to the type-test**

Append to `services/investor/dashboard-bff/test/types/read-model-ownership.type-test.ts` before `export {};`:

```ts
// TimeTravelAvailability is P1 (WS-C) — projectVersioned only.
projectVersioned('TimeTravelAvailability', { a: 1 }, { version: 1 });
// @ts-expect-error TimeTravelAvailability is P1 — project() is forbidden
project('TimeTravelAvailability', { a: 1 });
```

- [ ] **Step 2: Run the type-test to verify it fails**

Run: `pnpm nx run dashboard-bff:typecheck`
Expected: FAIL — unused `@ts-expect-error` (the typename is not yet registered, so `project(...)` compiles).

- [ ] **Step 3: Register it as P1**

In `services/investor/dashboard-bff/src/read-model-ownership.ts`, add `TimeTravelAvailability: Projection<'P1'>;` to the interface and update the doc comment. The interface block becomes:

```ts
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    PositionSnapshot: Projection<'P1'>;
    InvestorSnapshot: Projection<'P1'>;
    TimeTravelAvailability: Projection<'P1'>;
    AdvisoryStatus: Projection<'P3'>;
    Activity: Projection<'P2'>;
  }
}
```

Update the JSDoc: replace the `NOT registered (intentional): TimeTravelAvailability → untouched.` lines (15-17) with a note that `TimeTravelAvailability` is now P1 (WS-C, keyed on `LEDGER_ENTRY_RECORDED.lastEventSequence`).

- [ ] **Step 4: Run the type-test to verify it passes**

Run: `pnpm nx run dashboard-bff:typecheck`
Expected: PASS — `@ts-expect-error project('TimeTravelAvailability', …)` now fires.

- [ ] **Step 5: Drift-checker green**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: exit 0; `TimeTravelAvailability` registered, R2 passes (call is `projectVersioned`).

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/read-model-ownership.ts \
        services/investor/dashboard-bff/test/types/read-model-ownership.type-test.ts
git commit -m "feat(dashboard-bff): register TimeTravelAvailability as Projection<P1>"
```

---

## Task 6: Document the Mandate fan-out contract in canonical doc §9

**Files:**
- Modify: `docs/architecture/READ-MODEL-OWNERSHIP.md` (§9)

- [ ] **Step 1: Read §9 to find the insertion point**

Run: `grep -n "^## \|^### \|§9\|fan-out\|Mandate" docs/architecture/READ-MODEL-OWNERSHIP.md`
Locate §9 (or the producer-surface / fan-out section). If no §9 exists yet, add it after the last numbered section.

- [ ] **Step 2: Write the Mandate fan-out subsection**

Add to §9 (adjust heading number to match the doc's existing scheme):

```markdown
### Mandate fan-out (producer surface)

investor-bff is the single **owner** of the `Mandate` aggregate (the `Mandate`
sibling row, `sk='Mandate'`, carrying an atomic `__version`). It publishes the
Mandate lifecycle event stream. Two services keep their own independent physical
copy and project it — they never read investor-bff's table:

- **compliance-ctrl** — `MandateSnapshot` under `pk=GuardrailPolicy#{tenant}#{user}`,
  used by the RuleEngine.
- **decision-workflow-ctrl** — `MandateSnapshot` under `pk=MandateSnapshot#{tenant}#{user}`,
  read by the SF.

Two physical copies, one logical owner. Per-service R4 scoping (the drift-checker)
permits the same `MandateSnapshot` typename to be `Projection<'P1'>` in both
projecting services.

> **Known gap (2026-06-02):** `MANDATE_ISSUED`/`MANDATE_REVOKED` are CDC from the
> Mandate row (full state + Mandate `__version`), but `OPERATING_MODE_CHANGED` is
> CDC from the **InvestorProfile** row (`onFieldChange: { operatingMode }`) — a
> *different* `__version` counter and a *partial* payload. A single-version-line
> full-row P1 projection of `MandateSnapshot` is therefore not yet possible; the
> compliance-ctrl + DWC `MandateSnapshot` projectors remain field-level `update()`
> (drift-checker INFO, unregistered) until the producer fix in
> `read-model-ownership-mandate-projection-fix` lands. The MarketSnapshot and
> InvestorProfileSnapshot mirrors (WS-C) do not have this problem — each is CDC'd
> from a single owned row carrying one `__version`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/READ-MODEL-OWNERSHIP.md
git commit -m "docs(read-model): document Mandate fan-out + operatingMode cross-row gap (§9)"
```

---

## Verification (WS-C done-definition — the cheap gate; real-LLM e2e deferred to WS-D)

Run in order; all must pass before shipping (see the backlog file's validation gate).

- [ ] `node --test tools/check-read-model-drift.test.mjs` — drift-checker unit tests green.
- [ ] `pnpm nx affected -t test,lint --base=origin/main` — affected unit tests + lint green.
- [ ] `pnpm nx run decision-workflow-ctrl:typecheck` — DWC ownership trip-wire green.
- [ ] `pnpm nx run dashboard-bff:typecheck` — dashboard ownership trip-wire green.
- [ ] `pnpm nx run event-processor:read-model-drift` — whole-repo drift green; `MarketSnapshot`/`InvestorProfileSnapshot`/`LedgerSnapshot`/`TimeTravelAvailability` registered, R2 + R4 clean; `MandateSnapshot` still INFO (expected — split out).
- [ ] Deploy dev: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,dashboard-bff`
- [ ] `pnpm nx affected -t test-integration --base=origin/main` — integration (mocked agents) green.
- [ ] **Real-LLM e2e: DO NOT run here.** Deferred to the single program-end consolidated pass at WS-D (2026-06-02 cadence decision). Record it as WS-D's gate.

## Out of scope (mirror of the backlog file)

- `MandateSnapshot` P1 conversion (compliance-ctrl + DWC mandate-projector) + the investor-bff producer fix — split to `read-model-ownership-mandate-projection-fix`.
- The mandatory-error drift-checker upgrade + `tools/read-model-exclusions.json` — WS-D.
- Real-LLM e2e — WS-D consolidated pass.
