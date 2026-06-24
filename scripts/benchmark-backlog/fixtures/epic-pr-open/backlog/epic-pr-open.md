---
id: epic-pr-open
type: epic
status: active
notes: "Minimal active-epic fixture for the backlog-eval-framework sandbox tests. Used to exercise run-state seeding at the PR_OPEN_AWAITING_MERGE phase."
done_when: "The stub member is shipped and the eval harness run-state reflects PR_OPEN_AWAITING_MERGE; all core members terminal."
scope: "Sandbox-fixture-only: scaffold a minimal active epic so run-state seeding tests can verify the set-e8 path works."
out_of_scope:
  - Real deploys or real e2e — this fixture exists solely for sandbox tests.
  - Any production backlog behavior.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: PR-Open Fixture

Minimal active epic for the backlog-eval-framework sandbox, used to test run-state seeding
at the `PR_OPEN_AWAITING_MERGE` phase (`set-e8`).
