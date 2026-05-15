---
id: accept-decision-e2e-getportfolio-empty-flake
status: queued
rank: 1
type: bug
notes: "Two compounding ledger-ctrl bugs: (1) 100% failure rate on simulated ORDER_FILLED writes (DocumentClient marshaller rejects quantity:undefined); (2) ledger-ctrl Egress + ledger-bff Ingress chain dormant — Reducer fires but downstream propagation silent. accept-decision passes ~50% on rerun due to race; deterministic root cause confirmed via CloudWatch."
references:
  - services/ledger/ledger-ctrl/src/handlers/event-listener.ts
  - services/ledger/ledger-ctrl/src/repositories
  - services/ledger/ledger-bff/src/handlers
  - apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts
out_of_scope:
  - "Operating-mode envelope tuning / agent prompt tuning (unrelated chain)"
  - "Test-side polling refactors (test-infrastructure-polling-audit covers this)"
  - "Broker-alpaca-adpt resilience tests (separate parking item)"
  - "Replacing the AppSync data-source for getPortfolio (cheapest fix is to make the underlying chain work, not to bypass it)"
spec: null
plan: null
topic_memory: [project_e2e_feature_tests.md, project_event_wiring_gaps.md]
validation_gate: null
---

# Ledger-ctrl ORDER_FILLED write + Egress chain — deterministic bugs surfacing as accept-decision flake

## What surfaced

E2e gate full run 2026-05-15 (after the AssemblePacket fix shipped): **32/33 pass, only `accept-decision.e2e.test.ts` scenario 6 red.** Isolated rerun of the same file 5 minutes later PASSED in 110s. Per `feedback_flake_means_broken`, that's not "moving on" — it means the system fails sometimes and we need to know why.

## Evidence (CloudWatch, dev account 771924376645, 2026-05-15)

### Bug 1 — 100% failure rate on simulated ORDER_FILLED writes

`/aws/lambda/dev-ledger-ctrl-IngressHandler75095446-6klr79C6tQxk` for the last 3h:

| streamType | total `Vn.putIfNotExists` calls | failed | failure rate |
|---|---|---|---|
| `actual` (test-published / real broker fills, has `quantity`) | 26 | 1 | 3.8% |
| `simulated` (broker-sim adapter outputs, `quantity: undefined`) | 279 | **279** | **100%** |

Sample error (every simulated call):

```
ERROR Vn.putIfNotExists threw
error.name: "Error"
error.message: "Pass options.removeUndefinedValues=true to remove undefined values from map/array/set."
stack:
  at convertToAttr (/var/runtime/node_modules/@aws-sdk/util-dynamodb/dist-cjs/index.js:101:11)
  at marshall (/var/runtime/node_modules/@aws-sdk/util-dynamodb/dist-cjs/index.js:313:26)
  at marshallFunc (/var/runtime/node_modules/@aws-sdk/lib-dynamodb/dist-cjs/index.js:131:97)
```

The simulated broker payload omits `quantity` (only `orderId`, `symbol`, `side`, `fillPrice`, `filledAt`). The Ingress handler builds a LedgerEntry where `payload.quantity` is `undefined`. The `DynamoDBDocumentClient` is constructed without `marshallOptions: { removeUndefinedValues: true }`, so every simulated write throws.

### Bug 2 — ledger-ctrl Egress + ledger-bff Ingress chain dormant

For accept-decision tenant `e2e-1778850023248-1a796a50` (failing-run, 13:00:51 UTC):

- `dev-ledger-ctrl-IngressHandler` `Vn.putIfNotExists called` for VTI/quantity:10/actual → **SUCCEEDED** (`req=7450e467-…`, not in error list).
- `dev-ledger-ctrl-ReducerFn` `Snapshot updated` v1 @ 13:00:52 + v2 @ 13:00:57 → **fired**.
- `dev-ledger-ctrl-EgressPublisher` events for that tenant: **0**.
- `dev-ledger-bff-IngressHandler` events for that tenant: **0** (5 generic START/WARN events in 3h total, none matching either tenant).

Same picture for the passing-rerun tenant `e2e-1778858960043-4893f69f` (15:29:20 UTC): write OK, Reducer fired, Egress + BFF Ingress silent. Yet `getPortfolio` returned a populated VTI position. The BFF resolver must be reading something other than its own DDB read model — either querying the ledger-ctrl Snapshot table directly or another data path. Either way, the BFF Ingress + Egress chain is not delivering ORDER_FILLED propagation.

Ledger Lambda deploy timestamps:

```
dev-ledger-ctrl-IngressHandler75095446-6klr79C6tQxk  2026-04-25T21:24:43Z
dev-ledger-ctrl-ReducerFnB8BFD8FF-wCVIOafQsvir       2026-04-25T21:24:44Z
dev-ledger-ctrl-EgressPublisherDB741A6E-Cc0tu3vMTJWD 2026-04-25T21:24:43Z
dev-ledger-bff-IngressHandler75095446-Nz25LMlYoTbA   2026-04-25T21:24:31Z
dev-ledger-bff-GraphqlResolver5CC3A7EB-AIjEdpctUWey  2026-04-25T21:24:31Z
```

All 20 days old — same deploy-skew category as the advisory deploy-skew already addressed. May or may not contain a separately-introduced bug; need to confirm whether source on `main` has the same `marshall undefined` issue.

## Why accept-decision passes sometimes

The failing-run's test publish DID write to DDB successfully (the test's `actual`-stream payload has `quantity: 10` defined). Reducer DID update the Snapshot. So the visible-from-`getPortfolio` data WAS present in the system. But the GraphQL resolver returned `positions: []` for 120s. The intermittency is in the resolver's view of the data — either eventual-consistency on the read source, or the resolver pulling from a stale snapshot index, or the BFF DDB read model never getting updated and only happening to surface old data on the rerun.

Until Bug 2 is closed, accept-decision will fail roughly whenever the resolver's source-of-truth lags by more than 120s. That can be triggered by full-suite contention (every neighbouring test hammering the same DDB tables and streams) and absent in isolated reruns.

## Cheapest next step

1. **Read** `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` and the DynamoDB client construction in `services/ledger/ledger-ctrl/src/repositories/` to confirm `marshallOptions.removeUndefinedValues` is absent (or set to false). Same for `services/ledger/ledger-ctrl/src/repositories` writers.
2. **Read** the ledger-ctrl `service.stack.ts` Egress event-type map to confirm what (if anything) is emitted on `LedgerEntry:INSERT` and `Snapshot:MODIFY`. Compare to what ledger-bff Ingress subscribes to in `services/ledger/ledger-bff/src/service.stack.ts`.
3. **Read** the ledger-bff `getPortfolio` GraphQL resolver source to identify what data store / index it reads. That tells us whether Bug 2's BFF-side silence actually breaks the query, or whether the resolver reads ledger-ctrl directly (in which case Bug 2 is "dead-but-not-broken" for this test, and the accept-decision intermittency is a different downstream race).
4. **Redeploy** ledger services to dev once a fix is identified — last deploy is 20 days old, may close part of the issue without code changes.

## Related

- Topic memory: [project_e2e_feature_tests](../../memory/project_e2e_feature_tests.md) (scenario 6 was baseline GREEN), [project_event_wiring_gaps](../../memory/project_event_wiring_gaps.md).
- Adjacent shipped work: [[e2e-advisory-pipeline-empty-outputs-post-phase-b]] (2026-05-15) — same pattern of compounding deploy-skew + consumer-side schema mismatch as today's advisory fix, just on the ledger side this time.
- This dossier was originally filed as parking 2026-05-15 with the label "flake" — promoted to QUEUED rank 1 after CloudWatch evidence revealed deterministic root causes per `feedback_flake_means_broken`.
