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
  // Use grouped const objects (actual codebase pattern):
  export const MyServiceEventTypes = {
    MY_NEW_EVENT: 'MY_NEW_EVENT',
    MY_OTHER_EVENT: 'MY_OTHER_EVENT',
  } as const;
  ```

- [ ] 2. **Define event payload type** (same file or adjacent)
  ```typescript
  export interface MyNewEventPayload { id: string; tenantId: string; /* ... */ }
  ```

- [ ] 3. **Register emission** — either:
  - **CDC (preferred):** Add to declarative `eventTypes` map on Egress construct in `service.stack.ts`
  - **Explicit:** Emit via EventBridge SDK in handler (rare)

- [ ] 4. **Wire adapter subscription** (if cross-domain)
  Add event type to consuming adapter's EB Rule `detailType` array on the source bus (pull model)

- [ ] 5. **Wire consumer subscriptions**
  Add to consumer Ingress `eventTypes` array

- [ ] 6. **Add consumer handler** for the new event type

- [ ] 7. **Write tests** — producer and consumer

- [ ] 8. **Update flow specs** if part of a tracked flow

- [ ] 9. **Regenerate service cards** for all affected services

## Reference Files
- Event patterns: `services/*/src/domain/events.ts`
- CDC pipeline: `libs/event-processor/src/pipelines/change-data-capture.ts`
- Adapter patterns: `services/{domain}/{domain}-adpt/src/service.stack.ts`

## Anti-Patterns
- NEVER use string literals for event types — always typed constants
- NEVER forward events without a DLQ
- NEVER skip adapter subscriptions for cross-domain events
- NEVER skip flow spec updates for tracked flows
