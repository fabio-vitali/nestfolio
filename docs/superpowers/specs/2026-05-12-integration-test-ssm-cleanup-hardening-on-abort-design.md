# Integration-test SSM cleanup hardening on abort — design

**Backlog:** [`integration-test-ssm-cleanup-hardening-on-abort`](../../backlog/integration-test-ssm-cleanup-hardening-on-abort.md)
**Status:** spec
**Date:** 2026-05-12

## Problem

`SsmOverrideFixture` swaps a canonical SSM parameter (typically an AgentCore runtime ARN) for a mock Lambda URL during a test, then restores the canonical value in `afterAll`. When the test body throws — Jest timeout, AWS credential expiry, an `expect` failing inside the test, a `kill -9` on the Jest worker — `afterAll` may not run. The override is left in place. The next test run's `beforeAll` reads the (now stale) SSM and fails an `arn:`-prefix check, halting with:

```
Expected canonical SSM value to be an AgentCore runtime ARN, got: https://...lambda-url.us-east-1.on.aws.
Stack may not be deployed, or a prior test run left a mock URL behind.
Re-deploy <service> before re-running integration tests.
```

Recovery is manual (`aws ssm put-parameter --overwrite ...`). Triggered three times during Lever 1 work (2026-05-11 → 2026-05-12).

## Code archaeology — what already works, what doesn't

The fixture (`libs/integration-testing/src/fixtures/ssm-override.fixture.ts`) **already implements durable crash-state**: before writing `testValue` over the canonical, it writes the canonical value to `${paramName}.backup` (an SSM parameter, not a local file). On a subsequent call where `.backup` already exists, the fixture treats that as evidence of a prior crash and skips its first-run corruption check.

So crash-recovery is half-built. The missing half is **consuming `.backup` on the recovery path**. Today, nothing reads `.backup` to restore canonical — it only protects the fixture from re-corrupting `.backup` itself.

Of the 15 test-file call sites, two patterns exist:

- **Pattern A (8 files):** agent-ctrl trio (`investor-profile-ctrl`, `advisory-narrative-ctrl`, `portfolio-engine-ctrl`) + `market-intelligence-ctrl`, each with `*.integration.test.ts` + `*.resilience.integration.test.ts`. Call site reads canonical SSM, asserts `startsWith('arn:')`, passes derived value as `restoreTo`. **This pre-fixture read is what fails after a crash** — the fixture's existing `.backup` recovery infrastructure never gets a chance to run.
- **Pattern B (7 files):** all adapters (`alpha-vantage-adpt` × 1, `fred-adpt` × 1, `marketwatch-adpt` × 1, `sec-edgar-adpt` × 1, `yahoo-finance-adpt` × 1, `broker-alpaca-adpt` × 2 — integration + resilience). Call site passes `restoreTo` as a hardcoded literal (e.g., `'https://www.alphavantage.co/query'`). No read, no prefix assertion. **Already self-heals** today: when `.backup` exists from a crash, the fixture's `backupExists` branch skips the corruption check, override path runs normally, and restore puts the literal back.

The leak is Pattern-A-only.

## Design

Add a new method on `SsmOverrideFixture` that does its own canonical-read after running `.backup` recovery first. Existing `override(...)` remains unchanged — Pattern B keeps using it.

### Fixture API

```ts
async overrideAndDeriveRestore(params: {
  paramName: string;
  testValue: string;
  /** Required: prefix the canonical value MUST start with (e.g. 'arn:'). Used for both backup-recovery validation and canonical validation. */
  expectedRestorePrefix: string;
  waitMs?: number;
}): Promise<void>;
```

Behaviour, in order:

1. **Crash recovery from `.backup`.** If `${paramName}.backup` exists:
   - Read its value.
   - If the backup value's prefix does NOT match `expectedRestorePrefix` → throw, naming both the backup value and the live canonical. Refuse to proceed; this is double-corruption that requires human attention.
   - Else → `PutParameter(paramName, backupValue)` to restore canonical, then `DeleteParameter(.backup)`.
2. **Read canonical** via `GetParameterCommand`. Validate `expectedRestorePrefix`. If it fails here (no `.backup` existed and canonical genuinely doesn't match), throw the existing "Re-deploy" error path — unchanged from current call-site logic.
3. **Override path** — identical to current `override()`: write `.backup` from the validated canonical, write `testValue` over canonical, await `waitMs` for parameter-store TTL expiry, register restore on `ctx.cleanup`.

### Recovery edge cases (decided)

- **`.backup` valid, canonical also looks valid:** restore from `.backup` and delete it anyway. Presence of `.backup` is the authoritative crash signal — canonical could be a different deployment's ARN; don't trust it.
- **`.backup` corrupt, canonical valid:** throw, name both. Don't silently delete a "corrupt-looking" backup, because the canonical we'd be trusting may itself be stale from a deeper failure.
- **Multi-worker race on same `paramName`:** out of scope. Each service has its own param namespace and Jest runs that service's integration + resilience suites sequentially in practice.

### Call-site migration (Pattern A only)

Each of the 8 Pattern A files compresses ~10 lines (manual `SSMClient` + `GetParameterCommand` + prefix check + `new SsmOverrideFixture` + `.override(...)`) down to:

```ts
const ssmOverride = new SsmOverrideFixture(ctx);
await ssmOverride.overrideAndDeriveRestore({
  paramName: `/nestfolio/${ctx.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
  testValue: mockUrl,
  expectedRestorePrefix: 'arn:',
});
```

The 7 Pattern B (adapter) files are not touched.

### Affected files

**Library:**
- `libs/integration-testing/src/fixtures/ssm-override.fixture.ts` — add `overrideAndDeriveRestore`.
- `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts` — extend with the three regression cases (below).

**Pattern A call sites (8):**
- `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.resilience.integration.test.ts`
- `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`
- `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.resilience.integration.test.ts`
- `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`
- `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`
- `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.resilience.integration.test.ts`

## Validation gate

Extend the existing mocked-SSM unit test at `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts` with three new cases:

1. **Recovers from prior crash via `.backup`.** Pre-stage mocked SSM as `{ paramName → mock URL, .backup → real ARN }`. Call `overrideAndDeriveRestore({ expectedRestorePrefix: 'arn:' })`. Assert sequence: `GetParameter(.backup)` → `PutParameter(paramName, recoveredArn)` → `DeleteParameter(.backup)` → normal override flow (new `.backup` write from recovered value → `PutParameter(paramName, testValue)` → cleanup registered).
2. **Both canonical and `.backup` corrupt — refuses to proceed.** Pre-stage both as non-ARN. Assert: throws with both values in the error message; no `PutParameter`/`DeleteParameter` calls made.
3. **No `.backup`, canonical corrupt — existing path unchanged.** Pre-stage `{ paramName → mock URL }`, no `.backup`. Assert: throws the existing "Re-deploy" error (regression check).

All three are pure Jest using the existing `@aws-sdk/client-ssm` mock — no AWS calls, no `kill -9`, completes in <1s as part of `pnpm nx run integration-testing:test`.

**Real-world cross-check:** after merge, the next `pnpm nx run investor-profile-ctrl:test-integration` against the dev account will auto-recover any orphaned `.backup` parameters left over from past crashes. No deliberate exercise required.

## Out of scope

- **Multi-worker contention on the same SSM param.** Each service has a distinct param namespace; Jest serialises that service's suites in practice. Adding mutex infra is a bigger workstream than this leak warrants.
- **Replacing `.backup` with a tmp-file mechanism (Option 2 in the original dossier).** `.backup` already provides durable crash-state. No benefit from a parallel mechanism.
- **A Jest `globalSetup` boot sweeper (Option 4 in the dossier).** New infra in per-service Jest configs + a drift-prone pattern list. The fixture-internal recovery covers every call site that uses the fixture, by construction.
- **Pattern B (adapter) call sites.** Already self-heal — touching them is churn.
- **Generalising beyond SSM parameters.** Other test-cleanup leak classes (DDB rows, EB rules, IAM grants) have their own fixtures and recovery semantics. File separately if/when they surface.
- **A `recoverOrphans(ctx, paramNames[])` static helper for opt-in sweeping.** The auto-on-override recovery flow handles every case the failure mode describes; an explicit static is redundant.
- **Process-level `on('exit')` / `SIGTERM` handlers.** Async work in exit handlers is unreliable; the durable `.backup` SSM parameter is already the authoritative crash-state.

## Risks / non-risks

- **Risk: a corrupt-looking `.backup` blocks recovery and requires manual fix.** Acceptable — that scenario means double-corruption, which deserves human attention. The error message names both values so the operator has full state in one place.
- **Non-risk: Pattern B tests break.** They don't call the new method.
- **Non-risk: `.backup` left behind permanently if even the recovery path crashes.** The next run picks up the same `.backup` and either recovers (if it's valid) or throws with full state (if it isn't). No new persistent-corruption modes introduced.

## Done definition

- New `overrideAndDeriveRestore` method on `SsmOverrideFixture`.
- 3 new mocked-SSM unit test cases in `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts`, all green via `pnpm nx run integration-testing:test`.
- 8 Pattern A call sites migrated; each shrinks by ~7 lines net.
- `pnpm nx run-many -t test-integration --projects=investor-profile-ctrl,advisory-narrative-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl` green on dev.
- Backlog file flipped to `status: shipped` with `validation_gate` filled, `backlog-lint --fix` regenerates `docs/BACKLOG.md`.
