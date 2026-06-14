# Deterministic CLAUDE.md service-card-drift gate — design

- **Date:** 2026-06-14
- **Backlog:** `docs/backlog/service-card-drift-gate.md` (status: active)
- **Type:** tooling
- **Lane:** Complex (new `tools/` check-script + nx target + pre-commit + card migration)

## Problem

Service cards (`services/<domain>/<service>/CLAUDE.md`) are regenerated on demand by the
`audit-service` skill via an LLM read→rewrite, with **no standing gate**. So code silently
drifts from the card. The drift is real and current: in a 6-card sample, 3 cards
(`broker-ctrl`, `investor-adpt`, `investor-bff`) carry stale funding-lifecycle event names
(`WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED` that no longer exist; 7 `DEPOSIT_*`/`WITHDRAWAL_*`
subscriptions omitted).

A deterministic checker that renders the **mechanically-derivable** card sections from code
and enforces card == rendered closes the *class* of drift — the same standing-gate mechanism
as `tools/check-read-model-drift.mjs` (read-model ownership) and `tools/check-typed-subjects.mjs`
(typed-subject convention). Prose / intent / narrative sections remain LLM-owned and ungated.

## Decisions (settled in brainstorming)

1. **Mechanism = generated marker-delimited blocks.** The derivable sections become
   deterministically *rendered from code* inside marker-delimited regions. The gate
   re-renders and enforces `committed == generated`; `--fix` rewrites the blocks. This is the
   "generated artifact must be committed & fresh" CI idiom — deterministic (zero prose-guessing),
   auto-fixable, and the most reusable/liftable pattern. (Chosen over parse-existing-prose, which
   is brittle on heading/sub-label detection and cannot safely auto-fix.)

2. **Parser = the existing `typescript` compiler API** (`typescript ~5.9.3`, already a
   devDependency — **no new dependency**). Resolution through `events.ts` is *mandatory*: 6
   feed-adapter events have key ≠ wire-string
   (`FETCH_REQUESTED: eventName('FETCH_ALPHA_VANTAGE_REQUESTED')`), and the Egress map is a
   nested object. Regex on nested/multiline structures silently mis-parses, and a wrong "truth"
   would *mask* the very drift the gate exists to catch. The outer shape of the two sibling
   gates (pure exported `evaluate()`, exclusion registry, nx target, tmpdir tests) is preserved;
   only the inner parser uses an AST.

3. **DDB-entities block: included** in cut 1 (reliably derivable from owned write-sites; the item
   names it).

4. **Adapter `Rule`-forwarding: covered** in cut 1 (needed to catch `investor-adpt`, one of the
   3 known-stale cards; the cleaner end-state).

## The tool — `tools/check-service-card-drift.mjs`

Pure Node ESM + `typescript`. Exported pure functions so logic is unit-testable against tmpdir
fixtures, mirroring `check-read-model-drift.mjs`:

- `parseEvents(eventsTsPath) → Map<constName, Array<{key, wire}>>` — build the
  const-object → `eventName('WIRE')` resolution map. (`KEY` itself when no events.ts / not a
  `*EventTypes` const.)
- `parseStack(stackTsPath, eventsMap) → { ingress[], egress[], handlers[], ownedTypenames[] }`
  — AST-walk the stack: resolve `Ingress`/`Egress` construct args, adapter `Rule`
  `eventPattern.detailType` arrays (and `addPropertyOverride` `$or` detail-type lists),
  `entry:` handler paths, and intent-factory write typenames; resolve all event-name references
  (const-object members + helper-const arrays) through `eventsMap` to **wire strings**.
- `renderBlock(section, model) → string` — deterministic, sorted markdown for one section.
- `locateBlocks(cardText) → Map<section, {start, end, body}>` — find marker-delimited regions.
- `evaluate(cards, code, exclusions) → { errors, fixes }` — per (service, section): compare
  committed block body vs rendered; emit a drift error (or, in `--fix`, the replacement).

Two modes:

- **check** (default): `exit 1` on any drift, missing-expected-block, or stale-extra-block.
  Prints `[service:section]` + a unified-ish diff snippet pointing at the offending tokens.
- **`--fix`**: insert/update/remove blocks in place. Used by migration and by `audit-service`.

`--root` flag (defaults to cwd) so tests run against a tmpdir, exactly like the siblings.

## Gated sections (generated blocks)

Only mechanically-derivable facts are rendered. Each is a marker-delimited block:

```
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
…deterministically sorted content…
<!-- /card-drift:egress -->
```

| Block | Source of truth | Rendered content |
|---|---|---|
| `event-types` | `src/domain/events.ts` | Per `export const *EventTypes = {…} as const`: list `KEY`, or `KEY (WIRE)` when `eventName('WIRE') ≠ KEY`. Grouped by const name, sorted. |
| `ingress` | `Ingress` construct `eventTypes[]` (ctrl/bff) **or** adapter `Rule` `eventPattern.detailType[]` arrays | Per ingress/rule: handler-or-target + **resolved** subscription event-name **set**. |
| `egress` | `Egress` construct nested `eventTypes` map | Per entity key: emitted event-name **set**. (Insert/modify/onFieldChange routing nuance is NOT gated — only set membership.) |
| `handlers` | `entry:` paths in the stack | Handler **filenames** only. |
| `ddb-entities` | Egress entity keys ∪ intent-factory write typenames (`project`/`projectVersioned`/`accumulate`/`update`/`updateOrRetry`/`record`) | Sorted set of typenames this service **owns/writes**. |

**Never gated** (stay LLM-owned prose, untouched by the tool): handler descriptions, Egress
routing nuance, Read-model ownership, IAM trace, feature flags, MFE hosting, Event Payload
Contracts, Why/intent/narrative. The gate only ever reads/writes *between its own markers*;
everything else in the card is invisible to it.

### Rendering rules (determinism)

- All sets sorted ascending (stable diffs).
- Event names are the **resolved wire strings** (what subscribers match on the bus); the
  `event-types` block additionally shows the const `KEY` when it differs.
- Comparison normalizes trailing whitespace per line and a single trailing newline; nothing else.

## Service-type handling — structural, not name-based

A block is *expected* for a service iff its source signal exists:

- `event-types` ⇐ `src/domain/events.ts` exists with ≥1 `*EventTypes` const.
- `ingress` ⇐ stack has ≥1 `Ingress` construct **or** ≥1 forwarding `Rule`.
- `egress` ⇐ stack has an `Egress` construct.
- `handlers` ⇐ stack has ≥1 `entry:` handler.
- `ddb-entities` ⇐ ≥1 owned write typename or Egress entity key.

This auto-skips **hubs** (no Ingress/Egress/events.ts → no event blocks) and **investor-web**
(frontend MFE stack, no event constructs) with zero special-casing. A card that *has* a block
the code says it shouldn't → stale-extra-block error (the construct was removed but the block
lingers).

## Exclusion registry — `tools/service-card-exclusions.json`

Mirrors `read-model-exclusions.json`: array of `{ service, section?, reason }` with a non-empty
`reason` (malformed → throw). `section` omitted ⇒ whole service excluded; present ⇒ that one
section excluded. For genuine opt-outs (a service whose derivable section is legitimately
non-standard). Starts empty/minimal; the migration determines whether any entries are needed.

## Wiring

- **nx target** `card-drift` on `libs/event-processor` (the established host for `read-model-drift`
  + `typed-subject-drift`), `executor: nx:run-commands`, `cache: true`,
  `command: node tools/check-service-card-drift.mjs`. Inputs:
  `{workspaceRoot}/services/**/CLAUDE.md`, `{workspaceRoot}/services/**/src/service.stack.ts`,
  `{workspaceRoot}/services/**/src/domain/events.ts`,
  `{workspaceRoot}/services/**/src/**/*.ts` (for intent-factory write typenames),
  `{workspaceRoot}/tools/check-service-card-drift.mjs`,
  `{workspaceRoot}/tools/service-card-exclusions.json`.
- **Pre-commit Check 9** in `scripts/verify-structure.sh`: a blocking, daemon-free
  `node tools/check-service-card-drift.mjs` invocation modeled exactly on Check 8
  (typed-subject). Direct node — not `nx affected` — so it is unaffected by the
  `precommit-hook-fatal-on-nx-daemon-failure` parking item.

## audit-service integration (closes the root cause)

The root cause is that `audit-service` LLM-regenerates the *whole* card, including the derivable
sections, with no standing check. After this gate lands:

- `audit-service` runs `node tools/check-service-card-drift.mjs --fix` to deterministically
  refresh the generated blocks, and LLM-regenerates **only** the prose sections.
- Update `.claude/skills/audit-service/SKILL.md` to document the division (generated blocks are
  machine-owned; never hand-write or LLM-write between `card-drift:*` markers).

## Migration = the validation gate

1. Run `node tools/check-service-card-drift.mjs --fix` across all 32 cards.
2. Review the diff. The 3 known-stale cards self-correct; any further drift the gate surfaces is
   reviewed and the card (or, if the *code* is wrong, the code) is fixed.
3. Commit cards + tool + target + pre-commit + exclusions together.
4. `node tools/check-service-card-drift.mjs` exits 0 across the repo.

The committed gate-green output + corrected-card diff is the `validation_gate` evidence.

## Testing

Unit tests (Jest, tmpdir fixtures) on the pure functions:

- clean ctrl/bff service (Ingress + Egress + events.ts) → blocks render & match.
- key ≠ wire case (feed adapter) → `KEY (WIRE)` rendered, resolution correct.
- adapter `Rule`-forwarding case → forwarded detail-type set rendered.
- drift case (card missing a token / phantom token) → error with the offending token.
- missing-expected-block / stale-extra-block → errors.
- exclusion entry (service + section) → suppressed.
- hub / web (no event constructs) → no blocks expected, no error.

Plus the real gate green across the repo after migration (`evaluate` over the live tree).

## Out of scope

- Gating prose/intent/narrative card sections — those stay LLM-regenerated by `audit-service`;
  only the mechanically-derivable blocks are gated.
- Auto-rewriting *prose* sections from code — `--fix` only ever touches content between
  `card-drift:*` markers.
- Changing `audit-service`'s LLM behavior beyond the block-division described above.
- Adapter event-name redeclare-vs-reexport integrity (separate LATER item
  `adapter-event-name-redeclare-vs-reexport`).
- Bringing the 5 GitHub CI workflows green (`ci-pipeline-bring-up`) — this wires the gate into
  the existing nx-target + pre-commit path only.
- Gating the Egress insert/modify/onFieldChange **routing nuance**, handler **descriptions**,
  Read-model ownership, IAM trace, feature flags, MFE hosting — all editorial / non-mechanical.
