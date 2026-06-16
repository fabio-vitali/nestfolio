---
id: generalise-appsync-iam-publisher-lib
status: parking
epic: rule-of-three-lib-extractions
epic_role: core
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Three callers — rule-of-three threshold; copies all do their own SigV4 setup."
---

# Generalise AppSync IAM publisher pattern into a shared lib

Three callers as of 2026-05-01: `services/investor/investor-bff/src/handlers/event-listener.ts:2,27,76` (publishDepositEvent), `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` (publishDashboardUpdate), and planned `services/advisory/advisory-bff/src/handlers/decision-publisher.ts` from current ACTIVE. Three is the rule-of-three threshold; current copies all do their own SigV4 setup + mutation call. See `feedback_e2e_ui_assertions_only.md` for the principle that drove the third caller.
