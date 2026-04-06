# Integration Test Issues

> Running log of issues discovered during all-services integration test implementation.
> Started: 2026-04-06

---

### Issue #1: SQS KMS encryption blocks EB→SQS delivery
- **Service:** compliance-ctrl, execution-ctrl (and likely other services deployed 2026-04-03)
- **Category:** bug
- **Description:** Services deployed on April 3 (CREATE_COMPLETE, never updated) have Ingress SQS queues using `alias/aws/sqs` KMS encryption instead of SSE-SQS (`SqsManagedSseEnabled: true`). EventBridge cannot deliver to KMS-encrypted SQS queues without explicit key grants. CDK code specifies `QueueEncryption.SQS_MANAGED` but the deployed queue has the old KMS key.
- **Resolution:** Redeploy affected services (`pnpm nx deploy <service> -- --prefix dev`). compliance-ctrl redeployed and verified working. execution-ctrl needs redeploy.
- **Affected services:** Any service deployed on April 3 that hasn't been redeployed: check execution-ctrl, ledger-ctrl, reconciliation-ctrl, broker-sim-adpt, broker-ctrl, advisory-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, decision-workflow-ctrl, all BFFs, all data-feed adapters

### Issue #2: DynamoDB `__typename` used directly in expressions (syntax error)
- **Service:** execution-ctrl, advisory-ctrl, advisory-bff
- **Category:** bug
- **Description:** `__typename` used directly in `KeyConditionExpression` or `FilterExpression` without expression attribute name placeholders. DynamoDB parser treats double underscore as syntax error: `"Invalid KeyConditionExpression: Syntax error; token: \"_\", near: \"AND __\""`. Must use `#typ` placeholder with `ExpressionAttributeNames: { '#typ': '__typename' }`.
- **Resolution:** Fixed in all 3 services + unit test. Redeploy needed for execution-ctrl and advisory-ctrl.
- **Affected services:** execution-ctrl (order.repository.ts:110), advisory-ctrl (tools/portfolio-lookup.ts:17), advisory-bff (advisory.repository.ts:77,112). Grepped all services — no other instances found.

### Issue #3: Async/await missing on `withMethodLogging`-wrapped methods
- **Service:** reconciliation-ctrl
- **Category:** bug
- **Description:** `reconcileHandler` and `alpacaSnapshotHandler` in event-listener.ts called `reconciliationService.reconcile()` synchronously, but `withMethodLogging` wraps methods as async. The call returns a Promise instead of a result, so `result.status` and `result.drifts` are `undefined`. This causes a silent TypeError collected as a retryable batch item failure with no DDB write.
- **Resolution:** Fixed by making both handlers `async` and `await`-ing the reconcile call. Redeployed.
- **Affected services:** reconciliation-ctrl. Any other service using `withMethodLogging`-wrapped methods called synchronously may have the same issue.

### Issue #4: ledger-ctrl CDC requires Reducer pre-existing state
- **Service:** ledger-ctrl
- **Category:** inconsistency
- **Description:** ledger-ctrl has a two-hop CDC chain: Ingress writes `LedgerEntry` → Reducer materializes `BalanceEvent`/`PortfolioEvent`/`LedgerEntryEvent` → CDC emits events. For fresh integration test tenants with no prior state, the Reducer finds "No new events to reduce" and writes nothing → no CDC event.
- **Resolution:** Used `TableAssertions` instead of `EventBusTrap` to verify the DDB `LedgerEntry` write directly. Full CDC chain test deferred until account seeding fixture exists.
- **Affected services:** Any service with a Reducer or materialization step in the CDC chain.

