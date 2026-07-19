---
id: onboarding-bff-claude-md-drift
status: parking
type: doc
notes: "onboarding-bff CLAUDE.md fabricates an ONBOARDING_STARTED Ingress subscription that doesn't exist (service has zero Ingress construct), omits agent.ts, undercounts 4 test files."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: claude-md-arch-doc-drift
epic_role: core
---

# onboarding-bff CLAUDE.md drift: fabricated Ingress, omitted agent.ts, undercounted tests

HARD-FAIL finding, surfaced independently by two different audit checks against the same
underlying fact. `services/investor/onboarding-bff/CLAUDE.md:54` claims an inbound
`ONBOARDING_STARTED` subscription that does not exist in `service.stack.ts` — the service has NO
`Ingress` construct at all (same dead-declaration fact also filed separately as
[[onboarding-bff-onboarding-started-no-producer-no-ingress]] under the event-name-integrity epic,
which covers the *event's* dead-wiring; this item covers the *doc's* false claim about it).
Additionally `CLAUDE.md:69-82,24` omits `agent.ts` from the folder description and undercounts by
4 missing test files.
