---
id: cb-appsync-iam-auth
status: shipped
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_cb_appsync_auth.md
validation_gate: "check-auth.fn.js detects IAM identity + bypasses Cognito claims; integration tests confirm feature flag mutations work."
closed: "2026-04-16"
notes: "AppSync IAM auth fix — check-auth.fn.js detects IAM identity, bypasses Cognito claims for CB feature flag mutations."
---

# CB AppSync IAM auth

RESOLVED + VERIFIED (2026-04-16): check-auth.fn.js detects IAM identity, bypasses Cognito claims. Integration tests confirm feature flag mutations work.
