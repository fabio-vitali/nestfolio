# Agent Contract Tests — split into three plans

This plan has been split into three self-contained, sequentially-executable plans for easier review. **Do not implement from this file** — it is an index.

## Execute in order

1. **Foundation** — `2026-04-19-agent-contract-tests-01-foundation.md`
   Library core (`AgentTracer`, `TraceEmitter`, `EventBridgeTraceEmitter`, `NoopTraceEmitter`, extended `InvokeOptions`) and the four missing `tsconfig.base.json` path aliases. Lands unused public API; no service behaviour changes.

2. **First rollout** — `2026-04-19-agent-contract-tests-02-first-rollout.md`
   `advisory-narrative-ctrl` end-to-end (event, graph refactor, emitter, IAM grant, CDK assertion, deploy, e2e) plus the `AgentTraceTrap<K extends AgentKey>` helper class (narrative-only scaffold). Validates the full shape before it gets templated across five more services. Depends on plan 1.

3. **Remaining services + handoff** — `2026-04-19-agent-contract-tests-03-remaining-services.md`
   Portfolio-engine, investor-profile, decision-lifecycle (three scenarios), market-intelligence, onboarding (deferred assertion), plus cross-phase verification, MEMORY.md update, optional C4 regen, and deferral log. Depends on plans 1 and 2.

## Why split

- The original single plan was ~3000 lines / 9 phases. Easier to review and ship in three waves.
- Each split plan has its own verification checklist, success criteria, and commit cadence — independently mergeable.
- Phases 3–8 are structurally identical (declare event → wire emitter → grant IAM → widen helper → assert). Plan 3 bundles them because they share the same pattern and reviewing them as a unit surfaces the per-service variance more cleanly than six separate plans would.

## Authoritative source

- Design spec: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`
- Cross-cutting guidance, known deviations, and "does NOT do" list live at the bottom of each split plan; the foundation plan carries the deviations that affect every subsequent plan.
