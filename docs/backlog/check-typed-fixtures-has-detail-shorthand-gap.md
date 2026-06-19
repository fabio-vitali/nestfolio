---
id: check-typed-fixtures-has-detail-shorthand-gap
status: parking
type: tooling
notes: "check-typed-fixtures HAS_DETAIL matches only /\\bdetail\\s*:/ — a putEvent({ detailType: 'REGISTERED', detail }) with shorthand `detail` escapes the legacy-detail violation. ZERO real sites today (dynamic ban covers the rest); trivial 1-line fix. Captured under typed-test-fixtures."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# check-typed-fixtures `HAS_DETAIL` misses the shorthand `detail` property

Surfaced 2026-06-19 during `check-typed-fixtures-dynamic-detailtype-gap` execution.

`tools/check-typed-fixtures.mjs` flags the legacy untyped form
`putEvent({ detailType: 'REGISTERED', detail: ... })` only when `detail` is written as a key with a
colon — `HAS_DETAIL = /\bdetail\s*:/`. A **shorthand** `detail` property
(`putEvent({ ..., detailType: 'X', detail })`, no colon) does NOT match, so a registered-event
legacy form using shorthand `detail` would escape the legacy-detail violation check.

**Why this is `captured`, not load-bearing today.** The absolute dynamic-`detailType` ban shipped in
`[[check-typed-fixtures-dynamic-detailtype-gap]]` already catches every shorthand-`detail` site that
exists today, because each one also used a *dynamic* `detailType` (the `it.each` loop variable) — and
the dynamic ban fires regardless of the `detail` form. The residual hole is the specific combination
**literal `detailType` + shorthand `detail` + registered name**, of which a probe (2026-06-19) found
**ZERO real sites** across `services/**`, `libs/**`, and `apps/e2e-feature-tests/src`. So the epic's
`done_when` clause *"regression gate forbids untyped putEvent in migrated domains"* holds — every
untyped `putEvent` that actually exists in a migrated domain is forbidden. Re-test at the epic's
captured-audit (if a future fixture introduces a shorthand-`detail` literal site, promote to `core`).

**Trivial fix.** Broaden `HAS_DETAIL` to `/\bdetail\b\s*[,}:]/` — the `\b` after `detail` keeps it
from matching `detailType` (no word boundary between `detail` and `Type`), while `[,}:]` catches the
colon form (`detail:`), the mid-object shorthand (`detail,`), and the last-property shorthand
(`detail }`). Add one `node:test` case (shorthand-`detail` + registered → violation). Zero fixture
fallout (no real sites). See `tools/check-typed-fixtures.mjs` + `tools/check-typed-fixtures.test.mjs`.
