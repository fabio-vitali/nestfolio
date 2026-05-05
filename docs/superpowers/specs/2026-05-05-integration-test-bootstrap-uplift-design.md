# Integration Test Bootstrap Uplift — Wire OrphanReaper into TestContext

**Date:** 2026-05-05
**Status:** Proposed (pending approval)
**Scope:** `libs/test-support`, `libs/integration-testing`, all 44 `*.integration.test.ts` suites
**Supersedes (partial):** `docs/superpowers/specs/2026-04-16-integration-test-mock-resilience-design.md` Sections 1–3 are SHIPPED; this spec addresses the unshipped consequence — coverage gap created by per-suite manual wiring.

## Problem

`OrphanReaper` (shipped 2026-04-16) is wired in **10 of 44 integration test suites** (23%). The 34 missing suites silently leak `integ-mock-*` Lambda functions, `integ-mock-*` IAM roles, `integ-trap-*` SQS queues, and `integ-trap-*` EventBridge rules across all four domain buses on every interrupted run. The leaked resources accumulate until somebody notices the AWS Console clutter or an account-level limit (Lambda function count, IAM role count) starts firing.

The root cause is **per-suite manual wiring as the activation mechanism**. The 2026-04-16 spec specified `await new OrphanReaper(ctx).cleanup()` in each suite's `beforeAll`, but nothing prevents new suites from omitting it, and 34 existing suites never got the wire-up. This is the same failure mode the spec was supposed to prevent (silent test-infra drift).

**Coverage as of 2026-05-05:**

| Tier | Count | Suites |
|---|---|---|
| With OrphanReaper | 10 | broker-alpaca-adpt, investor-bff, investor-profile-ctrl (×2), portfolio-engine-ctrl (×2), advisory-narrative-ctrl (×2), market-intelligence-ctrl (×2) |
| Without OrphanReaper | 34 | All cross-domain `*-adpt/from-*` (8), all bff except investor-bff (4), compliance-ctrl (×2), decision-workflow-ctrl (×2), all execution-domain except broker-alpaca-adpt (×2), all ledger-domain (6), all external-API adpt (5), onboarding-bff, investor-ctrl (×2), broker-sim-adpt, broker-alpaca-adpt.resilience |

**StateResetFixture coverage** (audited 2026-05-05): only 2 global-key DDB patterns exist codebase-wide — `CircuitBreaker#alpaca` (broker-alpaca-adpt) and `FeatureFlag#SYSTEM` (investor-bff). Both already wired. **No expansion needed.** This spec does NOT touch StateResetFixture.

## Design

### Approach: shared bootstrap helper in `libs/integration-testing`

Add a new factory `createIntegrationTestContext()` in `libs/integration-testing` that composes `createTestContext()` + `OrphanReaper.cleanup()`. All 44 integration test suites switch to the new helper. Suites that don't need AWS cleanup (e.g. test-support's own self-tests) keep using the lower-level `createTestContext()` from `libs/test-support`. **Opt-out is implicit** — chosen by which factory the test imports.

### Why this shape (not lift into `createTestContext` directly)

`libs/test-support` does NOT currently depend on `libs/integration-testing` (the dependency runs the other way: integration-testing → test-support for `TestContext`). Lifting OrphanReaper into `createTestContext` would invert the layering. Adding a thin wrapper in the higher layer respects the existing boundaries.

A secondary benefit: the helper name itself documents intent. `createTestContext()` returns a context. `createIntegrationTestContext()` returns a context AND has cleanup side effects. The asymmetry is honest.

### File changes

**New:**
- `libs/integration-testing/src/bootstrap.ts` — exports `createIntegrationTestContext(options?)` that calls `createTestContext(options)` then `await new OrphanReaper(ctx).cleanup()` and returns the context.

**Modified (shared lib):**
- `libs/integration-testing/src/index.ts` — export `createIntegrationTestContext` alongside the existing `OrphanReaper` (kept exported for tests that need direct access, e.g. to invoke cleanup mid-test).

**Modified (test suites — sweep, 44 files):**
- All 44 `services/**/test/integration/*.integration.test.ts`:
  - Replace `import { createTestContext, ... } from '@nestfolio/test-support'` with `import { ... } from '@nestfolio/test-support'` + `import { createIntegrationTestContext, ... } from '@nestfolio/integration-testing'`.
  - Replace `ctx = await createTestContext()` with `ctx = await createIntegrationTestContext()`.
  - For the 10 suites that already wire OrphanReaper manually: delete the `await new OrphanReaper(ctx).cleanup()` line (now redundant) and the `OrphanReaper` import if no other reference remains.

**Modified (skill — single doc):**
- `.claude/skills/create-integration-test/SKILL.md` — replace per-suite OrphanReaper wiring example with the new `createIntegrationTestContext()` pattern. Note that direct `new OrphanReaper(ctx).cleanup()` invocation remains supported for advanced cases (e.g. suites that want to also reap mid-test).

**Not modified:**
- `libs/test-support/src/context.ts` — unchanged. `createTestContext` keeps its current contract.
- `libs/integration-testing/src/fixtures/orphan-reaper.ts` — unchanged. Implementation is correct; only the call-site wiring changes.

### `createIntegrationTestContext` signature

```typescript
// libs/integration-testing/src/bootstrap.ts
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { OrphanReaper } from './fixtures/orphan-reaper';

export async function createIntegrationTestContext(
  options?: Parameters<typeof createTestContext>[0],
): Promise<TestContext> {
  const ctx = await createTestContext(options);
  await new OrphanReaper(ctx).cleanup();
  return ctx;
}
```

Three properties:
- **Same options surface as `createTestContext`** — `prefix`, `region`, `timings` pass through unchanged. No new flag to remember.
- **Cleanup is awaited** — orphan reaping is in the test suite's `beforeAll` budget (already 90_000ms in the canonical pattern). Predictable wall-clock vs. fire-and-forget.
- **Cleanup failure is non-fatal** — `OrphanReaper.cleanup()` is best-effort by design (catches and logs all per-resource errors). The bootstrap helper does NOT need to add try/catch.

### Concurrency & safety

OrphanReaper only deletes resources older than 1 hour AND matching `integ-mock-*` / `integ-trap-*` prefixes. Two integration test runs starting concurrently will:
- Skip each other's resources (both runs' resources are <1h old)
- Race-but-converge on truly stale resources from prior runs (both call DeleteFunction; one wins, the other gets ResourceNotFoundException, which the existing best-effort code swallows)

Safe under the existing single-developer + sandbox-prefix model. The CI prefix guard in `createTestContext` (line 43–53) already prevents shared-prefix collisions.

### Performance impact

Per-suite overhead: one `paginateListFunctions` (account-wide, ~1-3s for ~50-200 functions in a typical dev account), one `paginateListRoles` (~1-2s), one `paginateListQueues` (prefixed, fast), one `ListRules` per domain bus × 4 (~1s total). Expected total: 3-6 seconds per suite when there are no orphans to delete; 5-15 seconds when reaping a backlog.

This cost was already paid by the 10 wired suites. The 34 newly-wired suites add this overhead. Acceptable: integration tests already run for minutes per suite; a 5-second bootstrap cost is <5% overhead and the alternative is unbounded resource leakage.

If wall-clock becomes a problem in CI later, the next-step optimization is to gate by `process.env.NESTFOLIO_INTEG_PREFIX === 'dev'` (only reap on the shared dev prefix; CI per-PR prefixes are torn down by their stack tearaways) — but that's a future optimization, not in this spec.

## Validation gate

1. **Static**: `pnpm tsc -b` clean across all 44 services + 2 libs.
2. **Mechanical**: `grep -rln "createTestContext()" services/**/test/integration/` returns **zero** results — every integration suite migrated.
3. **Mechanical**: `grep -rln "new OrphanReaper(ctx).cleanup()" services/` returns **zero** results — manual wiring fully removed (advanced direct-use cases use `OrphanReaper` differently).
4. **Smoke run**: pick 3 representative suites — one from each tier (1 with prior wiring, 1 from cross-domain adapter `from-*` family that never had wiring, 1 from `*-bff`) — run via `pnpm nx run <project>:test-integration` against deployed dev. Each must:
   - Pass functionally (no regressions vs. baseline).
   - Show `OrphanReaper:` log lines on first run after the deploy (proving the reaper executed).
5. **Visual**: AWS Console — Lambda functions matching `integ-mock-*` and SQS queues matching `integ-trap-*` from prior runs (>1h old) are gone after the smoke run.

## Out of scope

- **StateResetFixture coverage expansion** — audit confirmed only 2 global-key DDB patterns exist (`CircuitBreaker#alpaca`, `FeatureFlag#SYSTEM`), both already covered. No work to do.
- **OrphanReaper enhancement** — adding new resource types (e.g. CloudWatch log groups, IAM policies, Step Function executions) is a separate concern. Current 4-resource scope is what the spec ships.
- **Performance optimization** — no `dev`-prefix gating, no parallelization beyond the existing `Promise.allSettled`. Address only if measured wall-clock becomes a CI bottleneck.
- **CI pipeline integration** — the queued `[infra] PR pipeline integration tests` workstream owns CI wiring. This spec only changes how local + CI test suites bootstrap.
- **Migrating to a Jest global-setup hook** — moving OrphanReaper to a workspace-wide Jest global setup would also work, but requires per-project `jest.config.ts` plumbing and global state in test-support. The per-suite factory is simpler and more explicit. Consider only if a fourth bootstrap concern arises.
- **Section 4 of the 2026-04-16 spec** (FakeLlm / URL-based mock agent runtime) — superseded 2026-04-20 by AgentCore data-plane transport. Not revisiting.
- **Skill-set audit beyond `create-integration-test`** — other skills may reference `createTestContext` in test examples; sweep on a future pass when an actual mismatch is observed.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Sweep PR misses an integration test file | Low | Step 2 of validation gate is the grep that catches this |
| Increased per-suite wall-clock breaks CI timeouts | Low | Suites already have 90s `beforeAll` budgets; reaper adds <10s. If CI tightens budgets later, the dev-prefix gating fallback is documented. |
| Removed manual `OrphanReaper(ctx).cleanup()` calls leave dangling `OrphanReaper` imports | Low | Step 1 (`tsc -b`) catches unused imports if `noUnusedLocals` is on; a follow-up sweep can clean up otherwise |
| New helper name collision with future `createIntegrationTestContext` from a third-party lib | Negligible | Internal lib name; we control the namespace |
| Re-introduction of per-suite manual wiring by future contributors copy-pasting old test files | Medium | Update the canonical example in `create-integration-test` skill (validation gate item) so the skill's golden path uses the new factory |

## Files summary

| Bucket | Count | Files |
|---|---|---|
| New shared lib | 1 | `libs/integration-testing/src/bootstrap.ts` |
| Modified shared lib | 1 | `libs/integration-testing/src/index.ts` |
| Modified test suites | 44 | `services/**/test/integration/*.integration.test.ts` |
| Modified skill doc | 1 | `.claude/skills/create-integration-test/SKILL.md` |
| **Total** | **47** | |

## Done definition

All 44 integration test suites bootstrap via `createIntegrationTestContext()`. Greps in validation gate steps 2 + 3 return zero. Smoke run of 3 representative suites passes. The `create-integration-test` skill documents the new pattern as the default. The BACKLOG ACTIVE entry moves to "Recently shipped" with a one-line Updated note.
