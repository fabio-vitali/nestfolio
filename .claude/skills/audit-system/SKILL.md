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
- [ ] 2. **System-level checks:**

| Check | Severity |
|-------|----------|
| All domains pass | Aggregated |
| Cross-domain adapter symmetry | Hard fail |
| Orphan services (outside domains) | Warning |
| Flow spec coverage | Warning |
| Skill freshness (referenced paths exist) | Warning |

- [ ] 3. **Generate dashboard:**
  ```
  | Domain | Services | Pass | Fail | Warn |
  |--------|----------|------|------|------|
  | Advisory | 15 | ... | ... | ... |
  | Execution | 6 | ... | ... | ... |
  | Investor | 7 | ... | ... | ... |
  | Ledger | 5 | ... | ... | ... |
  ```
- [ ] 4. **Apply auto-fixes** — regenerate stale cards

## Anti-Patterns
- NEVER run sequentially — use parallel sub-agents
- NEVER skip cross-domain checks after domain audits
