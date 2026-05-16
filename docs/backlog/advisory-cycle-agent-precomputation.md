---
id: advisory-cycle-agent-precomputation
status: parking
type: design
notes: "Alternative to the per-cycle agent model: investor-profile + market-intelligence move to continuous projection (run on change events, write snapshots, cycle reads them). Sibling to the pipeline-trap architectural fix."
references:
  - docs/backlog/agent-pipeline-backlog-trap-architectural.md
  - docs/data-flows/advisory-cycle.md
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts
  - services/advisory/investor-profile-ctrl/CLAUDE.md
  - services/advisory/investor-profile-ctrl/src/service.stack.ts
  - services/advisory/market-intelligence-ctrl/CLAUDE.md
  - services/advisory/market-intelligence-ctrl/src/service.stack.ts
  - services/advisory/compliance-ctrl/src/service.stack.ts
out_of_scope:
  - "portfolio-engine-ctrl and advisory-narrative-ctrl (case-specific; cannot be precomputed)"
  - "KB ingestion paths (Regulatory KB, Market KB)"
  - "AgentCore Memory namespace changes (Phase-A handoff is correct as designed)"
  - "Authority resolution / operating-mode logic (already lives in MandateSnapshot + compliance-ctrl)"
  - "Production rollout sequencing (dev-first; prod posture decided separately)"
  - "Cross-region or multi-region snapshot replication"
  - "Snapshot retention / archival policy"
  - "Pipeline-wiring tuning for the remaining 2 agents (covered by agent-pipeline-backlog-trap-architectural)"
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Advisory cycle — investor-profile + market-intelligence precomputation

## Proposal in one paragraph

Stop invoking `investor-profile-ctrl` and `market-intelligence-ctrl` once per cycle. Instead, run them continuously: investor-profile on profile-change events (`INVESTOR_PROFILE_UPDATED`, `MANDATE_ISSUED`, `OPERATING_MODE_CHANGED`); market-intelligence on feed events and a scheduled refresh (~15-min cadence). Each writes a structured snapshot (`InvestorProfileSnapshot` per user, `MarketSnapshot` per region). The cycle's Phase 1 becomes two DDB getItem reads — no agent calls. Case-specific interpretation moves to compliance rules (for guardrail-style checks) and to `portfolio-engine-ctrl` (for case synthesis, which it already does per cycle).

## Why it's worth a deep review

**Invocation count drops by orders of magnitude.** Let `C` = cycles/day, `U` = active users, `P` = profile changes/day (~0.01·U in typical SaaS), `M` = market refreshes/day at 15-min cadence = 96 (singleton). Today's IP+MI cost is `2C/day`; proposed is `P + M ≈ 0.01·U + 96`. For any realistic cycle volume this is a 1–2 orders-of-magnitude reduction.

**Cycle latency contribution from Phase 1 drops from 5–30s to <100ms** (two DDB getItems instead of two agent runs).

**Composes with `agent-pipeline-backlog-trap-architectural`.** That issue tries to make the SF→EB→SQS→Lambda→AgentCore hop survive fan-out. This proposal eliminates the hop entirely for IP and MI — the queue trap dissolves for half the agents. The remaining two (`portfolio-engine`, `advisory-narrative`) still need the pipeline fix. Either ships independently.

**Echoes patterns already in the system.** `compliance-ctrl` and `decision-workflow-ctrl` already project `MandateSnapshot` from `MANDATE_ISSUED`/`OPERATING_MODE_CHANGED` and read it in-cycle. `market-intelligence-ctrl` already pre-fetches deterministic context (market-data, instrument-universe) before the agent runs. This proposal generalises both patterns.

## What we'd risk losing

1. **Case-specific framing.** Today the agents see the trigger and frame their reasoning around it. A snapshot is generic. Severity depends on how load-bearing IP's case framing is for downstream agents — needs prompt-level investigation of `portfolio-engine-ctrl`.
2. **Per-cycle freshness for market data.** A 15-min-stale `MarketSnapshot` is fine for daily rebalances; possibly not for a deposit-allocation cycle right after a market-moving event. Mitigation: tier the snapshot — fast components (instrument-universe, sector sentiment) refreshed per feed event; slow components (macro regime) refreshed on timer.
3. **Trigger-vs-snapshot race for `INVESTOR_PROFILE_UPDATED`.** The same event fires the cycle and the snapshot rebuild. Mitigation candidates: (a) trigger payload carries new profile inline and SF prefers it for asserted fields; (b) SF waits for `snapshot.version > trigger.eventId`; (c) keep a fallback in-cycle agent call for profile-change triggers only.
4. **Mental-model complexity.** Two modes of agent invocation in the cycle (per-cycle for portfolio+narrative; per-change for IP+MI). Architecture diagrams, flow specs, and `SYSTEM-ARCHITECTURE.md` §17 need updates.
5. **Per-tenant market reasoning.** `MarketSnapshot` is a singleton (or per-region). Tenant-specific filtering moves to `portfolio-engine`, which is per-cycle. Likely cosmetic since MI's feeds are global today.

## Relationship to `agent-pipeline-backlog-trap-architectural`

| Dimension | This proposal | `agent-pipeline-backlog-trap-architectural` |
|---|---|---|
| What changes | When IP+MI run (per-change vs. per-cycle) | How the in-cycle hop is wired (concurrency, visibility, possibly sync invoke) |
| Agents affected | IP + MI only | All 4 agents |
| Per-cycle agent count after change | 2 (portfolio + narrative) | 4 (unchanged) |
| Queue-trap surface remaining | half (portfolio + narrative) | full (all 4, but with better wiring) |
| Independence | Independent; can ship alone | Independent; can ship alone |
| Combined effect | IP+MI exit the cycle; portfolio+narrative get wiring fix | full elimination of in-cycle agent latency for IP+MI; tuned wiring for the rest |

Decision sequencing: the other issue is `queued`, `rank: 3`, blocked on observability data. This one doesn't depend on observability. They can be reviewed and ranked independently.

## Promote when

Promote to `queued` after confirming both of these:
1. **Investigation:** read `portfolio-engine-ctrl`'s prompt + handler to determine whether it actually depends on IP's case-specific framing or whether it can work from a generic `InvestorProfileSnapshot`. One-shot read, no code change.
2. **Product judgement:** confirm that a 15-min-stale market window is acceptable for the decision classes the cycle serves (rebalance, drift, deposit). Not a code question.

If both clear, promote and request a full design spec at `docs/superpowers/specs/<date>-advisory-cycle-agent-precomputation-design.md`. The spec should cover: snapshot schema details, new event contracts, migration phases (shadow mode → cutover), the trigger-race resolution choice, snapshot-freshness validation gates, and the e2e fixture impact.

## Open questions to answer in the spec

1. Does `portfolio-engine-ctrl`'s prompt rely on IP's case-specific framing, or only on the raw profile?
2. What is the empirical profile-change rate per user? (Drives the `P` estimate.)
3. Per-field or per-snapshot refresh cadence for `MarketSnapshot`?
4. Should there be a "force agent call" override for triggers where recency is critical (e.g., during a market halt)?
5. How does the e2e harness (`apps/e2e-feature-tests`) seed snapshots? Today it emits raw triggers and expects the per-cycle agents to derive context.
6. Does AgentCore Memory have a role in the snapshot lifecycle, or is this purely a DDB projection?
