# decision-workflow-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/decision-workflow-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds:
  - DecisionPacket + AgentOutput rows (existing).
  - MandateSnapshot row (added 2026-05-10) — service-private projection, pk=`MandateSnapshot#{tenantId}#{userId}`, sk='MandateSnapshot', carries operatingMode + level + status. Read by the SF via Direct DDB GetItem.
  - InvestorProfileSnapshot row (added by SnapshotProjectorIngress — precomputation Task 8). DWC-local mirror of IP-ctrl's snapshot, pk=`InvestorProfileSnapshot#{tenantId}#{userId}`, sk='InvestorProfileSnapshot'. Read by the SF via Direct DDB GetItem so PE/AN don't need cross-service grants.
  - MarketSnapshot row (added by SnapshotProjectorIngress — precomputation Task 8). DWC-local mirror of MI-ctrl's snapshot, pk=`MarketSnapshot#{region}`, sk='MarketSnapshot'. Read by the SF via Direct DDB GetItem.
  - LedgerSnapshot row (added by SnapshotProjectorIngress). DWC-local mirror of the ledger's per-tenant positions + cashBalanceCents,
    pk=`LedgerSnapshot#{tenantId}`, sk='LedgerSnapshot'. `state` is JSON-stringified to mirror IP/Market projections so the SF parses
    via `States.StringToJson` on read. Used by AssemblePacket to compute portfolioValueCents + delta-based proposedTrades.

## Ingress (3 ingresses)
- CallbackIngress: advisoryBus → decision-workflow-ctrl-callback-ingress (SQS → Lambda: sfn-callback.ts)
  Subscriptions: PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, PORTFOLIO_FAILED, NARRATIVE_FAILED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED
  Note: post-precomputation, IP and MI no longer emit completion events (they precompute snapshots). PE + AN are the only services that resume the SF via callbacks; failure events are added so failures resume the SF via SendTaskFailure (Task 10).

- MandateProjectorIngress: advisoryBus → decision-workflow-ctrl-mandate-projector-ingress (SQS → Lambda: mandate-projector.ts)
  Subscriptions: MANDATE_ISSUED, OPERATING_MODE_CHANGED
  Materializes a service-private MandateSnapshot row so the SF can resolve operatingMode for ALL triggers via a single Direct DDB GetItem (no Lambda, no Choice branch).

- SnapshotProjectorIngress: advisoryBus → decision-workflow-ctrl-snapshot-projector-ingress (SQS → Lambda: snapshot-projector.ts) — added Task 8
  Subscriptions: INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED, MARKET_SNAPSHOT_UPDATED, PORTFOLIO_UPDATED
  Materializes DWC-local InvestorProfileSnapshot + MarketSnapshot rows so the SF reads pre-computed agent outputs via Direct DDB GetItem (no Lambda).
  errorEventType: SNAPSHOT_PROJECTION_FAILED

## Egress
- CDC: DynamoDB Streams → decision-workflow-ctrl-egress (Lambda)
  Emits:
  - DecisionPacket → DECISION_PACKET_CREATED (insert), DECISION_PACKET_UPDATED (modify)
  - AgentOutput → AGENT_OUTPUT_CREATED (insert), AGENT_OUTPUT_UPDATED (modify)
  - MandateSnapshot → MANDATE_SNAPSHOT_CREATED (insert only — operatingMode changes do NOT re-trigger the first decision)
  Note: InvestorProfileSnapshot + MarketSnapshot projected rows are NOT in the Egress map — they are read by the SF only.

## Orchestration (Direct EB → SF, precomputation rewrite — Task 9)
- DecisionStateMachine: Step Functions state machine (72h timeout). Started directly by EB Rule on the 7 trigger events (declarative `Orchestration.triggers`). No TriggerIngress.
- State shape:
  1. **UnpackTriggerEnvelope** (Pass) — flattens {subject.decisionId, subject.tenantId, context.userId, context.region} to top-level SF state so every putEvents task state can emit the event-processor envelope. Exposes `triggerContext.$: '$.subject'` so downstream states can read the raw trigger payload.
  2. **ResolveTriggerAmountCents** (Choice) — `isPresent('$.triggerContext.amountCents')` routes to `SetTriggerAmountCentsFromTrigger` (Pass projecting `{value: $.triggerContext.amountCents}` to `$.triggerAmountCentsContainer`) on hit, `SetTriggerAmountCentsZero` (Pass injecting `{value: 0}` to the same path) on miss. Container shape required because `Pass.parameters` yields an object; downstream forwarders read `$.triggerAmountCentsContainer.value` and `AssembleDecisionPacket` payload extracts the scalar. Added 2026-05-25 (decision-pipeline-units-calibration-suitability workstream): bare `$.subject.amountCents` JSONPath raised uncatchable `States.Runtime` on non-deposit triggers (MANDATE_SNAPSHOT_CREATED + INVESTOR_PROFILE_UPDATED + PORTFOLIO_DRIFT_DETECTED + ORDER_*). AssemblePacket Lambda handles `triggerAmountCents=0` via `?? 0`.
  3. **ParallelProjections** (Parallel) — two branches:
     - Branch A: **ResolveInvestorProfile** (Choice) — when the trigger payload carries an InvestorProfile body, hoist it; otherwise **LookupInvestorProfileSnapshot** (DDB GetItem, captures raw response on `$.investorProfileSnapshotResponse`) → **CheckInvestorProfileSnapshotPresent** (Choice on `isPresent($.investorProfileSnapshotResponse.Item.agentOutput.S)`) → **ExtractInvestorProfileSnapshot** (Pass, parses the JSON-string agentOutput via `States.StringToJson`) on hit, or **HandleMissingInvestorProfileSnapshot** (Pass, seeds `{ agentOutput: {} }`) on miss. The tighter predicate (`agentOutput.S` rather than just `Item`) routes rows missing the field to the seed-empty path rather than raising uncatchable `States.Runtime` from `States.StringToJson(undefined)`. PE+AN tolerate empty `investorProfile` via `?? {}` so absent snapshot degrades the decision rather than aborting the cycle.
     - Branch B: **LookupMarketSnapshot** (DDB GetItem, captures raw response on `$.marketSnapshotResponse`) → **CheckMarketSnapshotPresent** (Choice on `isPresent($.marketSnapshotResponse.Item.agentOutput.S)`) → **ExtractMarketSnapshot** (Pass, parses the JSON-string agentOutput via `States.StringToJson`) on hit, or **HandleMissingMarketSnapshot** (Pass, seeds `{ agentOutput: {} }`) on miss. The tighter predicate (`agentOutput.S` rather than just `Item`) routes rows missing the field to the seed-empty path rather than raising uncatchable `States.Runtime` from `States.StringToJson(undefined)`. PE+AN tolerate empty marketAnalysis via `?? {}` so absent market context degrades the decision rather than aborting the cycle. No payload-first path (market signals are a global projection).
  4. **MergeProjections** (Pass) — joins the two branches.
  5. **ResolveMandateSnapshot** (Choice) — when the trigger payload carries an operatingMode hint, hoist; otherwise **LookupMandateSnapshot** (DDB GetItem) + **SetInvestorProfile** (Pass).
  6. PE + AN waitForTaskToken steps with explicit TimeoutSeconds = AGENT_BUDGETS.{PORTFOLIO_ENGINE,ADVISORY_NARRATIVE}_UX_SEC (120s each). PE+AN service stacks consume the same constants via `@nestfolio/decision-workflow-ctrl/agent-budgets` so the SF deadline + Lambda timeout + SQS visibility stay synchronised — the agentProfile() helper asserts the invariant at synth time. SendTaskSuccess on AgentCompletion CDC, SendTaskFailure on AgentFailure CDC.
  7. **AssembleDecisionPacket** (CustomState invoking AssemblePacket Lambda, ResultPath=DISCARD to preserve userId/region through compliance + user-confirm phases). Lambda payload includes `triggerAmountCents.$: '$.triggerAmountCentsContainer.value'`; Lambda returns `portfolioValueCents`, `isInitialBuild`, `riskCategory` (replaces legacy `portfolioValue` + `riskScore`).
  8. **WaitForCompliance** (CustomState, putEvents.waitForTaskToken) — emits RECOMMENDATION_PROPOSED with `subject.{portfolioValueCents, isInitialBuild, riskCategory, currentPositions, proposedTrades}` (post-2026-05-25 contract). Awaits compliance callback via CallbackIngress.
- Callback access granted to CallbackIngress handler via `orchestration.grantCallbackAccess(callbackIngress.handler)`.
- Auto-named executions (no executionName field — AWS doesn't expose per-target Name for the native EB→SF integration). At-least-once redelivery risk is theoretical and unobserved post-collapse.

## Standalone Lambdas
- AssemblePacket: Reads all 4 agent outputs from the SF Parameters payload (post-Phase-A 2026-05-14 — no AgentCore Memory reads, no eventual-consistency retry loop). Persists DecisionPacket row with explanation + proposedTrades. Returns to SF state via ResultSelector: `proposedTrades`, `currentPositions`, `portfolioValueCents`, `isInitialBuild`, `riskCategory` (replaces the legacy `portfolioValue` + `riskScore` shape; canonical-cents quantities, isInitialBuild from `currentPositions.length === 0`, riskCategory from investorProfile snapshot).

## Handlers
- sfn-callback.ts — CallbackIngress handler. On PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED → SendTaskSuccess; on PORTFOLIO_FAILED / NARRATIVE_FAILED → SendTaskFailure; also writes AgentOutput records on agent completions; updates DecisionPacket status on compliance + user response events.
- mandate-projector.ts — MandateProjectorIngress handler (materializeToTable). MANDATE_ISSUED → record() with operatingMode + level + status='ACTIVE'; OPERATING_MODE_CHANGED → update() patching operatingMode.
- snapshot-projector.ts — SnapshotProjectorIngress handler (materializeToTable). INVESTOR_PROFILE_SNAPSHOT_CREATED → record(InvestorProfileSnapshot); INVESTOR_PROFILE_SNAPSHOT_UPDATED → update(InvestorProfileSnapshot); MARKET_SNAPSHOT_UPDATED → record(MarketSnapshot). Missing subject.agentOutput → NotRetryableError.
- assemble-packet.ts — Assembles decision packet (invoked by SF).
- event-publisher.ts — Egress CDC publisher.

## Event Types (domain/events.ts)
- DecisionWorkflowEventTypes (outbound + routed): DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, DECISION_FEEDBACK, DECISION_WORKFLOW_FAILED, AGENT_OUTPUT_CREATED, AGENT_OUTPUT_UPDATED, MANDATE_SNAPSHOT_CREATED
  Note: USER_CONFIRMATION_REQUESTED removed (Task 1.5). The RequestUserConfirmation SF state now writes the task token directly onto the DecisionPacket DDB row via updateItem.waitForTaskToken; advisory-bff reads the token from the DECISION_PACKET_UPDATED CDC snapshot.
- TRIGGER_EVENT_TYPES (7): MANDATE_SNAPSHOT_CREATED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
- MANDATE_LIFECYCLE_EVENT_TYPES (2): MANDATE_ISSUED, OPERATING_MODE_CHANGED — wired into MandateProjectorIngress
- AGENT_COMPLETION_EVENT_TYPES (post-precomputation — only PE+AN): PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED
- AGENT_FAILURE_EVENT_TYPES (post-precomputation — only PE+AN): PORTFOLIO_FAILED, NARRATIVE_FAILED
- COMPLIANCE_EVENT_TYPES: DECISION_APPROVED, DECISION_BLOCKED
- USER_RESPONSE_EVENT_TYPES: USER_CONFIRMED, USER_REJECTED
- ALL_INBOUND_EVENT_TYPES (CallbackIngress subs): completion + failure + compliance + user-response union.

Removed (Task 11): ANALYZE_INVESTOR_PROFILE, ANALYZE_MARKET, INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED.

## IAM trace
- DDB ReadData on local State table → granted to the SF role (LookupMandateSnapshot + LookupMarketSnapshot + InvestorProfileSnapshot reads).
- DDB Write granted to AssemblePacket Lambda (persists DecisionPacket).
- PutEvents granted to the SF role (emits CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, etc.).
- **`states:SendTaskSuccess` + `states:SendTaskFailure`: granted to CallbackIngress only** — DWC is the sole holder of SF callback IAM in the workspace (asserted by Task 12's invariant test).
- AgentCore Memory: 3 long-term MemoryStrategies (InvestorPreferenceLearner, MarketSignalExtractor, RationaleArchivist) — Bedrock InvokeModel granted to the Memory execution role for cross-region Haiku inference profile. RationaleArchivist uses namespace /shared-rationale/{actorId}/rationale, shared by portfolio-engine-ctrl + advisory-narrative-ctrl.

## Tests
- test/unit/assemble-packet.test.ts
- test/unit/decision-packet.repository.test.ts
- test/unit/decision-state-machine.test.ts
- test/unit/mandate-projector.test.ts
- test/unit/mandate-snapshot.repository.test.ts
- test/unit/service.stack.test.ts
- test/unit/sfn-callback.test.ts
- test/unit/snapshot-projector.test.ts (Task 8)
- test/integration/decision-workflow-ctrl.integration.test.ts
- test/integration/decision-workflow-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, utils), event-processor, event-types
- Cross-service event-type imports: investor-profile-ctrl (INVESTOR_PROFILE_SNAPSHOT_*), market-intelligence-ctrl (MARKET_SNAPSHOT_UPDATED), investor-bff (MANDATE_ISSUED, OPERATING_MODE_CHANGED)
- SSM: advisory-hub (models/haiku)
- CDK alpha: @aws-cdk/aws-bedrock-agentcore-alpha, @aws-cdk/aws-bedrock-alpha

## Exports (package subpaths)
- `./events` — domain event types.
- `./agent-budgets` — `AGENT_BUDGETS` constants (PE+AN UX budgets, shared with the agent service stacks).
