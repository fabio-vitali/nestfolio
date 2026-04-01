---
name: create-event
description: Add a new event type — TypeScript schema, producer registration, CDC/explicit emission, adapter forwarding, consumer subscriptions. Use when adding or modifying events.
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
  export const MY_NEW_EVENT = 'MY_NEW_EVENT';
  ```

- [ ] 2. **Define event payload type** (same file or adjacent)
  ```typescript
  export interface MyNewEventPayload { id: string; tenantId: string; /* ... */ }
  ```

- [ ] 3. **Register emission** — either:
  - **CDC (preferred):** Add to `eventTypeMap` in CDC handler
  - **Explicit:** Emit via EventBridge SDK in handler

- [ ] 4. **Wire adapter forwarding** (if cross-domain)
  Add event type to adapter Rule's `detailType` array

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
- NEVER skip adapter forwarding for cross-domain events
- NEVER skip flow spec updates for tracked flows
