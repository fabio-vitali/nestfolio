---
id: advisory-cycle-agent-precomputation-impl
status: shipped
type: feature
requires_deploy: true
shipped: 2026-05-17
notes: "Implementation of the advisory-cycle-agent-precomputation design spec. IP+MI exit the per-cycle pipeline (continuous projection). PE+AN refactor to emit *_COMPLETED/*_FAILED via CDC; CallbackIngress becomes sole SF callback caller. SF gains payload-first Choice states for IP and Mandate projection reads."
references:
  - docs/superpowers/specs/2026-05-17-advisory-cycle-agent-precomputation-design.md
  - docs/backlog/advisory-cycle-agent-precomputation.md
  - docs/backlog/agent-pipeline-backlog-trap-architectural.md
  - docs/data-flows/advisory-cycle.md
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts
  - services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts
  - services/advisory/investor-profile-ctrl/CLAUDE.md
  - services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts
  - services/advisory/investor-profile-ctrl/src/service.stack.ts
  - services/advisory/market-intelligence-ctrl/CLAUDE.md
  - services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts
  - services/advisory/market-intelligence-ctrl/src/service.stack.ts
  - services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts
  - services/advisory/portfolio-engine-ctrl/src/service.stack.ts
  - services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts
  - services/advisory/advisory-narrative-ctrl/src/service.stack.ts
  - apps/e2e-feature-tests/src/helpers/fixtures.ts
out_of_scope:
  - "PE+AN as agent runs stay in cycle (only callback transport changes)"
  - "PE+AN queue-trap timing knobs (covered by agent-pipeline-backlog-trap-architectural)"
  - "KB ingestion paths (Regulatory KB, Market KB) — unaffected"
  - "AgentCore Memory namespace changes (Phase-A handoff is correct as designed)"
  - "Authority resolution / operating-mode logic in compliance-ctrl (rule engine unchanged)"
  - "Production rollout sequencing (dev-first; prod posture decided separately)"
  - "Cross-region or multi-region snapshot replication"
  - "Snapshot retention / archival policy"
  - "Compliance + user-confirmation callback paths (already follow target pattern)"
spec: docs/superpowers/specs/2026-05-17-advisory-cycle-agent-precomputation-design.md
plan: docs/superpowers/plans/2026-05-17-advisory-cycle-agent-precomputation-impl.md
topic_memory: []
validation_gate: |
  All 7 validation gates met as of 2026-05-17:
    1. nx affected -t test,lint --base=origin/main → 99/99 tasks green across 50 projects (commit fe74c99b).
    2. Integration tests authored for 5 services (commit 08140a8c); execution against deployed dev exercised via the e2e gate below.
    3. Dev deploy of 5 services successful — investor-profile-ctrl, decision-workflow-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl all UPDATE_COMPLETE.
    4. e2e advisory/first-decision PASS in 128.7s; advisory/rebalance-on-drift PASS in 160.2s on dev sandbox.
    5. Zero ANALYZE_INVESTOR_PROFILE / ANALYZE_MARKET observed in DWC consumer logs post-ship.
    6. Non-zero new event volume verified: 7× PORTFOLIO_COMPLETED + 7× NARRATIVE_COMPLETED handled by DWC CallbackIngress in 30-min post-deploy window; SnapshotProjectorIngress wrote projection rows successfully; 2 DecisionReadModels surfaced in advisory-bff with proposedTrades.
    7. IAM audit: 0 states:SendTask* grants on Ingress roles for IP/MI/PE/AN; DWC CallbackIngressHandler role is the sole holder of states:SendTaskSuccess + SendTaskFailure + SendTaskHeartbeat (Task 12 workspace-wide invariant test asserts this — moved to apps/architecture-tests/ leaf project to avoid graph cycle).

  Surfaced + resolved during deploy validation (not pre-ship):
    - Bedrock AgentCore runtimeSessionId < 33-char rejection (commit 0c3cfed1).
    - Handler return-shape contract mismatch with normalize-handler (commit aa9ea637); resolves parked item `advisory-handler-type-narrowing-debt`.
    - e2e first-decision agent-trace assertions assumed in-cycle IP+MI agents; post-precomputation those run out-of-cycle (commit 293e7c08).
    - withLiveDecision default 90s→120s→180s after observing dev-actual cycle latency at 90-110s.

  Parking items filed during execution:
    - an-ctrl-wrap-agent-output-vestigial (parked 2026-05-17)
    - advisory-handler-type-narrowing-debt (parked 2026-05-17, resolved by commit aa9ea637 — keep parked entry as a postmortem record).
---

# Advisory cycle — agent precomputation + callback symmetry (implementation)

Implementation of the design spec at `docs/superpowers/specs/2026-05-17-advisory-cycle-agent-precomputation-design.md`.

## Scope summary

Three coordinated changes, all in one workstream (atomic cutover per spec § "Chosen approach"):

1. **investor-profile-ctrl repurposed.** Ingress switches from `ANALYZE_INVESTOR_PROFILE` to `INVESTOR_PROFILE_UPDATED` + `MANDATE_ISSUED` + `OPERATING_MODE_CHANGED`. Agent runs on profile changes; writes `InvestorProfileSnapshot` row. Egress declares the snapshot CDC mappings.

2. **market-intelligence-ctrl repurposed.** Ingress drops `ANALYZE_MARKET`. Feed-event subscriptions (already wired for KB ingestion) now also drive agent invocation that merges fast components into `MarketSnapshot`. New `MARKET_SNAPSHOT_REFRESH_TICK` EventBridge schedule rule drives slow-tier rebuilds.

3. **decision-workflow-ctrl SF rewired.** `ParallelProfiling` (InvokeInvestorProfile + InvokeMarketIntelligence) replaced with two parallel `dynamodb:GetItem` Task states. `LookupMandateSnapshot` wrapped in a payload-first Choice. PE+AN states keep `putEvents.waitForTaskToken` shape but no longer get resumed by the agent ctrls directly.

4. **PE+AN callback refactor.** Handler replaces `resumeStateMachine` with standard `ingressPipeline`; emits `record('AgentCompletion', ...)` (success) or `record('AgentFailure', ...)` (caught exception). New row types + Egress mappings produce `PORTFOLIO_COMPLETED`/`PORTFOLIO_FAILED` and `NARRATIVE_COMPLETED`/`NARRATIVE_FAILED`. CallbackIngress subscriptions (already declared for `*_COMPLETED`) activate; new subscriptions added for `*_FAILED`. IAM grants for `states:SendTaskSuccess`/`SendTaskFailure` removed from IP/MI/PE/AN Lambda roles.

5. **E2E fixtures updated.** `onboarded()` waits for `InvestorProfileSnapshot` materialisation. `withLiveDecision()` timeout default drops from 180s to 90s. Deploy script gains a one-time `MarketSnapshot` bootstrap.

## Validation gate (target)

Per the spec's § "Validation gate":

1. `pnpm nx affected -t test,lint --base=origin/main` green (includes CDK snapshot assertion forbidding `states:SendTaskSuccess` outside `decision-workflow-ctrl`)
2. `pnpm nx affected -t test-integration --base=origin/main` green for the 5 affected services
3. Dev deploy of the 5 services completes via `infrastructure/scripts/deploy.sh sandbox --prefix=dev`
4. E2E scenarios `first-decision` + `rebalance-on-drift` pass on dev
5. CloudWatch confirms zero `ANALYZE_INVESTOR_PROFILE`/`ANALYZE_MARKET` events post-ship
6. CloudWatch confirms non-zero `INVESTOR_PROFILE_SNAPSHOT_CREATED`, `MARKET_SNAPSHOT_UPDATED`, `PORTFOLIO_COMPLETED`, `NARRATIVE_COMPLETED` event volume
7. IAM audit: PE/AN/IP/MI Lambda roles show no `states:SendTaskSuccess` / `SendTaskFailure` policy attachments

## Sibling workstream

`agent-pipeline-backlog-trap-architectural` (queued, rank 3) addresses the SF→agent forward-path concurrency knobs for the remaining 2 in-cycle agents (PE+AN). Independent of this work; can ship before or after.
