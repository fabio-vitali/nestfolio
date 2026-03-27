---
name: generate-flow-spec
description: Generate a .flow.yaml by tracing event subscriptions, CDC configs, and adapter rules through code. Use to bootstrap flow specs.
---

## When This Skill Applies
- Creating a flow spec for an existing business flow
- Bootstrapping specs for the first time
- Re-generating after changes

## Prerequisites
- Read `domains` skill for event topology

## Checklist

- [ ] 1. **Identify flow trigger** — read data flow doc or user description
- [ ] 2. **Trace the event chain through code:**
  For each step:
  a. **Find producer:** check CDC `eventTypeMap` or explicit emit
  b. **Find bus:** same domain → domain bus; cross domain → check adapter
  c. **Find consumer:** `grep -r "EVENT_NAME" services/*/src/service.stack.ts`
  d. **Find handler:** read consumer handler for state_change + emitted events
- [ ] 3. **For cross-domain hops**, read adapter stacks
- [ ] 4. **Write YAML** to `flows/{flow-name}.flow.yaml` per schema
- [ ] 5. **Validate** — invoke `validate-flow`
- [ ] 6. **Present for human review**

## Reference Files
- Data flow narratives: `docs/data-flows/` (context only, not source of truth)
- Adapter stacks: `services/{domain}/{domain}-adpt/src/service.stack.ts`
- CDC handlers: grep for `changeDataCapture`
- Ingress subscriptions: `eventTypes:` arrays in service stacks
- Schema: `flows/SCHEMA.md`

## Anti-Patterns
- NEVER hand-write without tracing code
- NEVER trust narrative docs as source of truth
- NEVER skip validation after generation
