# Design — Ban dynamic `detailType` in `check-typed-fixtures` (close the gate blind spot)

- **Date:** 2026-06-19
- **Backlog:** `check-typed-fixtures-dynamic-detailtype-gap` (core member of epic `typed-test-fixtures`)
- **Topic memory:** `project_event_subject_contracts.md`
- **Status:** approved (brainstorming) → writing-plans next

## 1. Problem

`tools/check-typed-fixtures.mjs` is the registry-driven regression gate for the typed-test-fixtures
program. It resolves a `putEvent({ … })` call's `detailType` only as a **static literal** (a quoted
string or a dotted/bare identifier like `Foo.BAR`). When `detailType` is a **bare runtime variable
or computed expression**, the gate emits a `note:` to stderr and **skips the call** (gate
`tools/check-typed-fixtures.mjs:124-129`).

This is a structural blind spot, not a per-fixture defect:

- The typed `putEvent` overload binds `subject: SubjectOf<K>` only when `K` is a **literal**. A
  dynamic `detailType` therefore routes through the **untyped** overload — so a co-wrong subject at
  such a site is caught by **neither** `tsc` **nor** the gate.
- It let parameterized fixtures slip past the per-phase migrations. Two truly-dynamic sites exist
  today, both `it.each` blocks in
  `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`:
  - `notificationEvents` (`:117`) — a **12-element** array emitted via the legacy untyped form with
    a **shorthand** `detail` property (so `HAS_DETAIL` — which matches only `detail:` — misses it
    too). Per the gate registry (source of truth): **10 registered** — `ONBOARDING_COMPLETED`,
    `MANDATE_ISSUED`, `MANDATE_REVOKED`, `DEPOSIT_INITIATED`, `DECISION_APPROVED`, `BALANCE_UPDATED`,
    `DECISION_BLOCKED`, `WITHDRAWAL_SETTLED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED` — and **2
    unregistered** (`ORDER_FILLED`, `ORDER_REJECTED`, both the deferred `ORDER_*` family).
  - `circuitBreakerEvents` (`:195`) — emits `BROKER_CIRCUIT_OPEN`/`_CLOSED`/`BROKER_HEAL_ESCALATED`
    with empty `detail: {}` (all 3 registered).
  - **Total: 13 registered → typed migration; 2 unregistered → documented legacy literals.**

This is load-bearing for the epic's `done_when` deliverable
*"regression gate forbids untyped `putEvent` in migrated domains"* — while the blind spot exists the
gate does not fully forbid untyped `putEvent`, so the clause is not yet true.

## 2. Goal / done-definition

1. The gate **forbids dynamic `detailType` outright**: any `putEvent` whose `detailType` is not
   statically resolvable to a literal name is a **violation** (no escape hatch, no tolerated note).
2. The gate **strips comments** before scanning, so a `putEvent(…)` occurrence inside a `//` or
   `/* */` comment is never matched (required: an absolute ban would otherwise false-positive on the
   documentation example at `advisory-bff.integration.test.ts:43`).
3. The gate is **refactored into testable exported functions + a thin CLI**, mirroring the sibling
   `tools/check-typed-subjects.mjs`, and ships with a `node:test` suite.
4. The two `it.each` blocks are **unrolled to per-event literal calls**; the **13 registered** events
   use the typed `subject:`/`context:` form; `ORDER_FILLED` + `ORDER_REJECTED` stay unregistered
   literals (documented, deferred to the parked `ORDER_*` family).
5. `node tools/check-typed-fixtures.mjs` runs **green repo-wide**, and the involved
   `onboarding-notification` integration coverage still passes against deployed dev.

## 3. Design

### 3.1 Gate refactor + behavior — `tools/check-typed-fixtures.mjs`

Refactor the monolithic script into pure, exported functions plus a thin CLI, matching the
`check-typed-subjects.mjs` shape so the same `node:test` style applies:

- `stripComments(src) → src'` — string/template-literal-aware removal of `//` line and `/* */`
  block comments. Replaces comment characters with **spaces (preserving newlines)** so reported line
  numbers are unchanged. Must NOT strip inside `'…'`, `"…"`, or `` `…` ``.
- `scanFile(file, src) → { violations: string[], notes: string[] }` — runs the per-file checks on
  `stripComments(src)`.
- `scanTree(roots) → { violations, notes }` — walks the scan roots, aggregates.
- thin CLI `main()` — prints notes to stderr, prints violations + `process.exit(1)` if any, else the
  OK line. Same exit contract as today.

**New rule — dynamic-`detailType` ban.** For each `putEvent({ … })` block, extract `detailType`
with the existing literal/member regex. If it does **not** resolve to a literal name → **violation**:

> `<file>:<line>: dynamic detailType — putEvent requires a literal detailType (a string or an
> EventTypes.NAME member); unroll to per-event literal calls and use the typed subject:/context:
> overload.`

This **replaces** the old dynamic-`note:` path and has **no `detail:` precondition** (so it catches
dynamic sites regardless of `detail:` vs shorthand `detail`).

**Preserved behaviors (regression-protected by the new test):**

- Resolvable literal / `EventTypes.NAME` member → trailing-name registry lookup:
  - trailing name **registered** AND block has a `detail:` key → legacy-form violation (unchanged);
  - trailing name **not registered** → clean (member keeps its informational note). So
    `BrokerCtrlEventTypes.ORDER_FILLED` and a bare `'ORDER_REJECTED'` literal stay clean.
- The `.subject as T`-inside-`putEvent` cast check (unchanged).

### 3.2 Gate test — `tools/check-typed-fixtures.test.mjs` (`node:test`)

Mirror `check-typed-subjects.test.mjs` (in-memory `scanFile`/`scanTree` + `spawnSync` CLI). Cases:

1. dynamic `detailType` (bare variable) → violation
2. literal **registered** + `detail:` → violation (regression)
3. `Foo.BAR` member, registered + `detail:` → violation
4. `Foo.BAR` member, **unregistered** → clean
5. bare literal, unregistered → clean
6. typed form (`subject:`/`context:`, no `detail:`, literal) → clean
7. `putEvent(…)` inside a `//` comment → ignored
8. `putEvent(…)` inside a `/* */` comment → ignored
9. `.subject as T` inside `putEvent` → violation (regression); the same cast in a `mapPayload`
   callback outside `putEvent` → clean (regression)
10. CLI: exit 1 with a violation present, exit 0 when clean

### 3.3 Fixture migration — `onboarding-notification.integration.test.ts`

Unroll **both** `it.each` blocks to explicit per-event `it(…)` calls (the absolute ban makes an
`it.each` over a `detailType` variable incompatible with typed emission). Preserve every existing
assertion (a `NOTIFICATION_CREATED` arrives via CDC; for the circuit-breaker block,
`subject.tenantId === 'SYSTEM'` and `subject.type === detailType` — note that asserted `subject` is
the *outgoing Notification* envelope, not the injected subject, so it is unaffected by the input
migration). No test reads any field of the *injected* subject, so each migrated subject only needs
to be **minimally schema-valid** (the typed `putEvent` runtime backstop `EventSubjects[K].parse`
enforces this offline before any send).

- **`notificationEvents`** → unroll the 12-element array to explicit per-event `it(…)` calls:
  - The **10 registered** (`ONBOARDING_COMPLETED`, `MANDATE_ISSUED`, `MANDATE_REVOKED`,
    `DEPOSIT_INITIATED`, `DECISION_APPROVED`, `BALANCE_UPDATED`, `DECISION_BLOCKED`,
    `WITHDRAWAL_SETTLED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED`) become typed
    `putEvent({ …, detailType: '<LITERAL>', subject: <minimal schema-valid>, context: { tenantId: ctx.tenantId } })`.
    Most current `detail` payloads are NOT schema-valid (e.g. `BALANCE_UPDATED` lacks `snapshot`;
    `OPERATING_MODE_CHANGED` lacks `mandateId/level/status/effectiveDate`) — construct minimal valid
    subjects per each producer schema. If a real shape surfaces a genuine co-wrong/contract issue,
    **fix-or-file** (do not expand scope).
  - **`ORDER_FILLED`** and **`ORDER_REJECTED`** → kept as literal legacy forms
    `putEvent({ detailType: '<LITERAL>', detail: { … } })` with a `// deferred:` comment pointing at
    `typed-test-fixtures-execution-deferred-cross-domain`. Both unregistered → gate-clean. Not
    migrated (respects the parked `ORDER_*`/`NormalizedOrderEvent` family + epic atomicity).
- **`circuitBreakerEvents`** → 3 typed calls for `BROKER_CIRCUIT_OPEN`/`_CLOSED`/`BROKER_HEAL_ESCALATED`
  with minimal `BrokerCircuitEventSchema` subjects `{ adapter, timestamp }` (today `detail: {}`).

### 3.4 Validation

- `node tools/check-typed-fixtures.test.mjs` passes (new suite).
- `node tools/check-typed-fixtures.mjs` green repo-wide.
- `pnpm nx run-many -t test,lint` on the true-affected projects (investor-ctrl + the tooling
  project, if the gate test is wired to one).
- **No deploy** (test-only change; investor-ctrl src unchanged → `detect-deploy-needed` should skip).
- Integration validation against deployed dev: run the involved `onboarding-notification`
  integration suite to confirm the typed subjects drive the real handlers and CDC still emits
  `NOTIFICATION_CREATED`. (Pre-authorized per CLAUDE.md.) Verify the gate + test on **real main**
  after merge — a symlinked-node_modules worktree can mask resolution failures.

## 4. Out of scope (file as follow-ups; do not expand)

- Wiring the gate into an nx target / pre-commit hook (it is the `check:typed-fixtures` package.json
  script today). Separate concern; file if it blocks.
- Typed migration of the parked `ORDER_*`/`NormalizedOrderEvent` family (incl. `ORDER_REJECTED`) —
  blocked on out-of-scope production forks per `typed-test-fixtures-execution-deferred-cross-domain`.
- The **shorthand-`detail`** detection gap (`HAS_DETAIL` matches only `detail:`, not shorthand
  `detail`). The absolute dynamic ban already catches today's shorthand-`detail` sites because their
  `detailType` is dynamic; a *literal*-`detailType` + shorthand-`detail` + registered site would
  still be missed. Adjacent gate gap, not load-bearing for this item's `done_when` → file via
  `backlog-add` during execution.
- A DRY `emit<K>()` test-support helper to preserve `it.each` — YAGNI; unrolling suffices.

## 5. Risks

- **Comment stripping** must be string/template-aware and line-number-preserving — covered by tests
  7/8 and a line-number assertion.
- **Schema-conformant subjects** for the 8 registered events may surface latent co-wrong fixtures or
  producer-contract gaps → fix-or-file, do not expand scope.
- **Worktree symlink** can mask module-resolution failures → re-verify gate + test on real main
  post-merge.
