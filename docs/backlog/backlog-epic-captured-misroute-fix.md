---
id: backlog-epic-captured-misroute-fix
status: shipped
type: tooling
notes: "Backlog router/closure defect: epic_role core-vs-captured keyed on scope: enumeration + a 'when unsure choose captured' bias, so required (done_when-load-bearing) work got filed as captured and silently leftover-spun-out at close; and findings with mixed closure-relevance were filed as one item. Fix: predicate routing + atomicity invariant + ship-time captured audit (lint surfaces the checklist)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "47/47 backlog-lint unit tests green incl. 3 new epicCapturedAudit tests; lint.mjs prints the active epic's open captured members on every run (verified: 12 after split); CLAUDE.md § Backlog Discipline + backlog-add/SKILL.md router + backlog-lint/SKILL.md updated. Driven by surfacing the typed-test-fixtures epic's misrouted members (gate-hole + mixed deferred item)."
---

# Backlog epic router/closure defect — required work hid as `captured`

## The defect (surfaced 2026-06-19)

Auditing the `typed-test-fixtures` epic's `captured · parking` members revealed two structural
faults in the backlog epic machinery:

1. **`core` vs `captured` keyed on `scope:` enumeration, not `done_when`.** The `backlog-add`
   hot-path router (and CLAUDE.md § Backlog Discipline) decided `epic_role: core` iff the finding
   was in the epic's `scope:` list, else `captured` — *"be generous … when unsure, choose
   captured."* But an epic's closure predicate lives in `done_when:` ("all ~290 putEvent sites
   migrated", "regression gate forbids untyped putEvent"), which is broader than the `scope:`
   phase enumeration. So findings that were genuinely load-bearing for `done_when` but not one of
   the enumerated phases fell to `captured` — and since captured members **never block closure**
   and auto-spin-out at close, required work silently dropped out of the done-definition.
   - Concrete: `check-typed-fixtures-dynamic-detailtype-gap` (a hole in the "regression gate"
     deliverable) was `captured`; the migratable cross-domain consumer fixtures were buried inside
     a captured item. Both are required for `done_when`.

2. **Mixed items (closure-relevance not atomic).** `typed-test-fixtures-execution-deferred-cross-domain`
   bundled migratable consumer fixtures (required → core) **and** the `ORDER_*` family blocked on
   out-of-scope production forks (orthogonal → captured) under one `captured` label. A single item
   cannot carry a correct `epic_role`, so the required half hid under the captured one.

## The fix (3 parts, applied 2026-06-19, on main)

- **Predicate routing** — `core` if leaving the finding undone falsifies a `done_when` clause
  (everything in `scope:` plus anything else `done_when` requires); `captured` only if genuinely
  orthogonal. Bias inverted: *when unsure whether load-bearing, choose core.*
  (`CLAUDE.md`, `backlog-add/SKILL.md`.)
- **Atomicity invariant** — one backlog item = one closure verdict; a finding split across the
  verdict is filed as separate homogeneous items, never one mixed item.
  (`CLAUDE.md`, `backlog-add/SKILL.md`.)
- **Ship-time captured audit** — the close ritual re-tests every open captured member against
  `done_when` before spin-out; load-bearing ones are promoted to `core` (not spun out). Backed by
  a mechanical lint surface: `lint.mjs` prints the active epic's open captured members as the
  audit checklist on every run (`epicCapturedAudit` in `lib/rules.mjs`, unit-tested).
  (`CLAUDE.md` rule-9 narrative + ship steps, `backlog-lint/SKILL.md`, `lint.mjs`.)

## Follow-on applied in the same session

Split `typed-test-fixtures-execution-deferred-cross-domain` (now only the blocked `ORDER_*`
family, stays captured) → spun out `[[typed-test-fixtures-cross-domain-consumer-migration]]`
(core, queued); promoted `[[check-typed-fixtures-dynamic-detailtype-gap]]` captured→core, queued.
