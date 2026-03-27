---
name: create-data-flow
description: Wire a cross-domain data flow — design, define events per hop, implement adapter forwarding, test, create flow spec. Use for flows spanning multiple domains.
---

## When This Skill Applies
- Implementing a new business flow crossing domain boundaries
- Extending an existing flow with cross-domain hops
- Debugging a broken cross-domain flow

## Prerequisites
- Read `domains` skill for event topology
- Read existing flow specs in `flows/` for similar patterns
- Read CLAUDE.md cards for all services involved

## Checklist

- [ ] 1. **Design the flow** — sketch the event chain:
  ```
  ServiceA (Domain1) → EVENT_A (CDC) → Domain1Bus → Adapter → Domain2Bus → ServiceB
  ```
- [ ] 2. **For each event hop**, invoke `create-event` skill
- [ ] 3. **For each cross-domain hop**, add adapter forwarding rules
- [ ] 4. **Test end-to-end:**
  - Unit test each handler (event-processor harness)
  - CDK assertions for EventBridge rules
  - Trace event chain: producer CDC → bus → adapter → target bus → consumer
- [ ] 5. **Create flow spec** — invoke `generate-flow-spec` or write `flows/{name}.flow.yaml`
- [ ] 6. **Validate spec** — invoke `validate-flow`
- [ ] 7. **Regenerate service cards** for all affected services

## Anti-Patterns
- NEVER create direct service-to-service API calls
- NEVER skip adapter forwarding — events don't cross buses automatically
- NEVER create a flow without a `.flow.yaml` spec
- NEVER implement without tracing the full event chain first
