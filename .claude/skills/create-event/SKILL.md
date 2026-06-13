---
name: create-event
description: Add a new event type — TypeScript schema, producer registration, declarative CDC emission, adapter subscriptions, consumer subscriptions. Use when adding or modifying events.
---

## When This Skill Applies
- Adding a new event type
- Modifying an existing event's schema
- Wiring event forwarding between domains

## Prerequisites
- Read `domains` skill for event topology
- Read the producer service's CLAUDE.md card

## Checklist

- [ ] 1. **Define event type constant** — `services/{domain}/{service}/src/domain/events.ts`
  ```typescript
  import { eventName } from '@nestfolio/event-types';

  // Use grouped const objects with branded eventName() (actual codebase pattern):
  export const MyServiceEventTypes = {
    MY_NEW_EVENT: eventName('MY_NEW_EVENT'),
    MY_OTHER_EVENT: eventName('MY_OTHER_EVENT'),
  } as const;
  ```
  `eventName()` returns a branded `EventName` type — compile-time safety, runtime string.

- [ ] 2. **Define event payload type** (same file or adjacent)
  ```typescript
  export interface MyNewEventPayload { id: string; tenantId: string; /* ... */ }
  ```

- [ ] 3. **Register emission** — either:
  - **CDC (preferred):** Add to declarative `eventTypes` map on Egress construct in `service.stack.ts`
    ```typescript
    // EventTypesMap shape: Record<__typename, RecordTypeConfig>
    // RecordTypeConfig = { insert?: EventName; modify?: EventName; remove?: EventName }
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'MyRecordType': {
          insert: MyServiceEventTypes.MY_NEW_EVENT,
          modify: MyServiceEventTypes.MY_EVENT_UPDATED,
        },
      },
    });
    ```
    Each key is a DynamoDB `__typename`, each value maps DDB stream actions (`insert`/`modify`/`remove`) to branded EventName constants. Only mapped actions emit events — be explicit.
  - **Explicit:** Emit via EventBridge SDK in handler (rare)

- [ ] 4. **Wire adapter subscription** (if cross-domain)
  Add event type to consuming adapter's EB Rule `detailType` array on the source bus (pull model).
  All adapter rules MUST use `$or` pattern for test isolation:
  ```typescript
  const fromSourceRule = new Rule(this, 'Ingress-FromSource', {
    eventBus: sourceBus,
    eventPattern: { detailType: eventList },
    targets: [new EventBusTarget(domainBus, { deadLetterQueue: dlq })],
  });
  (fromSourceRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
    '$or': [
      { 'detail-type': eventList, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
      { 'detail-type': eventList, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
    ],
  });
  ```
  This accepts all non-test events OR test events scoped to the adapter's own service name.

- [ ] 5. **Wire consumer subscriptions**
  Add to consumer Ingress `eventTypes` array

- [ ] 6. **Add consumer handler** for the new event type

- [ ] 6b. **Classify ownership of any row the consumer writes** — see
  `docs/architecture/READ-MODEL-OWNERSHIP.md`. A row materialized from *another*
  service's event is a **projection**: register the `__typename` in the consumer's
  `src/read-model-ownership.ts` and write it with `projectVersioned` (P1, carrying
  the producer's monotonic `__version`), `record` (P2), or a derived read (P3).
  Never `accumulate` a projection; never field-`update` a row a producer owns.
  On the **producer** side (step 3), a row that downstreams will project as P1
  must carry a top-level monotonic `__version` on its emitted event (the §3
  carriage convention). Run `pnpm nx run event-processor:read-model-drift`.
  (If the new row is a verified non-governed outbox/carrier/feed-cache row, add it to
  `tools/read-model-exclusions.json` instead of registering it — the gate errors on any
  unclassified intent-factory write.)

### Typed-subject conventions (enforced)

When a service produces an event, it owns ONE zod contract that types both the persisted
row and the emitted subject:

- Name it for the clean domain/event concept — `<Name>Schema` + `type <Name>` — **no
  `Subject` suffix** (event-aligned name on clash, e.g. `LedgerEntryRecorded`,
  `InvestorProfileUpdated`).
- Type the row as `TableEntry<Name, RequestContext>` and the event as
  `BusEvent<Name, RequestContext>` — never a hand-rolled `pk`/`sk`/`__typename` interface,
  and never drop the context generic.
- **Import channel:** intra-domain consumers import the producer's
  `@nestfolio/<svc>/contracts` (payloads) and `@nestfolio/<svc>/events` (names) directly;
  cross-domain consumers import BOTH from the producer-domain's
  `@nestfolio/<domain>-adpt/domain` re-export. Add the re-export to that adapter's `/domain`
  index (schemas) and its `*CrossDomainEventTypes` map (names). Never reach into another
  domain's `/contracts` or `/events`.
  **Mutual intra-domain exception** (A↔B cycle): boundary contracts live in the
  domain adapter `/domain`, NOT in either service's `/contracts`. See
  `docs/architecture/SYSTEM-ARCHITECTURE.md` §"Typed-subject contracts" rule 2.
- Consumers read the subject via `parseSubject(carrier, <ProducerSchema>)` — never
  `event.subject as <Type>` / `as Record<string,unknown>`.

Enforced by `tools/check-typed-subjects.mjs` (nx target
`event-processor:typed-subject-drift`, also pre-commit). A genuinely-polymorphic reader
(KB-stringify, agent fan-in) gets a registered entry in
`tools/typed-subject-exclusions.json` with a reason.

- [ ] 7. **Write tests** — producer and consumer

- [ ] 8. **Update flow specs** if part of a tracked flow

- [ ] 9. **Regenerate service cards** for all affected services

## Reference Files
- Event patterns: `services/*/src/domain/events.ts`
- CDC pipeline: `libs/event-processor/src/pipelines/change-data-capture.ts`
- Adapter patterns: `services/{domain}/{domain}-adpt/src/service.stack.ts`

## Anti-Patterns
- NEVER use plain string constants (`'MY_EVENT'`) — always use `eventName('MY_EVENT')` from `@nestfolio/event-types`
- NEVER forward events without a DLQ
- NEVER skip adapter subscriptions for cross-domain events
- NEVER skip flow spec updates for tracked flows
- NEVER materialize a projection from an event with `accumulate` or an unguarded `project`/`update` — a P1 projection uses `projectVersioned` + `__version` (see `docs/architecture/READ-MODEL-OWNERSHIP.md`)
