---
id: advisory-bff-decision-publisher-proposedtrade-shape-mismatch
status: parking
type: bug
notes: "advisory-bff decision-publisher broadcast fails for DECISION_PACKET rows — trade payload shape doesn't match ProposedTradeInput (field-not-defined + NonNull-coerced-null). Pre-existing; surfaced in WS-2 enum-poison check."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-bff decision-publisher broadcast fails for DECISION_PACKET rows (ProposedTradeInput shape mismatch)

Surfaced 2026-06-04 during `advisory-bff-cycle-status-projection` (WS-2) validation: the
DecisionPublisher CloudWatch logs show `postAppSyncMutation: GraphQL errors` for the
DECISION_PACKET integration rows (NOT the new GENERATING/FAILED rows — those broadcast
cleanly, which is what WS-2's enum check confirmed).

**Evidence (CloudWatch `/aws/lambda/dev-advisory-bff-DecisionPublisher…`, 2026-06-04 ~20:45-20:48):**
- `The variables input contains a field that is not defined for input object type 'ProposedTradeInput'`
- `Variable 'proposedTrades' has coerced Null value for NonNull type 'String!'`

**Mechanism:**
- `services/advisory/advisory-bff/src/schema.graphql:117` `input ProposedTradeInput { symbol, assetClass, side: TradeSide!, quantityOrAmountCents: Int!, targetWeightPercent: Float!, rationale: String! }` — all NonNull.
- The advisory-bff integration fixtures (`test/integration/advisory-bff.integration.test.ts`) send `proposedTrades: [{ symbol, action, quantity }]` — `action`/`quantity` are undefined fields and the required `assetClass`/`side`/`quantityOrAmountCents`/`targetWeightPercent`/`rationale` are missing.
- `decision-publisher.ts:91-105` `mapImage` passes `proposedTrades` through verbatim (only `Array.isArray` guard), so the malformed trade reaches `publishDecisionUpdate($proposedTrades: [ProposedTradeInput!]!)` → AppSync rejects → `broadcastFromStream` rethrows (`broadcast-from-stream.ts:52`) → the stream record retries 3× then drops (raw NodejsFunction, no DLQ). Integration tests assert only the DDB row, so they stay green while the broadcast silently fails.
- Pre-existing + identical on `origin/main` (the fixtures predate WS-2; WS-2 only added `GENERATING` to the enum). Orthogonal to the cycle-status work.

**Open question (decides severity):** does the REAL producer break too, or only the test fixtures?
The real DECISION_PACKET row is written by decision-workflow-ctrl `AssembleDecisionPacket`
(`createDecisionPacket`, `decision-packet.repository.ts`). If its `proposedTrades` already
carry the `ProposedTradeInput` shape (`symbol/assetClass/side/quantityOrAmountCents/…`),
then production live-push is fine and this is purely a **test-fixture-quality** issue (fix
the fixtures to the real shape). If the real agent/producer output also diverges from
`ProposedTradeInput`, production `/advisory` live decision updates are silently dropped —
a real bug (the query-refresh path still works, masking it).

**Cheapest next step:** read the proposedTrades shape the real `AssembleDecisionPacket`
Lambda persists (and what the agents emit) → compare to `ProposedTradeInput`. Then either
(a) correct the integration fixtures, or (b) reconcile producer output / `mapImage` /
mutation. If (b) and it turns out to block the advisory Playwright live-push e2e, promote
to QUEUED per [[feedback-e2e-gaps-queued-not-parking]].
