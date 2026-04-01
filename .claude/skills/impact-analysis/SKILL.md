---
name: impact-analysis
description: Assess change blast radius — scans flow specs and code for everything affected by an event rename, service modification, or handler removal.
---

## When This Skill Applies
- Renaming or removing an event type
- Modifying event subscriptions
- Removing a handler
- Modifying adapter subscriptions

## Checklist

- [ ] 1. **Identify change scope** — what is being modified/removed/renamed?
- [ ] 2. **Scan flow specs:**
  ```bash
  grep -l "{EVENT_NAME}" flows/*.flow.yaml
  ```
- [ ] 3. **Scan code:**
  ```bash
  grep -rn "{EVENT_NAME}" services/*/src/
  ```
- [ ] 4. **Check transitive impact:**
  ```bash
  pnpm nx show projects --affected
  ```
- [ ] 5. **Report blast radius:**
  ```
  ## Impact: {change description}
  ### Directly Affected
  - flows/{flow}.flow.yaml — step N
  - services/{domain}/{service}/src/service.stack.ts:{line}
  ### Transitively Affected
  - {project1}, {project2}, ...
  ### Required Changes
  1. Update flow spec
  2. Update subscription
  3. Update handler
  4. Update adapter
  5. Regenerate service cards
  ```

## Anti-Patterns
- NEVER make breaking changes without impact analysis
- NEVER rely on grep alone — also check nx affected
- NEVER skip flow spec updates after breaking changes
