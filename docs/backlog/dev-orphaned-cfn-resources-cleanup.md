---
id: dev-orphaned-cfn-resources-cleanup
status: shipped
closed: 2026-06-15
type: tooling
rank: 1
notes: "Dev account 771924376645 has orphaned CloudFormation-detached resources from past stack replacements. CONFIRMED for broker-ctrl: 7 `dev-broker-ctrl-StateTable962DE04C-*` DynamoDB tables (only `...-1I1HZDP0OPPFH` is active per the deployed ModeIngress TABLE_NAME env) + 5 `dev-broker-ctrl-ModeIngressHandler47F15197-*` Lambdas (only `...-dcOCBjizdJ3A` active). Observed 2026-06-14 while debugging go-live (the sprawl slowed CloudWatch/DDB introspection — couldn't trust list-tables/log-group results). Likely OTHER services have the same orphan pattern (resource replacement with RETAIN deletion policy). Scope: (1) sweep all dev-* stacks for orphaned tables/lambdas/log-groups NOT referenced by their current stack's resources; (2) for each, CONFIRM it is detached from every CFN stack (describe-stack-resources) AND not the SSM-advertised active resource BEFORE deleting; (3) delete orphans (DDB tables are destructive + may be RETAIN'd — verify empty/dead e2e data first); (4) consider why replacements orphaned them (logical-id churn in the cdk-constructs State/Ingress constructs) to prevent recurrence. Queued (user direction 2026-06-14: 'solve just after this one') — own workstream, NOT folded into go-live (it's destructive AWS resource ops, not a code change that merges with the feature branch). Read-only AWS introspection is pre-authorized; the DELETES need explicit care/confirmation per CLAUDE.md."
references: []
out_of_scope:
  - "broker-alpaca-adpt/src/clients/alpaca.client.ts runtime live-Alpaca prefix gate (LIVE_ALLOWED_PREFIXES) — RUNTIME code, not synth-time CDK; cannot use the synth-time ServiceStack `production` prop. Left as-is, flagged."
  - "Logical-ID stabilization / renaming of constructs — recurrence is prevented by env-aware removalPolicy (DESTROY on non-prod), NOT by freezing logical IDs."
  - "The one-time orphaning of the existing /aws/lambda/* auto-created log groups caused by the logRetention->explicit-logGroup migration is handled by a single post-deploy re-sweep, not by avoiding the migration."
spec: null
plan: null
topic_memory: []
validation_gate: "Shipped 2026-06-15 (worktree worktree-dev-orphan-cleanup-retention). PART A (cleanup, dev acct 771924376645): deleted 27 orphan DynamoDB tables (incl. the 21k-item dev-advisory-ctrl-StateTable...-1NAWSOS36ZR4T from removed advisory-ctrl) + 73 orphan log groups (72 /aws/lambda + 1 SF heal); verified 23 active tables intact, 0 orphan LGs. Recompute-then-delete with count assertions (caught a zsh word-split bug pre-delete). PART B (prevention, commits 58cee99a + e638304e): cdk-constructs env-aware retention — `production` flag (isProductionPrefix single source; ServiceStackProps.production + ServiceStack.production/productionOf; resolvePipelineConfig.production); NonProdAutoDeleteAspect (DESTROY on DynamoDB tables + CFN log groups when !production); ManagedNodejsFunction (explicit CFN LogGroup, retention 90d, replaces logRetention) across Ingress/Egress/Broadcaster + 17 inline service stacks; KB/mfe-bucket/investor-web env-aware via production. VALIDATION: nx test 33 affected projects PASS + lint 0 errors; cdk-constructs 359 unit tests (+8 new: production flag, Aspect tables+LGs prod-vs-nonprod, ManagedNodejsFunction LogGroup); real synth prefix=dev → Delete (table+4 LGs, Custom::LogRetention=0, all Lambdas LoggingConfig), prefix=prod → Retain; deployed ALL 32 stacks (deploy-all exit 0); canary ledger-ctrl verified on live stack; post-deploy re-sweep deleted 97 one-time migration-orphaned /aws/lambda groups (0 remain, guarded by live-function-target check); service-card-drift gate taught to detect ManagedNodejsFunction (card-drift OK 0 drift, gate test 26/26). OUT OF SCOPE: alpaca.client.ts runtime live-gate (not synth-time). Branch merged to main."
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
