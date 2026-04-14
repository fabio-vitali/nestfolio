---
name: audit-system
description: Full system sweep — dispatches audit-domain per domain in parallel, checks cross-domain consistency, orphans, flow coverage, skill freshness.
---

## When This Skill Applies
- Periodic health check
- Before major releases
- After architectural changes

## Checklist

- [ ] 1. **Dispatch 4 parallel sub-agents** — one per domain (advisory, execution, investor, ledger), each running audit-domain
- [ ] 2. **E2E feature test audit** — invoke the `audit-e2e-test` skill against `apps/e2e-feature-tests/`. E2E tests are a system-level concern (they span domains), so this check lives here, not in per-service audit-service.
- [ ] 3. **System-level checks:**

| Check | Severity |
|-------|----------|
| All domains pass | Aggregated |
| E2E feature test coverage (via audit-e2e-test) | Hard fail |
| Cross-domain adapter subscription coverage (adapters subscribe to all required events on source buses) | Hard fail |
| Orphan services (outside domains) | Warning |
| Flow spec coverage | Warning |
| Skill freshness (referenced paths exist) | Warning |

- [ ] 4. **Generate dashboard:**
  ```
  | Domain | Services | Pass | Fail | Warn |
  |--------|----------|------|------|------|
  | Advisory | 15 | ... | ... | ... |
  | Execution | 6 | ... | ... | ... |
  | Investor | 7 | ... | ... | ... |
  | Ledger | 5 | ... | ... | ... |
  ```
- [ ] 5. **Apply auto-fixes** — regenerate stale cards

## Anti-Patterns
- NEVER run sequentially — use parallel sub-agents
- NEVER skip cross-domain checks after domain audits
