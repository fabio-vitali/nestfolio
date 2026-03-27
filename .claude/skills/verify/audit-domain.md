---
name: audit-domain
description: Verify domain-level consistency — service completeness, adapter forwarding, event contracts, flow validation. Dispatches parallel sub-agents.
---

## When This Skill Applies
- Verifying a domain after changes
- During system-level audits
- After adding/removing services

## Checklist

- [ ] 1. **List services:** `ls services/{domain}/`
- [ ] 2. **Dispatch parallel sub-agents** — one per service, running audit-service
- [ ] 3. **Domain-level checks:**

| Check | Severity |
|-------|----------|
| Service completeness: has ctrl + hub + adpt minimum | Warning |
| Adapter forwarding: all cross-domain events forwarded | Hard fail |
| Event contract consistency: producer types match consumer | Hard fail |
| Flow validation: all domain flows pass validate-flow | Hard fail |
| Bus configuration: rules match subscriptions | Warning |

- [ ] 4. **Aggregate results** into domain report
- [ ] 5. **Auto-fix:** regenerate stale service cards

## Sub-Agent Prompt Pattern
```
Audit service {service} in domain {domain}.
Read: services/{domain}/{service}/src/service.stack.ts, project.json, src/handlers/*, test/*
Check: file structure, naming, handler patterns, test coverage, CDK patterns, import boundaries
Generate CLAUDE.md card → services/{domain}/{service}/CLAUDE.md
Report: structured pass/fail/warning per check
```

## Anti-Patterns
- NEVER skip service-level audits
- NEVER pass a domain if any hard-fail check fails
