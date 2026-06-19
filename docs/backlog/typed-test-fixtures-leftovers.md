---
id: typed-test-fixtures-leftovers
status: parking
type: epic
notes: "Auto-spun-out at the typed-test-fixtures epic ship (2026-06-19): the genuinely-orthogonal captured findings surfaced by the program. Holding bucket pending re-clustering by backlog-themes. Theme epic, 12 members."
done_when: "Each residual finding spun out of the typed-test-fixtures epic is resolved, dropped, or re-clustered by backlog-themes into a sharper root-cause theme; all members shipped or dropped."
scope: "The 12 genuinely-orthogonal captured findings surfaced by the typed-test-fixtures program: contract-cleanup (broker-sim non-DRY/stale, route-order non-DRY, dwc-sf-command non-DRY), blocked-on-producer-infra fixture-typing (corporate-action / portfolio-snapshot, investor-web USER_* contracts surface), co-wrong/thin consumer fixtures already migrated but documenting a consumer concern (dashboard-bff DECISION_BLOCKED reason, ledger-ctrl DECISION_PACKET thin shape, sec-prospectus pe-ctrl), a deliberate registry-collision deferral (PORTFOLIO_DRIFT_DETECTED), a gate-hardening edge with zero real sites (check-typed-fixtures shorthand detail), consumer dead-code (yahoo-finance subject.region), and a declared-but-never-emitted event (ACCOUNT_CLOSURE_REQUESTED)."
out_of_scope:
  - "Anything load-bearing for the typed-test-fixtures done_when — by construction none of these are (the green check-typed-fixtures gate proves the all-sites-migrated + gate-forbids-untyped clauses hold without them); each satisfies done_when by being a FILED contract finding."
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# typed-test-fixtures — residual findings (leftovers)

Auto-spun-out when the `typed-test-fixtures` delivery epic shipped (2026-06-19) with all 12 core
members terminal. These are the **captured** members that rode along for unified session context but
are **genuinely orthogonal** to the epic's `done_when` — each is a FILED latent contract finding,
a producer-side cleanup, a blocked-on-producer-infra fixture-typing item, a deliberate registry
deferral, a gate-hardening edge with zero real sites, or consumer dead-code. The epic's
`done_when` clause "every surfaced co-wrong fixture fixed OR its latent contract bug FILED" is
satisfied for all of them by their existence as backlog items, and the green
`check-typed-fixtures` gate (0 violations, 89 registered events) independently proves the
all-sites-migrated and regression-gate clauses without any of them.

This is a **holding bucket pending re-clustering** by `backlog-themes` — these 12 are heterogeneous
(several would re-cluster onto the existing DRY-subject / producer-contract / weight-drift themes),
not a single coherent root cause. Run `backlog-themes` to redistribute them.

Members (derived from `epic:` pointers):
- `account-closure-requested-never-emitted`
- `broker-sim-inbound-schemas-nondry-stale`
- `check-typed-fixtures-has-detail-shorthand-gap`
- `corporate-action-portfolio-snapshot-no-producer-contract`
- `dashboard-bff-decision-blocked-reason-field-mismatch`
- `dwc-sf-command-subject-tenantid-nondry`
- `investor-web-event-contracts-surface`
- `ledger-ctrl-decision-packet-fixture-thin-shape`
- `portfolio-drift-detected-registry-collision`
- `route-order-userid-in-subject-nondry`
- `sec-prospectus-pe-ctrl-fixture-contract-mismatch`
- `yahoo-finance-mi-ctrl-subject-region-dead-code`
