---
id: rule-of-three-lib-extractions
status: parking
type: epic
notes: "Implementations duplicated past the rule-of-three threshold → extract a shared lib. Debt-class theme epic (different code, same extraction action), 2 members."
done_when: "Each duplicated implementation in scope is extracted to a single shared lib and its callers migrated; both members shipped or dropped."
scope: "An implementation copied across ≥3 callers that has crossed the rule-of-three threshold and should be extracted to a shared lib."
out_of_scope:
  - "Pre-rule-of-three extractions with only 1–2 callers today (wss-subscription-test-harness-test-support — promote when a 2nd caller appears)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Rule-of-three shared-lib extractions

Root cause (debt class): an implementation copied across three or more callers, each carrying
its own copy of the same logic. Honest caveat — the *duplicated code* differs per member; what
they share is the extraction action and the rule-of-three trigger, so this is a debt-class
cluster, not one literal root cause. Grouped so a single extraction sweep drains them.

Members (derived from `epic:` pointers):
- `e2e-contract-emission-bytypename-helper-extract` (the `byTypename` GSI query helper)
- `generalise-appsync-iam-publisher-lib` (per-caller SigV4 AppSync publisher setup)
