---
id: read-model-ownership-mandate-projection-fix
status: active
rank: 5
type: refactor
notes: "Spun out of WS-C (read-model-ownership-w-c-consumer-conversions) 2026-06-02. The compliance-ctrl + DWC MandateSnapshot P1 projectVersioned conversion is blocked by a producer-contract gap: OPERATING_MODE_CHANGED is CDC'd from the InvestorProfile row (a different __version counter + a partial payload missing level/status/effectiveDate/mandateId), not the Mandate row — so a single-version-line full-row P1 projection is impossible. Scope: (1) an investor-bff producer fix putting operatingMode changes on the Mandate version line carrying full Mandate state; (2) convert compliance-ctrl MandateSnapshot + DWC mandate-projector MandateSnapshot to projectVersioned + register Projection<'P1'> in both. Opens with a small design decision on the producer approach. Ranked before WS-D (its mandatory gate needs MandateSnapshot registered)."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "Any change to the operating-mode FEATURE behavior (Phase-2 agent mode-awareness, updateOperatingMode mutation surface) — this item only changes how the operatingMode CHANGE is carried + versioned on the Mandate event stream so projectors can do full-row P1."
  - "Real-LLM e2e — runs in the program-end consolidated pass at WS-D (2026-06-02 cadence decision); this item's gate is the cheap set + deploy of the touched producers/consumers."
validation_gate: null
---

# Mandate projection fix — single version line + P1 conversion

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


Spun out of `read-model-ownership-w-c-consumer-conversions` on 2026-06-02 when WS-C
planning verified the producer contract against code.

## The blocker (verified against code, file:line)

The producer-aggregates design (§ "Dual-projection contract (Mandate fan-out)")
assumed investor-bff "publishes one versioned Mandate event stream
(`MANDATE_ISSUED`/`MANDATE_REVOKED`/`OPERATING_MODE_CHANGED`, each carrying
`__version`)" so compliance-ctrl + DWC could project `MandateSnapshot` as
`Projection<'P1'>` via `projectVersioned`. The code does not match:

- `MANDATE_ISSUED` / `MANDATE_REVOKED` are CDC from the **Mandate** row
  (`services/investor/investor-bff/src/service.stack.ts` Egress map `'Mandate': {insert: MANDATE_ISSUED, modify: MANDATE_REVOKED}`).
  Each carries the full Mandate new-image + the Mandate row's atomic `__version`
  (`revoke-mandate.fn.js` does `SET … #v = if_not_exists(#v,:zero)+:one`). ✓
- `OPERATING_MODE_CHANGED` is CDC'd from the **InvestorProfile** composite row via
  `onFieldChange: { operatingMode: OPERATING_MODE_CHANGED }`
  (`update-operating-mode.fn.js` updates the `InvestorProfile` row, not `Mandate`).
  It carries the **InvestorProfile** row's `__version` (a *different* counter) and a
  payload **without** `level`/`status`/`effectiveDate`/`mandateId`.

Two independent consequences make a `projectVersioned('MandateSnapshot', …)` wrong:

1. **Partial payload → field wipe.** `projectVersioned` writes the FULL row. From
   `OPERATING_MODE_CHANGED` it would write a `MandateSnapshot` with `operatingMode`
   but no `level`/`status`/`effectiveDate` — wiping fields the compliance RuleEngine
   reads.
2. **Cross-counter version guard → silent drop.** The guard is `#__version < :version`.
   `MANDATE_ISSUED`=Mandate v1, `OPERATING_MODE_CHANGED`=InvestorProfile v3, a later
   `MANDATE_REVOKED`=Mandate v2 → `2 < 3` ⇒ the revoke is **silently deduplicated**.

Today's field-level `update()`s (no version guard) mask this. Adding the P1 guard
exposes it.

## Scope

1. **Producer fix (investor-bff).** Put operatingMode changes onto the Mandate
   version line carrying full Mandate state, so all three Mandate events share one
   monotonic `__version` and each carries enough to write a full `MandateSnapshot`.
   The exact mechanism is a **design decision** (open with a short brainstorming
   pass). Candidate approaches surfaced during WS-C planning:
   - Route `updateOperatingMode` through the Mandate row (update `Mandate.operatingMode`
     + `Mandate.__version`) and re-source `OPERATING_MODE_CHANGED` from the Mandate
     row's `onFieldChange`. Design-consistent ("single Mandate version line"); means
     operatingMode is owned/denormalized on the Mandate row.
   - Keep the InvestorProfile-row source but emit the FULL current Mandate snapshot +
     the Mandate row's `__version` on `OPERATING_MODE_CHANGED` (carrier enrichment).
   - Other — to be settled in the design micro-pass.
2. **Consumer conversions.** `compliance-ctrl` event-listener `MandateSnapshot`
   (`processMandateIssued`/`processOperatingModeChanged`/`processMandateRevoked`,
   `pk=GuardrailPolicy#…`, `sk=MandateSnapshot`) and `decision-workflow-ctrl`
   `mandate-projector.ts` `MandateSnapshot` (`pk=MandateSnapshot#…`):
   `update()`/`record()` → `projectVersioned` keyed on the Mandate version line;
   register `Projection<'P1'>` in each service's `read-model-ownership.ts`. (Two
   services registering the same `MandateSnapshot` typename as P1 is fine under both
   global and per-service R4 — same tag, no conflict.) Update each service's
   `read-model-ownership.type-test.ts` + unit tests; flip DWC's read-model-ownership
   comment that currently says "MandateSnapshot … registered in WS-C".

Sequenced after `read-model-ownership-w-c-consumer-conversions` (rank 4) and ranked
before `read-model-ownership-w-d-governance-capstone`: WS-D's mandatory-error gate
errors on any intent-written-but-unregistered governed row, and `MandateSnapshot` is
governed — it must be registered (here) before that gate flips.

Validation gate (cheap set + the producer/consumer deploy; real-LLM e2e at WS-D):
`pnpm nx affected -t test,lint` + per-service `typecheck` (investor-bff +
compliance-ctrl + decision-workflow-ctrl) + `pnpm nx run
event-processor:read-model-drift` green + `pnpm nx affected -t test-integration`
(mocked agents) + deploy dev (`--services=investor-bff,compliance-ctrl,decision-workflow-ctrl`).

See [[read-model-ownership-w-c-consumer-conversions]],
[[read-model-ownership-w-d-governance-capstone]], [[project_read_model_redesign]].
