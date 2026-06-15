---
id: dev-orphaned-cfn-resources-cleanup
status: queued
type: tooling
rank: 1
notes: "Dev account 771924376645 has orphaned CloudFormation-detached resources from past stack replacements. CONFIRMED for broker-ctrl: 7 `dev-broker-ctrl-StateTable962DE04C-*` DynamoDB tables (only `...-1I1HZDP0OPPFH` is active per the deployed ModeIngress TABLE_NAME env) + 5 `dev-broker-ctrl-ModeIngressHandler47F15197-*` Lambdas (only `...-dcOCBjizdJ3A` active). Observed 2026-06-14 while debugging go-live (the sprawl slowed CloudWatch/DDB introspection — couldn't trust list-tables/log-group results). Likely OTHER services have the same orphan pattern (resource replacement with RETAIN deletion policy). Scope: (1) sweep all dev-* stacks for orphaned tables/lambdas/log-groups NOT referenced by their current stack's resources; (2) for each, CONFIRM it is detached from every CFN stack (describe-stack-resources) AND not the SSM-advertised active resource BEFORE deleting; (3) delete orphans (DDB tables are destructive + may be RETAIN'd — verify empty/dead e2e data first); (4) consider why replacements orphaned them (logical-id churn in the cdk-constructs State/Ingress constructs) to prevent recurrence. Queued (user direction 2026-06-14: 'solve just after this one') — own workstream, NOT folded into go-live (it's destructive AWS resource ops, not a code change that merges with the feature branch). Read-only AWS introspection is pre-authorized; the DELETES need explicit care/confirmation per CLAUDE.md."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Clean up orphaned dev CloudFormation resources (broker-ctrl confirmed; sweep all)

## Evidence (observed 2026-06-14 during go-live debugging)

`aws dynamodb list-tables` → **7** `dev-broker-ctrl-StateTable962DE04C-*` tables; the deployed
`dev-broker-ctrl-ModeIngressHandler47F15197-dcOCBjizdJ3A` Lambda's `TABLE_NAME` env points at exactly one
(`...-1I1HZDP0OPPFH`). The other 6 are orphans. Similarly **5** `dev-broker-ctrl-ModeIngressHandler*`
Lambdas + their log groups exist; only one is in the active `dev-broker-ctrl` stack.

This sprawl actively impeded debugging (every `list-tables`/`describe-log-groups` returned a tab-separated
blob; had to resolve the active resource via CFN stack resources + Lambda env each time).

## Plan (own workstream)

1. For each `dev-*` service stack: `describe-stack-resources` → the SET of resource physical IDs the
   stack currently owns. Anything matching the service's resource naming but NOT in that set is an orphan.
2. Cross-check the SSM-advertised active table/url per service (the e2e + runtime resolve via SSM).
3. Delete confirmed orphans. DynamoDB table deletion is destructive — verify each orphan holds only dead
   e2e/test data (or is empty) first. Watch for `DeletionPolicy: RETAIN` (likely why they orphaned).
4. Root cause: identify the logical-ID churn in `State`/`Ingress`/CDC constructs that triggered table +
   lambda replacement (so future deploys don't keep orphaning), and decide whether to stabilize logical IDs.

## Why its own workstream (not folded into go-live)

Destructive AWS resource ops, unrelated to go-live's code, and not a change that merges with the feature
branch. Queued rank 1 per user direction ("solve just after this one"), 2026-06-14.
