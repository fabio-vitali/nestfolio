# Go-Live: Functional Deterministic Review-and-Revise — Design

- **Date:** 2026-06-14
- **Backlog:** `go-live-agent-wiring-and-emission` (status: active)
- **Type:** feature (filed as a bug; brainstorming reclassified it — see §1)
- **Domains:** investor (primary), advisory (mandate audit), execution (downstream, unchanged)

## 1. Problem & reclassification

The simulation→live switch is non-functional end-to-end. The filed bug was narrow:
`onboarding-bff.confirmGoLive()` (which writes a `GoLiveConfirmed` CDC row → `GO_LIVE_CONFIRMED`)
**has no runtime caller**, so the switch never fires. Verified against code (2026-06-14):

- `services/investor/onboarding-bff/src/repositories/onboarding.repository.ts:121` — `confirmGoLive()` exists, no production caller.
- `services/investor/onboarding-bff/src/agent/state.ts:5` — agent `PHASE_ORDER` ends at `mandate_cta`; no go-live phases.
- `services/investor/onboarding-bff/src/agent/tools/commit-phase.ts:59` — `commit_phase` only completes on `mandate_consent`.
- `flowType='go-live'` is read **nowhere** in `src/agent/*` or `agents/onboarding/*`; it exists only as a zod enum in `src/domain/schemas.ts:35`.
- Frontend `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts:344` navigates to `/onboarding?flowType=go-live`; the onboarding MFE/agent ignore the param.

During brainstorming the scope was deliberately widened. Going to **real money** is the highest-stakes
action in the product, so go-live should let the user **review and revise** their profile (risk, goals,
operating mode) and **explicitly re-accept their mandate for live trading** before committing — not just
a display-only confirm. This makes it a cross-domain *feature*, delivered as **one spec, phased plan**
(user direction 2026-06-14).

## 2. Decisions (with rationale)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | UX shape | **Review-and-revise** (seeded with current values, editable, then confirm) | Real-money gravity warrants revisiting risk/mandate; not a cold restart (friction) nor a dumb confirm. |
| D2 | Vehicle | **Deterministic wizard on investor-bff** (not the conversational agent) | The profile data is owned by investor-bff and already has read+edit mutations; the system already treats post-onboarding edits as deterministic mutations (the agent is for first-time collection). Avoids inverting data ownership + LLM tool-call flakiness; deterministic e2e. |
| D3 | Trigger / event topology | `confirmGoLive` **investor-bff mutation** sets `executionMode='live'` directly → `EXECUTION_MODE_CHANGED`. **`GO_LIVE_CONFIRMED` is removed** | `GO_LIVE_CONFIRMED` is consumed by nobody but investor-bff itself; moving the trigger in-domain makes it a redundant round-trip. [[no-deprecation]]: dev is disposable, remove it. |
| D4 | Mandate re-acceptance | **Re-affirm event**: bump Mandate row `effectiveDate` + `__version`, emit new `MANDATE_REAFFIRMED` → compliance-ctrl audit | Clean event-sourced, compliance-aware audit of "mandate affirmed for live at T"; reusable "re-affirm an aggregate" pattern. Level unchanged. |
| D5 | Risk editing | **Editable** — new `updateRiskProfile(toleranceIdx, experienceIdx)` recomputes via canonical `computeRiskProfile` | Risk appetite is the most decision-relevant field at the real-money moment. Reuses the single owned algorithm. |
| D6 | Funding | **Optional, reuses existing `initiateDeposit`**; does NOT gate the confirm | Go-live's real job is the mode switch; funding is its own already-built real-money flow. |

## 3. Target flow

```
Settings Go-Live wizard (investor-mfe → investor-bff GraphQL, Cognito auth)
  Step Risk    : sliders (tolerance, experience) → updateRiskProfile(...)     [NEW mutation]
  Step Goals   : form                            → updateGoal(...)            [exists]
  Step Mode    : select                          → updateOperatingMode(...)   [exists]
  Step Fund    : link → existing initiateDeposit flow (does NOT gate confirm) [exists]
  Step Confirm : required "I accept my mandate now governs real money" checkbox
                 → confirmGoLive()                                            [NEW mutation, atomic]
                     TransactWriteItems:
                       ├─ Update InvestorProfile (sk='InvestorProfile'): executionMode='live', __version++
                       ├─ Put    ExecutionModeChange (write-once audit row)
                       │      → CDC EXECUTION_MODE_CHANGED → execution-adpt → broker-ctrl mode='live'
                       └─ Update Mandate (sk='Mandate'): effectiveDate=now, __version++
                              → CDC MANDATE_REAFFIRMED → advisory-adpt → compliance-ctrl (audit)
```

The per-step edit mutations apply immediately as the user advances; `confirmGoLive` is the single
atomic commit that flips execution mode **and** re-affirms the mandate (the confirm *is* the consent record).

## 4. Component changes

### 4.1 investor-bff (primary)
- **`confirmGoLive: InvestorProfile!`** — new JS resolver (`confirm-go-live.fn.js`), one `TransactWriteItems`
  performing the three writes in §3. Mirrors the `update-operating-mode.fn.js` transact pattern and the
  repo's existing `setExecutionMode` write (`investor-profile.repository.ts:73`). Returns the updated
  `InvestorProfile` (readback step, like `updateOperatingMode`).
- **`updateRiskProfile(toleranceIdx: Int!, experienceIdx: Int!): InvestorProfile!`** — new resolver that
  recomputes score/band/labels via the canonical `computeRiskProfile` (`domain/risk-profile.service.ts`)
  and writes `riskProfile` to the composite row (`__version++`). *Open implementation choice for the plan:*
  inline the (tiny, pure) algorithm in the JS resolver vs. a Lambda-backed resolver importing the owned
  function. **Recommend** single-sourcing the algorithm (Lambda-backed) to avoid duplicating the owned
  scoring logic; the plan decides.
- **Remove `GO_LIVE_CONFIRMED`**: drop from Ingress subscriptions (`service.stack.ts`), the
  `event-listener.ts` handler branch (`setExecutionMode` on GO_LIVE_CONFIRMED), and `domain/events.ts`.
- **`MANDATE_REAFFIRMED`**: new event in `domain/events.ts`; Egress `eventTypes` adds
  `onFieldChange: effectiveDate → MANDATE_REAFFIRMED` on the Mandate row; producer zod contract authored
  in the **same home as the existing `MANDATE_ISSUED`/`MANDATE_REVOKED` contracts** (cross-domain → the
  producer-side adapter `/domain` per the contract-home rule; the plan confirms the exact module).
- `schema.graphql`: add the two mutations + any input types.
- Read-model-ownership: `InvestorProfile` + `Mandate` are CommandOwned; both new writes are local
  commands (consistent). `ExecutionModeChange` stays the unregistered write-once audit row. No registry
  changes expected; the `typecheck` type-test still passes.

### 4.2 onboarding-bff (dead-code removal — [[no-deprecation]])
- Remove `confirmGoLive()` repo method (`onboarding.repository.ts:121`).
- Remove `GoLiveConfirmed:INSERT → GO_LIVE_CONFIRMED` Egress mapping + the `GO_LIVE_CONFIRMED` event.
- Remove the go-live phases from `domain/schemas.ts` (`review_risk`/`review_goals`/`review_mandate`/
  `fund_account`/`go_live_confirmation`, the `flowType` enum, `GoLiveConfirmedRecordSchema`/`GoLiveConfirmedSchema`).
- Update `@nestfolio/onboarding-bff/contracts` exports + any consumer imports (investor-bff currently
  imports `GoLiveConfirmedSchema` — removed alongside its handler).
- Regenerate the onboarding-bff service card.

### 4.3 advisory (mandate audit)
- `advisory-adpt`: forward `MANDATE_REAFFIRMED` (mirror the existing `MANDATE_ISSUED` cross-domain rule).
- `compliance-ctrl`: consume `MANDATE_REAFFIRMED`, write an audit row mirroring how it handles
  `MANDATE_ISSUED`. Verify the exact projection against compliance-ctrl's current mandate handling during the plan.

### 4.4 investor-mfe (frontend)
- Rebuild `go-live-wizard.component.ts` from display-only to **editable**, seeded from `getProfile`:
  risk sliders, goal form, operating-mode select, a required live-mandate checkbox, a fund link into the
  existing deposit flow, and a Confirm that calls `confirmGoLive`.
- Add Apollo operations (`investor-bff.mutations`/`.queries`) for `getProfile`, `updateRiskProfile`,
  `updateGoal`, `updateOperatingMode`, `confirmGoLive` (the MFE already talks to investor-bff via
  `deposit.service.ts`).
- Remove the `/onboarding?flowType=go-live` navigation.

### 4.5 flows / docs
- Rewrite `flows/go-live.flow.yaml`: new trigger (investor-bff `confirmGoLive` mutation), the
  mandate-reaffirm hop, drop the onboarding-bff step + all "emission path NOT wired" caveats.
- Regenerate `docs/data-flows/`; run `validate-flow go-live`.
- Regenerate service cards (investor-bff, onboarding-bff, compliance-ctrl). Regenerate C4 diagrams if the
  service topology/edges changed (new investor→advisory mandate-reaffirm edge).

## 5. Testing

- **Unit (TDD):** new resolvers (`confirmGoLive`, `updateRiskProfile`) — write transactions, `__version`
  bumps, risk recomputation; investor-bff event-listener loses its GO_LIVE_CONFIRMED branch (test removed);
  compliance-ctrl `MANDATE_REAFFIRMED` handler; onboarding-bff tests pruned with the removed code.
- **e2e (deterministic, UI assertions only — [[feedback-e2e-ui-assertions-only]]):** a new
  `apps/e2e-feature-tests` scenario driving the wizard to confirm go-live and asserting the observable
  sim→live outcome through the UI. Deterministic (no LLM), so no flake-tolerance band-aids. Replaces the
  two contract-emission tests that currently *document the gap*
  (`investor/investor-contract-emission.e2e.test.ts:17`, `execution/execution-contract-emission.e2e.test.ts:378`).

## 6. Phasing (the plan sequences these; each independently verifiable)

- **P1 — Switch works.** `confirmGoLive` mutation (executionMode='live' → `EXECUTION_MODE_CHANGED`);
  remove `GO_LIVE_CONFIRMED` + onboarding-bff dead code; minimal wizard wired to confirm; deterministic
  e2e proving sim→live. **This alone closes the filed bug.**
- **P2 — Revise.** `updateRiskProfile` + editable goals/operating-mode in the wizard.
- **P3 — Mandate re-affirm.** `MANDATE_REAFFIRMED` event + advisory-adpt forward + compliance-ctrl audit;
  fold the mandate re-affirm write into `confirmGoLive`'s transaction.
- **P4 — Polish.** Wizard UX completion (fund link, mandate checkbox gating), flow spec + data-flows +
  service cards + C4 regen.

## 7. Out of scope

- Broker live-trading / Alpaca routing behavior itself (already exists; verified-only).
- Conversational/agent-driven go-live (explicitly rejected — D2).
- Mandate **level** changes (advisory↔discretionary) at go-live (D4 keeps level unchanged).
- Making funding **mandatory** before confirm (D6 keeps it optional).
- Onboarding agent refactors beyond removing the dead go-live code.

## 8. References (verified 2026-06-14)

- `services/investor/onboarding-bff/src/repositories/onboarding.repository.ts:121` (`confirmGoLive`, no caller)
- `services/investor/onboarding-bff/src/agent/state.ts:5` (`PHASE_ORDER`), `.../agent/tools/commit-phase.ts:59`
- `services/investor/onboarding-bff/src/domain/schemas.ts` (go-live phases + `flowType` enum, zod-only)
- `services/investor/investor-bff/src/schema.graphql` (existing mutations), `.../src/<js resolvers>/*.fn.js`
- `services/investor/investor-bff/src/transforms/onboarding-completed.ts` (composite-row + Mandate materialization)
- `services/investor/investor-bff/src/repositories/investor-profile.repository.ts:73` (`setExecutionMode`)
- `services/investor/investor-bff/src/handlers/event-listener.ts:48` (`GO_LIVE_CONFIRMED` → setExecutionMode)
- `services/investor/investor-bff/src/domain/risk-profile.service.ts` (`computeRiskProfile`)
- `services/execution/execution-adpt/src/service.stack.ts:60`, `services/execution/broker-ctrl/src/service.stack.ts:47` (`EXECUTION_MODE_CHANGED` downstream)
- `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts` (wizard, display-only today)
- `flows/go-live.flow.yaml` (current, carries the "NOT wired" caveats)
