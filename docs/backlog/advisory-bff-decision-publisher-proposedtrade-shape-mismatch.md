---
id: advisory-bff-decision-publisher-proposedtrade-shape-mismatch
status: parking
type: refactor
notes: "advisory-bff integration fixtures send a {symbol,action,quantity} trade shape that doesn't match ProposedTradeInput, so decision-publisher's broadcast silently fails in-test (DDB-row asserts stay green) → zero live-push coverage for decision rows. Production is FINE (real producer emits the correct shape). Test-quality gap, not a prod bug."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: untyped-fixture-contract-drift
epic_role: core
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

**RESOLVED (2026-06-04): production is fine — this is a test-fixture-quality gap, not a prod bug.**
The real DECISION_PACKET row is written by `AssembleDecisionPacket`
(`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:145-160`), which
builds each trade as `{ symbol, assetClass, side: 'BUY'|'SELL', quantityOrAmountCents,
targetWeightPercent, rationale }` — an EXACT match for `ProposedTradeInput` (all 6 fields,
correct names + types). So the production decision-publisher broadcast succeeds and
`/advisory` live-push works. Only the integration **test fixtures** use the malformed
`{ symbol, action, quantity }` shorthand.

**Why this stays parking (not queued):** the broadcast failure is confined to the
integration TEST (which asserts only the DDB row), and the e2e/integration suites are green
today — production is correct. Per the [[feedback-e2e-gaps-queued-not-parking]] litmus
(does it affect whether the suite passes today? no → parking), this is a coverage gap, not
an e2e blocker.

**Fix (when picked up):** change the advisory-bff integration fixtures
(`test/integration/advisory-bff.integration.test.ts`, ~8 trade literals) from
`{ symbol, action, quantity }` to the real `ProposedTradeInput` shape
(`{ symbol, assetClass, side, quantityOrAmountCents, targetWeightPercent, rationale }`).
This makes the decision-publisher broadcast actually succeed in-test, giving the live-push
path real coverage instead of a silently-swallowed failure. Optionally add a positive
assertion (a `wss-subscription` trap, see [[wss-subscription-test-harness-test-support]])
so a future broadcast regression is caught rather than silent.
