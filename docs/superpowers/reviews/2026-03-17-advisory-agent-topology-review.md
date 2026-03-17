# Review: Advisory Agent Topology Design Spec

**Date:** 2026-03-17
**Verdict:** ISSUES FOUND (7 items, 2 blocking)

---

## BLOCKING

### B1. Step Functions waitForTaskToken + EventBridge: task token delivery gap

The spec says the orchestrator publishes an event (e.g. `ANALYZE_INVESTOR_PROFILE`) carrying a task token, then pauses with `.waitForTaskToken`. The agent service processes the event and publishes a completion event (e.g. `INVESTOR_PROFILE_COMPLETED`) carrying the same task token back.

**Problem:** EventBridge has a 256 KB payload limit, but Step Functions task tokens are ~500-1000 characters. The token must survive a round-trip through two EventBridge publishes. The spec never addresses:
1. Where the task token is stored (in the event payload? in DDB?).
2. How the agent service returns it (in the completion event? via direct `SendTaskSuccess` API call?).
3. What happens if the agent service crashes after processing but before returning the token (the Step Functions execution hangs until timeout).

**Recommendation:** Specify explicitly: (a) the orchestrator's event-listener Lambda calls `sfn.startExecution()` or `sfn.sendTaskSuccess(taskToken)` directly when it receives completion events, (b) the task token is stored in the DecisionPacket DDB row (not passed through EventBridge), and (c) the agent services do NOT need to know about task tokens at all -- they just publish their completion event with the `decisionId`, and the orchestrator's listener looks up the token from DDB. This is the standard pattern.

### B2. Missing DECISION_FEEDBACK event definition

The feedback loop (section on advisory-narrative-ctrl, line 263) says decision-workflow-ctrl publishes `DECISION_FEEDBACK` after user confirmation/rejection. But this event:
- Is NOT listed in decision-workflow-ctrl's output events table (lines 106-116)
- Is NOT listed in advisory-narrative-ctrl's input events table (line 248)
- Does NOT exist in the current `AdvisoryCtrlEventTypes` (events.ts)

**Recommendation:** Add `DECISION_FEEDBACK` to decision-workflow-ctrl output events and advisory-narrative-ctrl input events.

---

## NON-BLOCKING

### N1. Sequential pipeline is overly rigid

The state machine shows a strictly sequential flow: investor-profile -> market-intelligence -> portfolio-engine -> narrative. But the spec itself says investor-profile runs 2 agents "in parallel" and portfolio-engine runs 2 agents "in parallel". The inter-service pipeline could also parallelize:
- investor-profile-ctrl and market-intelligence-ctrl have NO data dependency on each other (both receive only the trigger context).
- Only portfolio-engine-ctrl needs upstream outputs from both.

**Recommendation:** Run steps 1 and 2 as a Parallel state in Step Functions. This halves latency for the first two stages. The spec should explicitly call out which steps depend on which outputs.

### N2. Existing advisory-ctrl events not fully accounted for

The current `AdvisoryCtrlEventTypes` includes 35 event types (incidents, circuit breakers, model lifecycle, shadow runs, budgets, etc.). The spec accounts for only the core decision-lifecycle events. The operational/observability events (INCIDENT_DETECTED, CIRCUIT_BREAKER_TRIGGERED, MODEL_REGISTERED, SHADOW_RUN_*, TENANT_BUDGET_*, etc.) need to be assigned to specific services or a shared operational concern.

**Recommendation:** Add a section mapping each existing AdvisoryCtrlEventType to its new owning service, or explicitly note which events are being retired.

### N3. KB sync latency not addressed

Bedrock KB data source sync is NOT real-time. The `StartIngestionJob` API triggers a batch sync that can take minutes to hours depending on corpus size. The spec implies near-real-time ingestion (e.g., market news every 6 hours feeding into KB before next agent invocation).

**Recommendation:** Document expected sync latency. For the Market Intelligence KB (highest volume, most time-sensitive), consider whether the agent should also receive recent data directly in the prompt context (hybrid RAG + direct injection) rather than relying solely on KB retrieval for very recent content.

### N4. S3 bucket naming uses global namespace

Bucket names like `nestfolio-kb-regulatory` are globally unique in AWS. In a multi-tenant or multi-environment setup, these will collide.

**Recommendation:** Use environment-prefixed names (e.g., `nestfolio-{stage}-kb-regulatory`) or, better, let CDK generate unique names with `removalPolicy` and avoid hardcoding.

### N5. Alpha Vantage free tier rate limit risk

The spec plans ~20 API calls per 12-hour cycle (10 NEWS_SENTIMENT + 5 EARNINGS + 5 ECONOMIC_INDICATORS). The free tier allows 25 requests/day total. Two cycles = 40 requests/day, exceeding the limit. Even one cycle at 20 calls is tight with no room for retries.

**Recommendation:** Reduce to 1 cycle/day or cut to ~10 calls/cycle. Alternatively, note that some endpoints (ECONOMIC_INDICATORS) overlap with FRED data and can be dropped entirely.

---

## MINOR OBSERVATIONS

- The spec says the orchestrator handles "17 inbound event types" in the infrastructure section (line 120), but the input events table lists exactly 17 rows -- this is consistent.
- The 9 trigger events match the current `TRIGGER_EVENT_TYPES` array in `advisory-ctrl/src/handlers/event-listener.ts` exactly.
- The compliance and user-response events match the current handler code.
- The CDC event names (GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, etc.) match the existing `AdvisoryCtrlEventTypes`.
- Cost estimate appears reasonable for POC. The $20-50 for 4 Bedrock KBs aligns with Bedrock pricing (built-in vector store is ~$0.10/GB storage + $0.01/query).
- The service map correctly preserves existing services (advisory-bff, compliance-ctrl, advisory-adpt, advisory-hub) and only replaces advisory-ctrl.
