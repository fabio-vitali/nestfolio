---
name: validate-flow
description: Validate a .flow.yaml against actual code — checks subscriptions, handlers, state changes, adapter forwarding. Use to verify flow specs.
---

## When This Skill Applies
- After generating or modifying a flow spec
- During audits
- Debugging a broken business flow

## Checklist

- [ ] 1. **Read the flow spec** — `flows/{flow-name}.flow.yaml`
- [ ] 2. **For each step, verify against code:**
  a. **Subscription exists:** grep Ingress `eventTypes` for the event
  b. **Handler exists:** check `src/handlers/` for matching handler
  c. **State change occurs:** read handler, verify WriteIntent matches
  d. **Output event emitted:** verify CDC `eventTypeMap` or explicit emit
  e. **Adapter forwarding:** verify Rule `detailType` array for cross-domain steps
- [ ] 3. **Report results:**
  ```
  ✓ Step 1: {service} receives {EVENT} — {file}:{line}
  ✗ Step 3: handler for {EVENT} NOT FOUND
  ⚠ Step 5: adapter forwarding missing for {EVENT}
  ```
- [ ] 4. **Suggest fixes** for broken links

## Anti-Patterns
- NEVER validate by reading spec alone — trace through code
- NEVER mark valid without checking every step
- NEVER auto-fix without presenting for approval
