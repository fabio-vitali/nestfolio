---
name: create-feature
description: Step-by-step guide for adding a feature to an existing service. Ensures convention compliance, proper event wiring, and service card regeneration.
---

## When This Skill Applies
- Adding new functionality to an existing service
- Adding a new handler to process a new event type
- Extending a service's state or behavior

## Prerequisites
- Read the target service's CLAUDE.md card: `services/{domain}/{service}/CLAUDE.md`
- If missing or stale, invoke `audit-service` first

## Checklist

- [ ] 1. **Read the service card** — understand events, state, emits
- [ ] 2. **Read the service stack** — `services/{domain}/{service}/src/service.stack.ts`
- [ ] 3. **Write the failing test** — `services/{domain}/{service}/test/{feature}.test.ts`
  Use `createTestHarness` + `fakeSqsRecord` from `@nestfolio/event-processor/testing`
- [ ] 4. **Run test to verify it fails**
  `pnpm nx test {service} -- --testPathPattern={feature}`
- [ ] 5. **Write the handler** — `services/{domain}/{service}/src/handlers/{feature}.ts`
  Use an event-processor pipeline (see `event-processor-patterns` skill)
- [ ] 6. **Wire handler in service stack** if new Ingress or event types needed
- [ ] 7. **Run unit tests to verify pass** — `pnpm nx test {service}`
- [ ] 7b. **Update integration tests** if service has them — invoke `create-integration-test` for new event coverage
- [ ] 8. **If new events produced**, invoke `create-event` skill
- [ ] 9. **If CDK changes needed**, reference `cdk-patterns` skill
- [ ] 10. **Regenerate service card** — invoke `audit-service`
- [ ] 11. **Commit**

## Reference Files
- Pipelines: `libs/event-processor/src/pipelines/`
- Test harness: `libs/event-processor/src/testing/`
- CDK constructs: `libs/cdk-constructs/src/core/`

## Anti-Patterns
- NEVER write a raw Lambda handler — always use event-processor pipeline
- NEVER skip service card regeneration
- NEVER add handler logic in service.stack.ts — handlers go in `src/handlers/`
- NEVER import from another service — use events for cross-service communication
