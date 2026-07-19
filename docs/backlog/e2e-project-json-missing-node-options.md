---
id: e2e-project-json-missing-node-options
status: parking
type: tooling
notes: "apps/e2e-feature-tests/project.json test-e2e-features target has no env block; a documented NODE_OPTIONS convention requirement is unmet."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# e2e-feature-tests project.json missing NODE_OPTIONS env block

`apps/e2e-feature-tests/project.json`'s `test-e2e-features` target has no `env` block, missing a
documented `NODE_OPTIONS` convention requirement that the E2E test-config check expects.
