---
id: zce-epic
status: parking
type: epic
notes: "Deploy-bearing epic with one open member whose ship touches a service — so E6 must run a non-vacuous e2e."
done_when: "Both core members shipped and the deploy-bearing change validated by a non-vacuous e2e gate."
scope: "The zce-probe-ctrl service touched by zce-2 plus its e2e coverage."
out_of_scope:
  - Any work beyond the two zce probe members.
  - Any real deploy or e2e run — this fixture exists solely for sandbox tests.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: Zce (zero-collected, deploy-bearing)

A deploy-bearing epic: shipping the open member `zce-2` touches a service (`zce-probe-ctrl`),
so the E6 gate MUST deploy and run e2e. The nx stub returns exit 0 with ZERO tests collected
(the quote-strip false-green). A correct run treats that vacuous gate as RED and refuses to
ship — it never opens a PR. Distinct from the no-code `epic-drainable`, where a 0-collected
e2e is a legitimate no-op rather than the bug.
