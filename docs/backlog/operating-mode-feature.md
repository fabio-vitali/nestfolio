---
id: operating-mode-feature
status: shipped
type: refactor
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md
plan: null
topic_memory:
  - project_operating_mode.md
validation_gate: "Phase 1: e2e 3/3 GREEN in 169s (CONSERVATIVE→L2, BALANCED→L1, AGGRESSIVE→L1) against deployed dev. Phase 2: unit 5 projects green + integration smoke 6/6 against deployed dev (portfolio-engine + advisory-narrative test-integration); e2e differentiation gate naturally re-validated by Approach B propagation diagnostic 2026-05-07."
closed: "2026-05-06"
notes: "Two-phase ship — Phase 1 (compliance authority resolver) 2026-05-05 + Phase 2 (agent behavior) 2026-05-06."
---

# Operating mode feature

Two-phase architectural ship that wires AGGRESSIVE/BALANCED/CONSERVATIVE operating mode end-to-end through compliance authority resolution and agent behavior.

## Phase 1 — compliance-ctrl mode-aware authority resolver — SHIPPED 2026-05-05

Adoption verification revealed all 4 implementation tasks already on `main` (`guardrail-params.ts` lookup table + `onboarding-completed.ts` mode-derived mandate + mode-aware `authority-resolver.ts` + `operating-mode-authority.e2e.test.ts`). E2E gate: 3/3 GREEN in 169s against deployed dev (CONSERVATIVE→L2, BALANCED→L1, AGGRESSIVE→L1).

**Cross-cutting fixture fix unblocked entire e2e suite**: `apps/e2e-feature-tests/src/helpers/fixtures.ts:80-91` polled `getProfile` between USER_REGISTERED and ONBOARDING_COMPLETED, but post-2026-05-04 InvestorProfile collapse `services/investor/investor-bff/src/transforms/user-registered.ts` returns `skip()` so the profile never materialized until ONBOARDING_COMPLETED itself ran the Put — fixture timed out. Fix: moved `waitForGraphQL(getProfile)` to AFTER ONBOARDING_COMPLETED. Affects all 16+ e2e tests using `onboarded()` fixture.

`updateOperatingMode` re-derivation gap filed in PARKING LOT (`update-operating-mode-mutation-rederivation-gap`).

## Phase 2 — agent behavior dimension — SHIPPED 2026-05-06 (commits `515b3f15`, `864d31a6`)

Mode-injection plumbing wired end-to-end: SF passes `investorProfile` on `ANALYZE_INVESTOR_PROFILE` subject; investor-profile-ctrl extracts `operatingMode` from composite payload + wraps it on the AgentCore Memory write; portfolio-engine + advisory-narrative read mode from upstream Memory and inject behavioral envelopes (CONSERVATIVE ≤ 30% equity / 3-5 positions; BALANCED 50-70% / 5-8; AGGRESSIVE 70-90% / 6-12).

Bug fixes coupled in:
- (a) portfolio-engine + advisory-narrative agent-service.ts had `subject.context ?? subject.upstreamOutputs ?? {}` fallback that never matched — agents have been running with empty input since service inception; fixed via explicit field extraction.
- (b) `assemble-packet.ts:50` read non-existent `portfolioOutput.proposedTrades` field — every DecisionPacket has had `proposedTrades: []` since service inception; fixed by mapping `portfolioOutput.allocations.allocations[]` → `ProposedTrade` shape.

PortfolioConstructionSchema gained required `assetClass` enum so the e2e gate can derive equity weight. New e2e test `operating-mode-recommendation-shape.e2e.test.ts` parametrized over 3 modes.

E2E gate was BLOCKED on the agent-runtime structured-output bug (separately shipped 2026-05-06 as `agent-runtime-structured-output-reliability`); naturally re-validated 2026-05-07 by Approach B propagation diagnostic showing CONSERVATIVE/BALANCED/AGGRESSIVE shapes correctly differentiated at runtime.

Spec: `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md`. Side-findings filed: stale `readUpstreamOutput('advisory-ctrl')` in 2 graph.ts files (parked); `withLiveDecision` hardcodes BALANCED (parked).
