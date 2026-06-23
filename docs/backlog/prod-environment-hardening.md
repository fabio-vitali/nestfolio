---
id: prod-environment-hardening
status: parking
type: epic
notes: "Correctness/capacity properties that are no-ops on the fresh dev sandbox but bite in a long-lived/production environment; actioned at prod stand-up. Theme epic, 2 members."
done_when: "Each in-scope prod-only hardening item is actioned (or consciously waived) as part of standing up a production environment; all members shipped or dropped."
scope: "Items that are safe/inert on the current fresh dev-only sandbox but become real in a long-lived or production environment: AgentCore maxVms concurrent-VM capacity for prod agent fan-out, and schema-strictness DLQ risk on legacy / pre-migration rows that don't exist in a fresh sandbox."
out_of_scope:
  - "Test-isolation leaks and dev-observable bugs — those bite today, not only in prod"
  - "The sandbox-side mitigation knobs (e.g. capping ESM maxConcurrency) when they are about keeping the dev/e2e suite fast rather than prod posture"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Production-environment hardening

Root cause: the system has only a fresh, dev-only sandbox. A class of correctness and capacity properties are therefore inert today but become real the moment a long-lived or production environment exists — there are no legacy/pre-migration rows to trip schema strictness, and the deliberately-low AgentCore `maxVms` quota is absorbed by native SQS retry rather than degrading real user latency. Each item is explicitly "safe on fresh dev, promote at prod stand-up." Fix pattern: action (or consciously waive) each as part of the production stand-up checklist — request the prod `maxVms` quota; ensure legacy rows carry required fields (or relax the schema) before relying on the re-affirm path.

Members (derived from `epic:` pointers):
- `agentcore-maxvms-prod-quota-increase`
- `mandate-reaffirm-operatingmode-required-legacy-dlq`
