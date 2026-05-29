---
id: dev-ledger-ctrl-state-table-orphans
status: dropped
type: infra
notes: "Two orphan dev-ledger-ctrl-StateTable... tables (0 items, streams enabled) left over from 2026-04-03 deploys. Not a cost or correctness issue; visual clutter + minor account-level resource overhead."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Orphan ledger-ctrl StateTables on dev account

Surfaced 2026-05-28 during `ledger-ctrl-resilience-pairwise-timeout` investigation.

## Symptom

`aws dynamodb list-tables` returns three `dev-ledger-ctrl-StateTable962DE04C-*` tables. CloudFormation tracks only one (`-BEXU1SJC0QSD`, CREATE_COMPLETE 2026-04-02). The other two were created within ~20 min of each other on 2026-04-03 and are no longer owned by any stack:

| Table physical id | Items | SizeBytes | Created | Status |
|---|---|---|---|---|
| `-JJ1W7PNMGIVY` | 0 | 0 | 2026-04-03T00:11:51 | orphan |
| `-8W0FITRPOY2O` | 0 | 0 | 2026-04-03T00:22:27 | orphan |
| `-BEXU1SJC0QSD` | 37,769 | 23 MB | 2026-04-03T00:34:52 | **active** (CFN-owned) |

All three have DynamoDB Streams enabled. Only the active one is subscribed by `dev-ledger-ctrl-ReducerFnB8BFD8FF-wCVIOafQsvir` ESM.

## Why this exists

Almost certainly CDK stack replacements on 2026-04-03 where the StateTable's `removalPolicy: RETAIN` (default for stateful tables) left old physical resources behind on each redeploy. The 22-min cadence (11:51, 22:27, 34:52) suggests two failed CDK deploys followed by a successful one.

## Impact

- Both orphans are empty → near-zero DDB storage cost.
- Their streams are enabled but no consumer → idle stream cost is also near-zero.
- They are NOT a cause of `ledger-ctrl-resilience-pairwise-timeout` (the reducer ESM points only at the active stream — verified via `list-event-source-mappings`).
- Pure clutter on `list-tables` output and stack-replacement audit logs.

## Cheapest next step

```bash
# Verify nothing references the orphans
AWS_PROFILE=nestfolio-dev aws lambda list-event-source-mappings --region us-east-1 \
  --query 'EventSourceMappings[?contains(EventSourceArn, `JJ1W7PNMGIVY`) || contains(EventSourceArn, `8W0FITRPOY2O`)]'

# Delete (manual, dev only)
AWS_PROFILE=nestfolio-dev aws dynamodb delete-table --region us-east-1 \
  --table-name dev-ledger-ctrl-StateTable962DE04C-JJ1W7PNMGIVY
AWS_PROFILE=nestfolio-dev aws dynamodb delete-table --region us-east-1 \
  --table-name dev-ledger-ctrl-StateTable962DE04C-8W0FITRPOY2O
```

## Dropped (2026-05-29 boundary review)

Aged out. Two empty (0-item) orphan tables with near-zero storage + idle-stream cost, no correctness impact, on a disposable dev account where the sole dev is unaffected by `list-tables` clutter. The trigger conditions (a second service showing the pattern, DDB resource quotas mattering, or a CDK-replacement audit) have not fired and aren't anticipated. The delete commands above remain a 30-second copy-paste if the clutter ever becomes annoying — no need to carry this in the backlog.
