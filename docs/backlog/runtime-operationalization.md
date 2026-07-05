---
id: runtime-operationalization
status: active
type: epic
notes: "Adopt/operationalize the Long-Horizon Engineering Runtime via the probes-first roadmap (re-scoped 2026-07-03): P1 probe the two unproven bets (execute seam, backward edge) → P2 moat live (mint/curate in anger, before enforcement triples) → P3 parity oracle + item schema → P4 check migration with cadence + CI golden gates → P5 work-driver strangler re-platform with soak gate → P6 user-triggered legacy retirement + operator surface. runtime-realization shipped the 3 library slices; THIS epic makes the runtime the project's live enforcement + work-driver, reversibly (docs/backlog stays the one item store — procedures migrate, never data)."
done_when: "The runtime is the project's LIVE enforcement + work-driver, demonstrated not asserted: (1) enforcement — the gate fires diff-scoped on commit (shipped) AND every migrated check runs on a real cadence (commit gate / CI / schedule / epic-batch; judgment checks via a live judge binding), the ~34-surface migration into runtime/content/checks is complete, and the check golden gates run in CI; (2) the backward edge is live-in-anger — at least one real lesson minted through a real floor into a registered check, and curate-at-the-floor is the only sanctioned path past a failing guard (skip-hatch instrumented); (3) item.schema is reconciled with docs/backlog and validated on read; (4) the parity oracle is green — the regression harness grades the runtime loop against the legacy backlog skills on the same scenarios, plus a greenfield adoption e2e; (5) the work-driver is re-platformed — the backlog skills run on the engine loop with legacy fallback, soaked over ≥5 real workstreams with zero fallbacks; (6) the operator surface (view+executor) is shipped. Every core member shipped or dropped."
scope: "The seam + backward-edge probes, live wiring (make-it-fire), backward-edge-live (mint/curate in anger), the full check migration with cadence, item-schema reconciliation, the parity-oracle regression harness, CI-wiring the check golden gates, the work-driver strangler re-platform, and the operator surface. Each a standalone /backlog-next member PR, drained individually like runtime-realization's slices."
out_of_scope:
  - "Re-designing ring-1 engine contracts (schemas/helpers) — frozen by runtime-realization; a build-reconciliation delta re-freezes into SPEC 1, not here."
  - "Authoring NET-NEW checks beyond migrating existing enforcement — new lessons flow through the backward edge / backlog-add."
  - "The 3 spec build slices themselves — that was runtime-realization (shipped)."
references: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime operationalization — adopt the runtime as the live system

`runtime-realization` shipped the Long-Horizon Engineering Runtime as a tested, harness-agnostic **library**
(SPEC 1 registry/atom + SPEC 2 backward edge + SPEC 3 forward edge & capability seams). But **nothing fires
it**: no git hook, CI job, or schedule invokes the loop/watch/gates; the adapter capabilities are stubs until
a host injects live runners; today's real enforcement is still `.git/hooks/pre-commit → tools/check-*.mjs`.

This epic closes that gap — it makes the runtime the project's **actual** enforcement and work loop.

Members (each a standalone `/backlog-next` member PR), in **probes-first roadmap order** (P-phases,
re-scoped 2026-07-03 after the post-make-it-fire design review):

- **P0/P1 — prove it's solid, not a dream:**
  - `runtime-make-it-fire` — the thin live path that dogfoods the seam (SHIPPED 2026-07-03, PR#30).
  - `runtime-seam-probe` — P1a: ONE real workstream through the loop spine; the measured contract-gap list.
  - `runtime-design-redteam` — P1b (captured): adversarial multi-agent review of vision+specs vs code.
- **P2 — the moat, before the bulk:**
  - `runtime-backward-edge-live` — mint-in-anger + curate as the only sanctioned gate bypass +
    skip-hatch instrumentation + the red-team's backward-edge p2 deltas. **Binding: precedes the bulk
    check migration** (otherwise `RUNTIME_GATE_SKIP` becomes de-facto curation at 3x enforcement scale —
    the anti-moat before the moat).
  - `runtime-redteam-hardening` — the red-team's confirmed mechanical fixes (fail-closed registry, ACMR,
    atomic meta.json, journal locking, runnable registry-integrity, single-active semantics, starter-pack
    self-containment).
- **P3 — the migration oracle:**
  - `runtime-item-schema-reconciliation` — align `item.schema.ts` with `docs/backlog`, validate on read.
  - `runtime-regression-harness` — re-scoped as the PARITY ORACLE: same scenarios graded on legacy skills
    vs the runtime loop, + a greenfield adoption e2e (init → violation → gate → mint → curate). The
    objective "value ≥ legacy AND more" instrument and the go/no-go for P5.
- **P4 — enforcement completion:**
  - `runtime-check-migration-completion` — the remaining ~23 surfaces → content-ring YAML, where
    "migrated" = *runs on a real cadence* (judgment tier needs a live judge binding), not "has YAML".
  - `runtime-check-goldengates-ci` — wire the existing `tools/check-*.test.mjs` fixtures into CI
    (orthogonal quick win; may land any time from P1).
- **P5/P6 — the work-driver:**
  - `runtime-work-driver-replatform` — strangler re-platform of the backlog skills onto the engine,
    legacy behind a flag, ≥5-workstream soak gate; legacy retirement is user-triggered (P6).
  - `runtime-operational-surface` — the §14 view+executor (re-homed from runtime-realization).

**Sequencing rationale:** probes before bulk investment (the execute seam and the backward edge are the
two unproven bets — test them empirically for the cost of two sessions); curate-at-the-floor before
enforcement triples; migration only once something runs the checks; the work-driver re-platform last,
behind the parity oracle and the re-frozen seam contract. Rollback stays trivial at every phase because
`docs/backlog` remains the single item store — only procedures migrate, never data.
