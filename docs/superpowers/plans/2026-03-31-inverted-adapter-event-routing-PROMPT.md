Execute the implementation plan at `docs/superpowers/plans/2026-03-31-inverted-adapter-event-routing.md` using the `superpowers:subagent-driven-development` skill.

## Context

We're replacing the "push" cross-domain event routing pattern with a "pull" (ingestion) pattern across all 4 domain adapters. Instead of each adapter deploying EventBridge rules on its own bus to forward events out to foreign buses, each adapter now deploys rules on foreign buses to ingest events into its own bus. This gives each domain consumer autonomy over its own subscriptions.

## What's already done

- Design spec committed: `docs/superpowers/specs/2026-03-31-inverted-adapter-event-routing-design.md`
- Implementation plan committed: `docs/superpowers/plans/2026-03-31-inverted-adapter-event-routing.md`
- No code changes yet — the plan starts from the current push model

## Plan summary (10 tasks)

1. **CrossAccountBusPolicy** — expand resource policy actions in `libs/cdk-constructs/src/extensions/cross-account.ts`
2. **investor-adpt** — add `InvestorIngestEventTypes`, rewrite stack to pull from Advisory/Execution/Ledger buses, rewrite tests
3. **advisory-adpt** — add `AdvisoryIngestEventTypes`, rewrite stack to pull from Investor/Execution/Ledger buses, rewrite tests
4. **execution-adpt** — add `ExecutionIngestEventTypes`, rewrite stack to pull from Advisory/Investor buses, rewrite tests
5. **ledger-adpt** — add `LedgerIngestEventTypes`, rewrite stack to pull from Execution bus, rewrite tests
6. **Service cards + READMEs** — update all 4 adapter CLAUDE.md and README.md files
7. **domains.md skill** — update Adapter Forwarding sections and Cross-Domain Event Topology
8. **orient.md skill** — update adapter descriptions and communication pattern diagram
9. **Flow specs** — update SCHEMA.md, all 10 flow YAML files, and `tools/generate-flow-docs.mjs`
10. **Validation** — run all adapter tests, lint, and pre-commit structure verification

## Execution notes

- Tasks 2-5 (adapter rewrites) are independent and can be parallelized
- Task 1 must complete first (shared library change)
- Tasks 6-9 (docs/skills) are independent and can be parallelized after tasks 2-5
- Task 10 is the final validation gate
- Existing `CrossDomainEventTypes` enums must NOT be removed — they're imported by same-domain services (investor-ctrl, advisory-ctrl, etc.)
- The system has not been deployed, so no backward compatibility is needed
- Run tests with `pnpm nx test {project}` and lint with `pnpm nx lint {project}`
