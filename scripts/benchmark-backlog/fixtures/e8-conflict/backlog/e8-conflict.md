---
id: e8-conflict
status: active
type: epic
notes: "Fixture representing an epic at the E8 PR-merge phase with a merge conflict in docs/backlog/."
done_when: "All gamma core members are shipped and the PR is merged with clean frontmatter."
scope: "The gamma surface: two tasks, both already shipped mid-epic before the conflict surfaced."
out_of_scope:
  - Any new feature work — this fixture exercises the E8 conflict-resolution path only.
  - Real deploys — fixture only.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: E8-Conflict

Active epic whose two core members are already shipped. When the scenario runs, the
`docs/backlog/e8-conflict.md` file will have a merge conflict between the branch
(shipped frontmatter) and origin/main (still-active promotion marker). The scenario
exercises the E8 conflict-resolution path: resolve to shipped frontmatter, run
`backlog-lint --fix`, close the epic.
