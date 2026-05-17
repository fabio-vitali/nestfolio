# decision-workflow-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/decision-workflow-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Holds:
  - DecisionPacket + AgentOutput rows (existing).
  - MandateSnapshot row (added 2026-05-10) — service-private projection, pk=`MandateSnapshot#{tenantId}#{userId}`, sk='MandateSnapshot', carries operatingMode + level + status. Read by the SF via Direct DDB GetItem.
  - InvestorProfileSnapshot row (added by SnapshotProjectorIngress — precomputation Task 8). DWC-local mirror of IP-ctrl's snapshot, pk=`InvestorProfileSnapshot#{tenantId}#{userId}`, sk='InvestorProfileSnapshot'. Read by the SF via Direct DDB GetItem so PE/AN don't need cross-service grants.
  - MarketSnapshot row (added by SnapshotProjectorIngress — precomputation Task 8). DWC-local mirror of MI-ctrl's snapshot, pk=`MarketSnapshot#{region}`, sk='MarketSnapshot'. Read by the SF via Direct DDB GetItem.

## Ingress (3 ingresses)
- CallbackIngress: advisoryBus → decision-workflow-ctrl-callback-ingress (SQS → Lambda: sfn-callback.ts)
  Subscriptions: PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, PORTFOLIO_FAILED, NARRATIVE_FAILED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED
  Note: post-precomputation, IP and MI no longer emit completion events (they precompute snapshots). PE + AN are the only services that resume the SF via callbacks; failure events are added so failures resume the SF via SendTaskFailure (Task 10).

- MandateProjectorIngress: advisoryBus → decision-workflow-ctrl-mandate-projector-ingress (SQS → Lambda: mandate-projector.ts)
  Subscriptions: MANDATE_ISSUED, OPERATING_MODE_CHANGED
  Materializes a service-private MandateSnapshot row so the SF can resolve operatingMode for ALL triggers via a single Direct DDB GetItem (no Lambda, no Choice branch).

- SnapshotProjectorIngress: advisoryBus → decision-workflow-ctrl-snapshot-projector-ingress (SQS → Lambda: snapshot-projector.ts) — added Task 8
  Subscriptions: INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED, MARKET_SNAPSHOT_UPDATED
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
  1. **UnpackTriggerEnvelope** (Pass) — flattens {subject.decisionId, subject.tenantId, context.userId, context.region} to top-level SF state so every putEvents task state can emit the event-processor envelope.
  2. **ParallelProjections** (Parallel) — two branches:
     - Branch A: **ResolveInvestorProfile** (Choice) — when the trigger payload carries an InvestorProfile body, hoist it; otherwise read the DWC-local InvestorProfileSnapshot via Direct DDB GetItem (payload-first → projection-fallback).
     - Branch B: **LookupMarketSnapshot** (DDB GetItem) — always reads MarketSnapshot for the region; market signals are a global projection so there's no payload-first path.
  3. **MergeProjections** (Pass) — joins the two branches.
  4. **ResolveMandateSnapshot** (Choice) — when the trigger payload carries an operatingMode hint, hoist; otherwise **LookupMandateSnapshot** (DDB GetItem) + **SetInvestorProfile** (Pass).
  5. PE + AN waitForTaskToken steps (SendTaskSuccess on AgentCompletion CDC, SendTaskFailure on AgentFailure CDC).
  6. **AssembleDecisionPacket** (CustomState invoking AssemblePacket Lambda, ResultPath=DISCARD to preserve userId/region through compliance + user-confirm phases).
- Callback access granted to CallbackIngress handler via `orchestration.grantCallbackAccess(callbackIngress.handler)`.
- Auto-named executions (no executionName field — AWS doesn't expose per-target Name for the native EB→SF integration). At-least-once redelivery risk is theoretical and unobserved post-collapse.

## Standalone Lambdas
- AssemblePacket: Reads all 4 agent outputs from the SF Parameters payload (post-Phase-A 2026-05-14 — no AgentCore Memory reads, no eventual-consistency retry loop). Persists DecisionPacket row with explanation + proposedTrades.

## Handlers
- sfn-callback.ts — CallbackIngress handler. On PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED → SendTaskSuccess; on PORTFOLIO_FAILED / NARRATIVE_FAILED → SendTaskFailure; also writes AgentOutput records on agent completions; updates DecisionPacket status on compliance + user response events.
- mandate-projector.ts — MandateProjectorIngress handler (materializeToTable). MANDATE_ISSUED → record() with operatingMode + level + status='ACTIVE'; OPERATING_MODE_CHANGED → update() patching operatingMode.
- snapshot-projector.ts — SnapshotProjectorIngress handler (materializeToTable). INVESTOR_PROFILE_SNAPSHOT_CREATED → record(InvestorProfileSnapshot); INVESTOR_PROFILE_SNAPSHOT_UPDATED → update(InvestorProfileSnapshot); MARKET_SNAPSHOT_UPDATED → record(MarketSnapshot). Missing subject.agentOutput → NotRetryableError.
- assemble-packet.ts — Assembles decision packet (invoked by SF).
- event-publisher.ts — Egress CDC publisher.

## Event Types (domain/events.ts)
- DecisionWorkflowEventTypes (outbound + routed): DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE, RECOMMENDATION_PROPOSED, USER_CONFIRMATION_REQUESTED, DECISION_FEEDBACK, DECISION_WORKFLOW_FAILED, AGENT_OUTPUT_CREATED, AGENT_OUTPUT_UPDATED, MANDATE_SNAPSHOT_CREATED
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
- AgentCore Memory: 4 long-term MemoryStrategies (InvestorPreferenceLearner, MarketSignalExtractor, PortfolioRationaleArchivist, NarrativeRationaleArchivist) — Bedrock InvokeModel granted to the Memory execution role for cross-region Haiku inference profile.

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
