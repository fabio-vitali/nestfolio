# Mandate projection fix — single version line + full-row P1

**Date:** 2026-06-03
**Backlog item:** `read-model-ownership-mandate-projection-fix`
**Program:** `read-model-ownership-producer-aggregates` (successor to `bff-read-model-materialization-redesign`)
**Predecessor spec:** `docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md`
**Type:** refactor (producer + consumer; cross-domain event-contract change)

## Goal

Make `OPERATING_MODE_CHANGED` carry **full Mandate state** on the **same monotonic
`__version` line** as `MANDATE_ISSUED` / `MANDATE_REVOKED`, so that compliance-ctrl
and decision-workflow-ctrl can convert their `MandateSnapshot` projections to
`projectVersioned` + register `Projection<'P1'>` — without partial-payload field-wipe
or cross-counter silent-drop.

This closes the **§9.1 "Known gap (2026-06-02)"** in
`docs/architecture/READ-MODEL-OWNERSHIP.md` and unblocks WS-D's mandatory-error gate
(which errors on any intent-written-but-unregistered governed row; `MandateSnapshot`
is governed).

## The blocker (re-verified against code, 2026-06-03)

`MandateSnapshot` is dual-projected: investor-bff is the single **owner** of the
`Mandate` aggregate; compliance-ctrl and decision-workflow-ctrl each keep their own
independent physical copy. For a clean full-row P1 projection, all Mandate lifecycle
events must share one version line and each carry enough to write the full row. They
do not today:

- `MANDATE_ISSUED` / `MANDATE_REVOKED` are CDC from the **Mandate** sibling row
  (`sk='Mandate'`). Each carries the full Mandate new-image + the Mandate row's atomic
  `__version`.
  - `onboarding-completed.ts:76–98` seeds the Mandate row with
    `{ mandateId, level, status:'ACTIVE', operatingMode, effectiveDate, revokedAt:null, __version:1 }`.
  - `revoke-mandate.fn.js:6–29` does `SET #status=:revoked, revokedAt, …, #v = if_not_exists(#v,:zero)+:one`.
  - Egress map `service.stack.ts:86–89`: `'Mandate': { insert: MANDATE_ISSUED, modify: MANDATE_REVOKED }`.
- `OPERATING_MODE_CHANGED` is CDC from the **InvestorProfile** composite row
  (`sk='InvestorProfile'`) via `onFieldChange: { operatingMode }`
  (`service.stack.ts:78–84`). `update-operating-mode.fn.js:12–26` writes the
  **InvestorProfile** row, bumping the **InvestorProfile** `__version` (a *different*
  counter), and the emitted subject lacks `level` / `status` / `effectiveDate` /
  `mandateId`.

Two independent failures if a `projectVersioned('MandateSnapshot', …)` is applied to
today's stream:

1. **Partial payload → field wipe.** `projectVersioned` writes the FULL row. From
   `OPERATING_MODE_CHANGED` it would write a `MandateSnapshot` with `operatingMode`
   but no `level` / `status` / `effectiveDate` — wiping fields the compliance
   RuleEngine reads (`event-listener.ts:91–96` reads `level`, `status`,
   `operatingMode`, `effectiveDate`).
2. **Cross-counter version guard → silent drop.** The P1 guard is `#__version < :version`.
   `MANDATE_ISSUED`=Mandate v1, `OPERATING_MODE_CHANGED`=InvestorProfile v3, a later
   `MANDATE_REVOKED`=Mandate v2 → `2 < 3` ⇒ the revoke is **silently deduplicated**.

Today's field-level `update()`/`record()` (no version guard) mask both. Adding the
P1 guard exposes them — hence the producer fix must land first.

## Key fact that shapes the design

`operatingMode` is **denormalized on two rows**, consumed on two independent version
lines, and both paths must keep working:

| Consumer | Reads `operatingMode` from | Version line | Constraint |
|---|---|---|---|
| dashboard-bff `InvestorSnapshot` (P1) | `INVESTOR_PROFILE_UPDATED` (`investor-snapshot.ts:38`); exposed on its GraphQL schema (`schema.graphql:86`) | InvestorProfile `__version` | **Must keep firing** with `operatingMode` + InvestorProfile `__version` |
| compliance-ctrl `MandateSnapshot` (→P1) | `MANDATE_*` / `OPERATING_MODE_CHANGED` | Mandate `__version` | Needs full Mandate state on one Mandate line |
| decision-workflow-ctrl `MandateSnapshot` (→P1) | `MANDATE_ISSUED` + `OPERATING_MODE_CHANGED` | Mandate `__version` | Needs full Mandate state on one Mandate line |
| investor-profile-ctrl | `OPERATING_MODE_CHANGED` (`event-listener.ts:55–56`, with `subject.mandate?.operatingMode` fallback) | n/a (agent trigger, no P1 guard) | Tolerates either source; `operatingMode` must be present in payload |
| investor-ctrl | `OPERATING_MODE_CHANGED` (notification trigger only; does not read the field) | n/a | Tolerates either source |

## Chosen approach — Dual-write + re-source (Approach A)

Selected over: single-source-on-Mandate (pulls in dashboard-bff as a 4th service and
reintroduces cross-version-line clobber on `InvestorSnapshot`) and carrier-enrichment
(dominated — still needs a Mandate `__version` bump *and* adds a cross-row read in the
CDC hot path).

`updateOperatingMode` **atomically writes both rows**; `OPERATING_MODE_CHANGED`
**re-sources from the Mandate row**. Decisions settled with the user:

- **(a)** Atomic dual-write via `TransactWriteItems` (not a non-atomic two-step) — the
  two denormalized copies can never disagree; single round-trip; idiomatic
  (`request-withdrawal.fn.js` already uses it). 2× WCU is negligible at human-toggle
  write rates.
- **(b)** Remove compliance-ctrl's hand-rolled "skip if REVOKED" idempotency guard —
  the version guard subsumes it (a stale `MANDATE_ISSUED v1` is dropped once
  `REVOKED v_n` has landed) and covers all out-of-order replay uniformly.
- **(c)** Keep DWC's subscriptions unchanged (no `MANDATE_REVOKED`) — adding revoke
  handling is feature behavior, out of scope. DWC reads only `operatingMode` + `level`.

### Resulting Mandate version line

```
v1 MANDATE_ISSUED  →  v2 OPERATING_MODE_CHANGED  →  v3 OPERATING_MODE_CHANGED  →  vN MANDATE_REVOKED
(full Mandate new-image + subject.__version on every event; monotonic)
```

## Changes by component

### 1. Library enablement — `onFieldChange`-only modify (additive, backward-compatible)

The Mandate row's `modify` must fire two *different* semantic events by field
(`status`→`MANDATE_REVOKED`, `operatingMode`→`OPERATING_MODE_CHANGED`) with **no
carrier** event. Today `ModifyEmission.always` is required and three code paths
discriminate on `'always' in mapping`.

- `libs/cdk-constructs/src/core/event-types.ts`
  - `ModifyEmission.always` (line 24) → optional (`always?: EventName`).
  - `RuntimeModifyEmission.always` (line 52) → optional.
  - `buildRuntimeConfig` (line 77): discriminator `'always' in mapping` →
    `'always' in mapping || 'onFieldChange' in mapping`; include `always` in the
    serialized entry only when present.
  - `collectAllEventTypes` (line 107): same discriminator widening; push
    `mapping.always` only when present.
- `libs/event-processor/src/pipelines/change-data-capture.ts`
  - `resolveEmissions` (lines 95–107): same discriminator widening; start
    `emissions` empty and push `always` only when present; the existing
    `onFieldChange` deep-diff loop is unchanged. Returning `[]` (nothing changed) is
    already tolerated downstream (the FieldDispatch branch can return `[]`).

`deepEqual` (`change-data-capture.ts:49–65`) already diffs `status` and
`operatingMode` independently, so a Mandate modify that changes `operatingMode` but
not `status` emits **only** `OPERATING_MODE_CHANGED`; a revoke (status
ACTIVE→REVOKED, operatingMode unchanged) emits **only** `MANDATE_REVOKED`.

**Compatibility:** every existing config carries `always`, so all current CDC
behavior is byte-for-byte unchanged. This only *adds* the no-carrier option.

### 2. Producer — investor-bff

- `src/graphql/js-function/update-operating-mode.fn.js`: `UpdateItem` →
  `TransactWriteItems` over both rows under `pk = InvestorProfile#${tenantId}#${userId}`:
  - `sk='InvestorProfile'`: `SET operatingMode=:mode, updatedAt, #ts, #v = if_not_exists(#v,:zero)+:one`,
    condition `attribute_exists(pk)` — *unchanged effect*; keeps `INVESTOR_PROFILE_UPDATED`
    feeding dashboard-bff on the InvestorProfile version line.
  - `sk='Mandate'`: `SET operatingMode=:mode, updatedAt, #ts, #v = if_not_exists(#v,:zero)+:one`,
    condition `attribute_exists(pk) AND #status = :active` — don't re-mode a revoked
    mandate (mirrors `revoke-mandate.fn.js`'s active-guard; on `ConditionalCheckFailed`
    surface a clean `InvalidState` error).

  The GraphQL mutation surface (`updateOperatingMode(mode)`) and its `VALID_MODES`
  validation are unchanged.
- `src/service.stack.ts` Egress `eventTypes` map:
  - `InvestorProfile.modify` → `{ always: INVESTOR_PROFILE_UPDATED, onFieldChange: { goal: GOAL_UPDATED } }`
    (drop `operatingMode`; keep `goal`).
  - `Mandate.modify` → `{ onFieldChange: { status: MANDATE_REVOKED, operatingMode: OPERATING_MODE_CHANGED } }`
    (was the flat `MANDATE_REVOKED`).
- Regen `services/investor/investor-bff/CLAUDE.md` (Egress + Facade sections).

### 3. Consumer — compliance-ctrl

- `src/handlers/event-listener.ts`: `processMandateIssued` /
  `processOperatingModeChanged` / `processMandateRevoked` → a single full-row
  `projectVersioned('MandateSnapshot', fields, { version: subject.__version, overrides: { pk: 'GuardrailPolicy#${tenantId}#${userId}', sk: 'MandateSnapshot' } })`
  where `fields = { tenantId, userId, mandateId, level, status, operatingMode, effectiveDate }`
  mapped from the (now full) Mandate `subject`. Guard `typeof subject.__version === 'number'`
  (mirror `snapshot-projector.ts`); drop the hand-rolled REVOKED-skip condition (decision b).
- `src/read-model-ownership.ts`: add `MandateSnapshot: Projection<'P1'>`.
- `test/types/read-model-ownership.type-test.ts`: assert `MandateSnapshot` rejects
  `update`/`record`/`project`/`accumulate` and accepts `projectVersioned`.
- Unit + integration tests updated (see Testing).

### 4. Consumer — decision-workflow-ctrl

- `src/handlers/mandate-projector.ts`: `processMandateIssued` (`record()` →
  `projectVersioned`) and `processOperatingModeChanged` (`update()` →
  `projectVersioned`), keyed on `subject.__version`, `overrides: { pk: 'MandateSnapshot#${tenantId}#${userId}', sk: 'MandateSnapshot' }`,
  writing the full Mandate field set. Mirror `snapshot-projector.ts`'s pattern
  (`if (typeof version !== 'number') skip`). Subscriptions stay `MANDATE_ISSUED` +
  `OPERATING_MODE_CHANGED` (decision c).
- `src/read-model-ownership.ts`: add `MandateSnapshot: Projection<'P1'>`; **flip** the
  existing comment that says `MandateSnapshot is NOT registered here — split to
  read-model-ownership-mandate-projection-fix …`.
- `test/types/read-model-ownership.type-test.ts`: add the `MandateSnapshot` assertions.
- Unit + integration tests updated (see Testing).

### 5. Docs

- `docs/architecture/READ-MODEL-OWNERSHIP.md` §9.1: remove the "Known gap
  (2026-06-02)" blockquote (now resolved); state that `OPERATING_MODE_CHANGED` is CDC
  from the Mandate row on the same `__version` line, and that both `MandateSnapshot`
  copies are registered `Projection<'P1'>`.

## Testing

- **Libraries:** unit tests for the `onFieldChange`-only path in both
  `event-types.test.ts` (buildRuntimeConfig/collectAllEventTypes serialize a
  no-`always` ModifyEmission) and the CDC pipeline test (a modify changing one of two
  `onFieldChange` fields emits exactly that one event; a modify changing neither emits
  `[]`). Existing `always`-present tests must stay green unchanged.
- **Producer:** `update-operating-mode` resolver unit test asserts the
  `TransactWriteItems` shape (both rows, both `__version` bumps, Mandate active-guard).
  investor-bff integration test: an `updateOperatingMode` bumps the Mandate row's
  `__version` and emits `OPERATING_MODE_CHANGED` (full Mandate image) but **not**
  `MANDATE_REVOKED`; a `revokeMandate` still emits only `MANDATE_REVOKED`.
- **Consumers:** unit + integration tests for both services assert version-guarded
  full-row writes (full field set preserved across all three events; stale/equal
  version dropped). **Synthetic events in integration tests must carry `__version`** —
  per the WS-C gate lesson (commit `e7024583`), a version-guarded `projectVersioned`
  silently drops events whose fixtures lack the version field. Remove/replace the
  compliance-ctrl test that asserted the REVOKED-skip conditional; remove the DWC
  `OPERATING_MODE_CHANGED → update() patching only operatingMode` expectation in favor
  of the full-row projectVersioned assertion.

## Validation gate

Cheap set + the producer/consumer deploy; real-LLM e2e deferred to the program-end
consolidated pass at WS-D (2026-06-02 cadence decision):

- `pnpm nx affected -t test,lint`
- per-service `typecheck`: investor-bff + compliance-ctrl + decision-workflow-ctrl
- `pnpm nx run event-processor:read-model-drift` green
- `pnpm nx affected -t test-integration` (mocked agents)
- deploy dev: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,compliance-ctrl,decision-workflow-ctrl`

## Blast radius

2 libs (`cdk-constructs`, `event-processor`) + 3 services (investor-bff,
compliance-ctrl, decision-workflow-ctrl) + 1 doc. **No** GraphQL mutation-surface
change; **no** feature-behavior change. dashboard-bff, investor-profile-ctrl, and
investor-ctrl are unaffected (still receive their events with `operatingMode`
present).

## Out of scope

- Any change to the operating-mode **feature** behavior (Phase-2 agent
  mode-awareness, the `updateOperatingMode` mutation surface). This item only changes
  how the operatingMode change is carried + versioned on the Mandate event stream.
- Adding `MANDATE_REVOKED` handling to decision-workflow-ctrl (decision c).
- Real-LLM e2e — runs in the program-end consolidated pass at WS-D.
