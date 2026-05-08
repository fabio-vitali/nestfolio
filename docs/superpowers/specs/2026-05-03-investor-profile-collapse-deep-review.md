# InvestorProfile single-row collapse — deep review (2026-05-03)

> **Partially superseded by [2026-05-08-investor-profile-domain-resplit-design.md](./2026-05-08-investor-profile-domain-resplit-design.md)** — the parts dealing with mandate-on-InvestorProfile, MandateStatus sibling, and carrier-only event topology are reversed. Other parts (multi-row YAGNI removal, plural-Goal removal, version-field cleanup) remain canonical.

**Status:** pre-design synthesis. Will inform the formal design spec.
**Active workstream:** `[design]` Collapse InvestorProfile to single-row CQRS BFF read model (see `docs/BACKLOG.md` ACTIVE).
**Pivoted from:** `[design]` Onboarding completion fan-out (3 → 1) — the fan-out is a symptom of the multi-row decomposition; this collapse dissolves it at root.

---

## Executive verdict

**No structural blockers found.** Every concern has a clear mitigation. The collapse is doable within reasonable scope, but the **total work is substantial** — ~60–80 hours of focused effort across 36+ files. This is a 1–2 week workstream, not a quick fix.

The two pleasant surprises:
1. **Frontend impact is tiny** (~3 production files; the plural `getGoals` GraphQL surface is mostly cosmetic — no MFE renders multi-goal lists).
2. **Advisory agents are fully decoupled** from investor-bff's storage shape (they read AgentCore Memory + event payloads; compliance-ctrl already projects mandate fields into its own `MandateSnapshot` table — perfect CQRS).

The two real costs:
1. **Test churn** — 26 test files, 21 REWRITE / 8 DELETE / 7 VERIFY. The 986-line `investor-bff.integration.test.ts` is the largest single rewrite.
2. **Notification redesign** — `investor-ctrl` must derive notification semantics from CDC OldImage/NewImage diff (~80–120 LOC new code with null-handling edge cases).

---

## Findings by track

### Track 1 — Frontend impact: LOW

- **Zero active queries** in production MFE code touch `Goal`, `Mandate`, or `RiskProfile` GraphQL types directly.
- One component reference: `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts` — but it renders **static text labels** (no data binding); no rewrite needed except cosmetic step removal if desired.
- `dashboard-bff` already exposes a flat `InvestorSnapshot` with `goalType: String` (singular) and `mandateLevel: String` — the dashboard MFE is already aligned to a collapsed shape.
- E2E tests `apps/e2e-feature-tests/src/profile/update-goal.e2e.test.ts` + `update-mandate.e2e.test.ts` need GraphQL signature updates.
- Onboarding-MFE doesn't mutate goals — it's a CDC consumer for events only.
- Apollo cache config / codegen: nothing to change.

**Estimate:** 1–2 days.

### Track 2 — Notification-lifecycle redesign: MODERATE

`investor-ctrl/notification-lifecycle.service.ts` (169 LOC) currently fires distinct push notifications per event:
- `MANDATE_CREATED` → "Investment Mandate Activated"
- `GOAL_UPDATED` → "Goal Updated"
- `OPERATING_MODE_CHANGED` → "Operating Mode Changed"
- + 4 others (ONBOARDING_COMPLETED, DEPOSIT_INITIATED, DECISION_APPROVED, ORDER_FILLED — these stay)

Two paths considered:

| Path | Cost | Where complexity lives | Recommendation |
|---|---|---|---|
| **A. Diff-detection in consumer** | +80–120 LOC in investor-ctrl | Compare CDC OldImage vs NewImage to derive which mandate/goal/operating-mode field changed; fire appropriate notifications | ✓ recommended |
| **B. Semantic events from BFF resolvers** | +40–80 LOC in investor-bff + new AppSync→EventBridge plumbing | New infrastructure (BFF JS resolvers don't natively emit events today) | rejected — too much new infra |

**Path A precedent:** `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` already uses `broadcastFromStream` with a `whenChanged` field-list pattern — proven precedent for field-diff-gating in this codebase.

**Path A risks named:**
- Null-handling: `OldImage` is null on INSERT (must be treated as "all fields nil").
- Field "appearance" semantics: detecting "mandate just appeared" requires either `OldImage.mandateId == null && NewImage.mandateId != null` OR an explicit timestamp marker (`mandateActivatedAt`).
- Existing `notificationId = eventId` dedup must extend if one composite event fans out multiple notifications (use `eventId + ':' + derivedField` as key).

### Track 3 — Advisory agents + compliance-ctrl data paths: VERY LOW

**Critical finding:** No agent reads `investor-bff` DDB directly. All data flows via:
1. **AgentCore Memory** (decision-scoped namespace `/investor-profile/{tenantId}/decisions/{decisionId}`) — agents read upstream agent outputs via `session.readUpstreamOutput(serviceName)`.
2. **Event payloads** — `RECOMMENDATION_PROPOSED` carries computed `riskScore`, `proposedTrades`, `portfolioValue`, `currentPositions`.
3. **compliance-ctrl's own `MandateSnapshot` table** (`services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts:142,159`) — written by `compliance-ctrl/handlers/event-listener.ts:171,184` `processMandateEvent` from incoming `MANDATE_CREATED`/`MANDATE_UPDATED`/`OPERATING_MODE_CHANGED` events. **Already proper CQRS projection — owns its read model.**

**Migration delta for compliance-ctrl:** subscribe to `INVESTOR_PROFILE_CREATED` + `INVESTOR_PROFILE_UPDATED` (instead of the 3 specific events); re-project mandate fields from new payload shape; continue writing its own MandateSnapshot row (idempotent). ~20 LOC change.

**Migration delta for advisory agents (4 ctrl services):** **ZERO.** Agents are unaffected because:
- They don't subscribe to `MANDATE_CREATED`/`GOAL_CREATED`/`RISK_PROFILE_CREATED` (those go to compliance-ctrl + decision-workflow-ctrl).
- Their prompt templates reference "investor profile" / "risk category" generically, not specific row shapes.
- AgentCore Memory contracts are decision-scoped, not entity-scoped.

### Track 4 — Tests inventory: SUBSTANTIAL

| Bucket | Count | Notes |
|---|---|---|
| **REWRITE** | 21 | Schema/event-name updates; behavior valid |
| **DELETE** | 8 | Test separate event types that collapse (e.g., "creates 3 separate CDC events from transactWrite") |
| **VERIFY** | 7 | Touches affected entities but might just work; flag for re-run |
| **Total** | **36 test vectors across 26 files** | |

**High-risk individual files (~40h estimate just for these 4):**
1. `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (986 lines) — asserts atomic creation of 7 entities with specific `__typename` per row; needs full rewrite to assert single-row shape.
2. `services/advisory/decision-workflow-ctrl/test/integration/*.integration.test.ts` (500+ lines) — 8 separate trigger event tests collapsing to 2 unified event types.
3. `apps/e2e-feature-tests/src/helpers/fixtures.ts` — `onboarded()` and `withDecision()` deeply couple to multi-row schema; rewriting them ripples across all e2e tests.
4. `services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts` — 6 method signatures change (setGoal, getGoals, updateGoal, grantMandate, revokeMandate, setOperatingMode).

### Track 5 — Architecture docs sweep: MODERATE

**`docs/architecture/SYSTEM-ARCHITECTURE.md`** — 3–4 line edits:
- §195 event taxonomy table: `User & Mandate | INVESTOR_REGISTERED, MANDATE_DEFINED, OPERATING_MODE_CHANGED` — note `MANDATE_DEFINED` doesn't exist in code (it's `MANDATE_CREATED`). Pre-existing doc drift; will update during this work.
- §506 Glossary: `**Mandate** — the per-investor configuration declared at onboarding: goals, risk profile, asset constraints, ESG filters` — concept-level, no change needed.
- §137, §170 — concept-level mentions, no change needed.

**`docs/architecture/SERVICE-INVENTORY.md`** — 5 service section updates:
- `investor-bff > Egress`: collapse 9-shape map (Goal/RiskProfile/Mandate/OperatingModeRecord/InvestorProfile/Deposit/Withdrawal/ExecutionModeChange/Notification) → 5-shape map (InvestorProfile/Deposit/Withdrawal/ExecutionModeChange/Notification). The non-profile entities (Deposit, Withdrawal, ExecutionModeChange, Notification) stay multi-row.
- `dashboard-bff > Ingress`: subscriptions list collapse.
- `investor-ctrl > Ingress Subscriptions`: from 14 → ~12.
- `compliance-ctrl > Ingress`: 3 events → 2 events (INVESTOR_PROFILE_*).
- `decision-workflow-ctrl > Event Types`: TRIGGER_EVENT_TYPES list updates.
- `advisory-adpt > Ingress > Investor → Advisory`: forwarded events list shrinks.

**`flows/*.flow.yaml`** — 4 files affected:
- `flows/investor-onboarding.flow.yaml` — major rewrite of Phase 2a (transactWrite items list), Phase 6 (cross-domain forwards), success_criteria, failure_modes.
- `flows/advisory-cycle.flow.yaml` — Phase 0 cross_domain list + Phase 1 receives list collapse.
- `flows/incident-escalation.flow.yaml` — line 84 comment update.
- `flows/portfolio-rebalance.flow.yaml` — `GOAL_INTERPRETATION_PRODUCED` is an agent-emitted event (CDC from AgentInvocation), not investor-bff-related. **No change needed.**

**Per-service `CLAUDE.md` cards** — 5 services need regen via `audit-service` skill: investor-bff, dashboard-bff, investor-ctrl, compliance-ctrl, decision-workflow-ctrl, advisory-adpt.

**`specifications/*.md`** — concept-level only, no entity-shape commitments. No edits needed.

**Skills (orient, domains)** — already thin pointers to canonical docs. No edits.

---

## Open design questions (must settle before implementation)

### Q1 — Trigger event for decision-workflow-ctrl: which event(s)?

After collapse, `INVESTOR_PROFILE_CREATED` fires once per onboarding (initial cycle trigger). But `INVESTOR_PROFILE_UPDATED` fires on **any** profile mutation — including ones that shouldn't trigger an LLM cycle (e.g., user updates email, nickname, marketing preferences in the future).

Three options:
- **Q1.a:** Only `INVESTOR_PROFILE_CREATED` is a trigger; all updates go through other event names (and `MANDATE_UPDATED` PARKING LOT entry remains valid as a separate workstream).
- **Q1.b:** `INVESTOR_PROFILE_UPDATED` is a trigger; `decision-workflow-ctrl` checks the diff and only starts SF if mandate/goal/risk/mode fields changed.
- **Q1.c:** BFF mutation resolvers emit semantic intent events (`USER_UPDATED_GOAL`, etc.) for trigger purposes; CDC handles only projections. (Same Path B rejected for notifications — but might be revisited here.)

Recommendation: **Q1.b**, mirroring the same diff-gating pattern as the notifications redesign. Single mechanism, applied twice.

### Q2 — Event payload shape for INVESTOR_PROFILE_UPDATED

CDC events on the collapsed row carry NewImage + OldImage. Two payload contracts:
- **Q2.a:** Flat top-level fields: `subject = { tenantId, userId, goalObjective, riskScore, mandateLevel, monthlyTurnoverCapPercent, ..., revokedAt, operatingMode }` — every consumer sees a flat shape.
- **Q2.b:** Nested groups: `subject = { tenantId, userId, goal: { objective, ... }, mandate: { level, ... }, riskProfile: { score, ... }, operatingMode }` — preserves logical groupings; consumers index into sub-objects.

Recommendation: **Q2.b** (nested) — preserves human readability of payloads, and compliance-ctrl's existing `MandateSnapshot` shape already mirrors it.

### Q3 — `revokedAt` semantics on the composite row

Currently `revokeMandate` mutation does `UpdateExpression: 'SET revokedAt = :revokedAt'` on the dedicated Mandate row. After collapse: same operation on the InvestorProfile row, setting `mandate.revokedAt`. But: how do other code paths interpret a profile with `mandate.revokedAt != null`? Specifically:
- compliance-ctrl: should it still permit decision cycles for revoked mandates? Today's behavior is unclear (likely BLOCKED → MANDATE_MISSING).
- decision-workflow-ctrl: should `INVESTOR_PROFILE_UPDATED` from a revocation trigger a cycle? Probably yes (to update advisory state to reflect revocation).

Need to verify current behavior + decide deliberately.

### Q4 — Migration strategy for the dev environment

The dev DDB tables have existing test tenant data in multi-row format. Options:
- **Q4.a:** Hard cutover — wipe dev profile data, re-onboard test tenants. Per `feedback_no_deprecation.md`, dev is disposable. Cleanest.
- **Q4.b:** Migration Lambda — read multi-row, write single-row, delete multi-row. Adds throwaway code.

Recommendation: **Q4.a** — disposable dev, hard cutover.

---

## Recommended next steps

1. **Settle Q1–Q4** with the user (4 architectural decisions).
2. **Promote this file to a formal spec** at the same path (this file IS the spec-precursor; will be expanded inline as decisions land).
3. **Spec self-review** (placeholders / contradictions / scope / ambiguity).
4. **User reviews spec** before proceeding to writing-plans.
5. **Invoke `superpowers:writing-plans`** with the deep-review evidence as input.
6. **File side-finding to PARKING LOT:** SYSTEM-ARCHITECTURE.md §195 mentions `MANDATE_DEFINED` — pre-existing doc drift; either fix as part of this work (low effort) or file standalone.

---

## Appendix — total estimated effort

| Bucket | Hours | Notes |
|---|---|---|
| Backend production code | 8–12 | investor-bff repository + transforms + Egress + 4 consumer subscriptions |
| Notification-lifecycle redesign (Path A) | 6–10 | Diff-detection logic + null-handling tests |
| Test rewrites (high-risk 4 files) | 25–35 | investor-bff.integration.test.ts is the lion's share |
| Test rewrites (remaining 22 files) | 12–18 | Mostly mechanical schema/event-name updates |
| Frontend (e2e tests + 1 cosmetic component) | 4–8 | Minimal MFE impact |
| Architecture docs + 5 service-card regens | 3–5 | `audit-service` skill regenerates cards from code |
| Validation gate on dev (5-run e2e) | 4–8 | Per project's 5-run gate convention |
| **Total** | **62–96 hours** | **~1.5–2.5 weeks of focused work** |

Compared to the original tactical fix (5 lines, ~2 hours), this is a **30–50× larger investment** — but for a structural correction that:
- Eliminates the fan-out bug at root.
- Removes ~3 dead schema fields (`version: 1` set-once-never-incremented on Mandate + RiskProfile + OperatingModeRecord).
- Aligns the BFF with the CQRS read-model role the rest of the system already uses.
- Removes speculative scaffolding (`Goal#${goalId}` plurality, `Mandate.version` history hooks) not anchored to product specs.
- Naturally subsumes the `MANDATE_UPDATED` PARKING LOT entry.
