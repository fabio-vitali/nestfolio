---
name: No scans, no FilterExpression on key attributes
description: Never use DynamoDB Scan operations or FilterExpression on GSI key
  attributes — always use KeyConditionExpression and Query
type: feedback
mints:
  - check: no-ddb-scan
    ratified: 2026-07-01T16:17:05.225Z
    status: active
---
Never use DynamoDB Scan operations. Never use FilterExpression on GSI key attributes. Always use a KeyConditionExpression Query against a GSI. (In-repo ring-2 mirror of the user-memory lesson; the mints: pointer is reconciled by SPEC 2 reconcileLesson.)
