---
id: investor-bff-double-revoke-assertion-mismatch
status: shipped
rank: null
type: bug
notes: "After acceptedAt fix unblocked the double-revoke path, the test now fails on regex mismatch — resolver surfaces raw DDB ConditionalCheckFailedException, not the InvalidState/not-active/already-revoked language the assertion expected."
references: []
out_of_scope:
  - "Sibling 'wrong-state' resolvers (updateGoal precondition failures, etc.) — only revoke-mandate is failing"
spec: null
plan: null
topic_memory: []
validation_gate: "investor-bff test 66/66 + test-integration 18/19 GREEN on main 2026-05-11 (1 pre-existing skip on compliance MandateSnapshot propagation, unrelated). Translated DDB ConditionalCheckFailedException to InvalidState in revoke-mandate.fn.js response handler; added matching unit test. Deployed to dev sandbox before integration verification."
---

# `should reject double-revoke with InvalidState` regex mismatches actual resolver error

**Failing test:** `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts:645` — `AppSync mutations › should reject double-revoke with InvalidState`.

Assertion: `.rejects.toThrow(/InvalidState|not active|already revoked/i)`.

Actual error message: `"GraphQL errors: [{...,\"errorType\":\"DynamoDB:ConditionalCheckFailedException\",...,\"message\":\"The conditional request failed (Service: DynamoDb, Status Code: 400...)\"}]"`.

## Root cause

`revoke-mandate.fn.js` issues an `UpdateItem` with `ConditionExpression: '#status = :active'`. On second revoke (status already REVOKED), DDB returns `ConditionalCheckFailedException`, which AppSync surfaces verbatim. There is no translation layer between the DDB error and a user-friendly `InvalidState` error type.

Surfaced 2026-05-11 after the parent workstream `investor-bff-mandate-accepted-at-field-undefined` removed the `acceptedAt` GraphQL selection — without `acceptedAt` masking the call with a schema error, the double-revoke path now reaches DDB and fails the conditional check. The backlog author's hypothesis ("same FieldUndefined masks the InvalidState path") was correct that FieldUndefined was the immediate blocker, but the underlying resolver does not produce InvalidState language to begin with.

## Resolution paths

Two clean options — each touches different files; user should pick:

1. **Adjust the assertion** (test-only): extend regex to `/InvalidState|not active|already revoked|ConditionalCheckFailedException/i`. Honest about current behavior; documents that the test gate is "any conflict surface", not specifically a friendly error shape.
2. **Translate the resolver error** (resolver change): in `revoke-mandate.fn.js`, catch the conditional check failure and throw a typed `InvalidState` error. Better UX for the GraphQL consumer; gives the test something meaningful to assert.

Option 2 is preferable design-wise (consistent with the AppSync error contract for other "wrong-state" mutations) but is a behavior change. Option 1 is a 1-character edit.

Surfaced 2026-05-11 during execution of `investor-bff-mandate-accepted-at-field-undefined`.
