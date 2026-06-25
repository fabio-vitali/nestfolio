---
id: onx-epic
status: active
type: epic
notes: "The in-flight delivery epic — exactly one active epic is allowed (rule 11)."
done_when: "The onx core member is shipped and the onboarding fix is merged."
scope: "The onx surface: the onboarding wizard resume fix."
out_of_scope:
  - Any onboarding work beyond the resume fix.
  - Any real deploy or e2e run — this fixture exists solely for sandbox tests.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: Onx (active delivery epic)

The single active delivery epic. It coexists with a separate promotable parking epic
(zeta-epic) so the fixture exercises the "active epic AND a promotable parking epic"
branch — the agent must not try to promote zeta while onx is in flight.
