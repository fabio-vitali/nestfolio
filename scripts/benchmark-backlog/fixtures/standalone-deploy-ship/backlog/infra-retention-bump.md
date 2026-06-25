---
id: infra-retention-bump
status: queued
rank: 1
type: chore
requires_deploy: true
notes: "Add a dev-sandbox log-retention default under infrastructure/ — a one-file infra change gated on a dev deploy, so Complex lane."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# infra-retention-bump: add an infrastructure log-retention default

Create the file `infrastructure/config/retention-days.txt` containing the single line `30`.

This is a one-line, fully self-contained infra change — no service code, no public-interface
change, no architectural decision. The **entire** implementation is creating that one file with
that one value. It nonetheless touches `infrastructure/`, so its done-definition requires a
dev-sandbox deploy validation gate (`requires_deploy: true`) and therefore the **Complex** lane:
isolation worktree + branch, the closing-phase deploy, then a PR (never a self-merge).
