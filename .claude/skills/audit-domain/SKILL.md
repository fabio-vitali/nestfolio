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
| Adapter subscriptions: consuming adapters subscribe to all required cross-domain events (pull model) | Hard fail |
| Event contract consistency: producer types match consumer. Check ALL emission paths: CDC Egress eventTypes, errorEventType in pipelines, grantPutEventsTo (agent tools), Facade noneDataSource resolvers, SF EventBridge PutEvents integrations, Orchestration triggers | Hard fail |
| Flow validation: all domain flows pass validate-flow | Hard fail |
| Undocumented flows: Ingress/Egress events not referenced in any `flows/*.flow.yaml` | Warning |
| Bus configuration: rules match subscriptions | Warning |
| Infinite loop detection: flag cycles where Service A subscribes to Event X → writes Entity Y → CDC emits Event Z → Event Z reaches Service A's subscription (directly or via adapter). Must trace COMPLETE cycle. A service emitting an event that other services consume is normal — only flag if the chain loops back to the originating service's subscription. | Warning |

- [ ] 4. **Aggregate results** into domain report
- [ ] 5. **Auto-fix:** regenerate stale service cards

### Undocumented Flows Detection

For each service in the domain:
1. Extract all Ingress event types from `service.stack.ts` (the `detailType` arrays in each Ingress construct)
2. Extract all Egress event types from `service.stack.ts` (the `eventTypes` map on Egress construct)
3. Scan all `flows/*.flow.yaml` files — collect every event type referenced in any flow step
4. Flag Ingress/Egress events that don't appear in any flow spec as **undocumented**

Report format:
```
| Service | Event | Direction | Documented? | Flow Spec |
|---------|-------|-----------|-------------|-----------|
| advisory-ctrl | MANDATE_CREATED | Ingress | Yes | mandate-to-decision.flow.yaml |
| advisory-ctrl | ANALYSIS_COMPLETED | Egress | No | — |
```

Events that are purely internal (e.g., error events, CDC projections within the same service) may be legitimately undocumented — flag as warning, not hard-fail.

## Sub-Agent Prompt Pattern
```
Audit service {service} in domain {domain}.
Read: services/{domain}/{service}/src/service.stack.ts, project.json, src/handlers/*, test/*
Check: file structure, naming, handler patterns, test coverage, CDK patterns, import boundaries
Generate CLAUDE.md card → services/{domain}/{service}/CLAUDE.md
Report: structured pass/fail/warning per check
```

## Remediation Plan

After aggregating service-level and domain-level results, if any hard-fail checks exist:

1. **Aggregate failures** from all service audits and domain-level checks. Group by category:
   - Per-service failures (from audit-service sub-agents, with mapped fixing skills already attached)
   - Domain-level failures:

   | Domain Failure | Fixing Skill |
   |---------------|--------------|
   | Missing service (incomplete domain: no ctrl/hub/adpt) | `create-service` |
   | Adapter subscription gap (missing cross-domain event) | `create-event` + `create-data-flow` |
   | Event contract mismatch (producer/consumer types diverge) | `create-event` (update schema) |
   | Flow validation failure | `validate-flow` → then manual fix or `create-data-flow` |
   | Undocumented flows (events not in any flow spec) | `generate-flow-spec` (trace and document the flow) |
   | Infinite loop detected | Manual architectural fix — present to user with AskUserQuestion |

2. **Present remediation summary** using AskUserQuestion:

   > **{domain} domain audit: {pass} pass, {fail} fail, {warn} warnings across {N} services.**
   >
   > Service-level issues: {count} (aggregated from audit-service sub-agents)
   > Domain-level issues: {count}
   >
   > Top priorities:
   > 1. {highest impact failure + mapped skill}
   > 2. {next highest}
   > 3. ...
   >
   > Options:
   > - **A) Generate fixing plan** — invoke `writing-plans` with the full domain remediation scope (recommended)
   > - **B) Fix incrementally** — pick the top-priority service and fix it now
   > - **C) Report only** — save the domain audit report, fix later

3. If user selects **A**: invoke the `writing-plans` skill with the aggregated audit report. The plan should organize tasks by service, with domain-level fixes as a final group.
4. If user selects **B**: invoke `audit-service` remediation for the highest-priority service.

**When called as sub-agent by audit-system:** skip the AskUserQuestion step. Instead, return the structured failure list with mapped skills so audit-system can aggregate across all domains and present a single remediation prompt.

## Anti-Patterns
- NEVER skip service-level audits
- NEVER pass a domain if any hard-fail check fails
- NEVER skip the remediation step when running standalone — always present options after failures
