# Integration-test SSM cleanup hardening on abort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.backup`-based crash recovery to `SsmOverrideFixture` and migrate the 8 Pattern A call sites so a crashed Jest worker no longer requires manual `aws ssm put-parameter` to re-run integration tests.

**Architecture:** Add a new `overrideAndDeriveRestore({ paramName, testValue, expectedRestorePrefix })` method to `SsmOverrideFixture`. On entry it (1) consumes an existing `${paramName}.backup` to restore canonical and derives `restoreTo` from it; (2) otherwise reads canonical, validates the prefix, derives `restoreTo`. Then it runs the standard write-`.backup` + write-`testValue` + register-cleanup sequence. The existing `override({...restoreTo})` is untouched and continues to serve the 7 Pattern B (adapter) call sites that already self-heal.

**Tech Stack:** TypeScript, Jest with `@aws-sdk/client-ssm` mocked, Nx, pnpm. Tests at `libs/integration-testing/test/fixtures/`.

**Worktree recommendation:** This plan touches 1 lib file + 1 lib test file + 8 service test files = 10 files. Per the memory note about pivoting to a worktree for multi-file fixes, execute in a dedicated worktree branch (e.g. `feat/ssm-cleanup-hardening-on-abort`). The `using-git-worktrees` skill handles setup.

**Spec:** [`docs/superpowers/specs/2026-05-12-integration-test-ssm-cleanup-hardening-on-abort-design.md`](../specs/2026-05-12-integration-test-ssm-cleanup-hardening-on-abort-design.md)

**Backlog:** [`docs/backlog/integration-test-ssm-cleanup-hardening-on-abort.md`](../../backlog/integration-test-ssm-cleanup-hardening-on-abort.md)

---

## Task 1: Add `overrideAndDeriveRestore` to `SsmOverrideFixture` (TDD)

**Files:**
- Modify: `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`
- Modify: `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts`

- [ ] **Step 1.1: Add Test A — happy path, no `.backup`, derives restoreTo from canonical**

Open `libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts`. Append the following new `describe` block inside the existing top-level `describe('SsmOverrideFixture', () => {...})`, AFTER the existing `it(...)` cases but BEFORE the closing `})`:

```typescript
describe('overrideAndDeriveRestore', () => {
  it('derives restoreTo from canonical on first run (no .backup)', async () => {
    (PutParameterCommand as unknown as jest.Mock).mockClear();
    // paramExists(.backup) → not found
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    // GetParameter(main) → canonical ARN
    const ARN = 'arn:aws:bedrock-agentcore-runtime:us-east-1:111:runtime/foo';
    mockSend.mockResolvedValueOnce({ Parameter: { Value: ARN } });
    // PutParameter(.backup) → ok
    mockSend.mockResolvedValueOnce({});
    // PutParameter(main with mock) → ok
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.overrideAndDeriveRestore({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      expectedRestorePrefix: 'arn:',
      waitMs: 0,
    });

    const putCalls = (PutParameterCommand as unknown as jest.Mock).mock.calls;
    expect(putCalls[0][0]).toMatchObject({ Name: BACKUP, Value: ARN });
    expect(putCalls[1][0]).toMatchObject({ Name: PARAM, Value: MOCK_VALUE });
    expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));
  });
});
```

- [ ] **Step 1.2: Run the new test to confirm it fails**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns ssm-override.fixture.test -t 'overrideAndDeriveRestore'
```
Expected: FAIL with `TypeError: fixture.overrideAndDeriveRestore is not a function` (or similar — the method doesn't exist yet).

- [ ] **Step 1.3: Implement the minimal method to make Test A pass**

Open `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`. Add the following method to the `SsmOverrideFixture` class, immediately AFTER the existing `override(...)` method and BEFORE `restore()`:

```typescript
  /**
   * Like override(), but derives restoreTo by reading the canonical SSM value
   * (after a .backup-driven crash recovery step). Use this when the canonical
   * value is dynamic (e.g. an ARN minted by CDK) — pass expectedRestorePrefix
   * to validate the canonical is well-formed.
   *
   * Crash-recovery: if ${paramName}.backup exists from a prior crashed run,
   * its value is used to repair the canonical AND becomes restoreTo (the
   * presence of .backup is treated as authoritative — canonical could have
   * been corrupted by the crashed run).
   */
  async overrideAndDeriveRestore(params: {
    paramName: string;
    testValue: string;
    /** Required: prefix the canonical value MUST start with (e.g. 'arn:'). */
    expectedRestorePrefix: string;
    waitMs?: number;
  }): Promise<void> {
    this.paramName = params.paramName;
    this.backupParamName = `${params.paramName}.backup`;

    const backupExists = await this.paramExists(this.backupParamName);

    let restoreTo: string;
    if (backupExists) {
      // Recovery path — a prior run crashed mid-override. .backup is the truth.
      const backupResult = await this.client.send(new GetParameterCommand({
        Name: this.backupParamName,
      }));
      const backupValue = backupResult.Parameter?.Value;
      if (!backupValue || !backupValue.startsWith(params.expectedRestorePrefix)) {
        // Read live canonical too so the error message has full state
        let liveCanonical: string | undefined;
        try {
          const live = await this.client.send(new GetParameterCommand({
            Name: params.paramName,
          }));
          liveCanonical = live.Parameter?.Value;
        } catch {
          // ignore — surface what we have
        }
        throw new Error(
          `SsmOverrideFixture: refusing to recover ${params.paramName} — ` +
          `.backup value '${backupValue}' does not start with '${params.expectedRestorePrefix}', ` +
          `and live canonical is '${liveCanonical}'. ` +
          `Both values are corrupt; restore manually before re-running tests: ` +
          `aws ssm put-parameter --name '${params.paramName}' --value '<canonical>' --type String --overwrite && ` +
          `aws ssm delete-parameter --name '${this.backupParamName}'`,
        );
      }
      restoreTo = backupValue;
      // Repair canonical from .backup (canonical may currently hold a stale mock URL)
      await this.client.send(new PutParameterCommand({
        Name: params.paramName,
        Value: backupValue,
        Type: 'String',
        Overwrite: true,
      }));
      // Leave .backup in place — the standard override path below will reuse it
      // (backupExists branch skips re-writing .backup).
    } else {
      // No .backup — derive restoreTo from canonical
      const canonical = await this.client.send(new GetParameterCommand({
        Name: params.paramName,
      }));
      const canonicalValue = canonical.Parameter?.Value;
      if (!canonicalValue || !canonicalValue.startsWith(params.expectedRestorePrefix)) {
        throw new Error(
          `SsmOverrideFixture: expected canonical SSM value for ${params.paramName} ` +
          `to start with '${params.expectedRestorePrefix}', got: '${canonicalValue}'. ` +
          `Stack may not be deployed, or a prior test run left a non-canonical value behind. ` +
          `Re-deploy the relevant stack before re-running integration tests.`,
        );
      }
      restoreTo = canonicalValue;
      // Write .backup from validated canonical
      await this.client.send(new PutParameterCommand({
        Name: this.backupParamName,
        Value: restoreTo,
        Type: 'String',
        Overwrite: true,
      }));
    }

    this.restoreTo = restoreTo;

    // Write testValue over canonical
    await this.client.send(new PutParameterCommand({
      Name: params.paramName,
      Value: params.testValue,
      Type: 'String',
      Overwrite: true,
    }));

    // Wait for parameterStoreTtl expiry
    const waitMs = params.waitMs ?? 6_000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    this.ctx.cleanup.register('SsmOverrideFixture', () => this.restore());
  }
```

Also confirm `GetParameterCommand` is already imported at the top of the file (line 1) — it is. No new imports needed.

- [ ] **Step 1.4: Run Test A — confirm it passes**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns ssm-override.fixture.test -t 'derives restoreTo from canonical'
```
Expected: PASS.

- [ ] **Step 1.5: Add Test B — recovery from prior crash**

In the same `describe('overrideAndDeriveRestore', ...)` block in the test file, AFTER Test A, add:

```typescript
  it('recovers from a prior crash via .backup, repairing canonical and deriving restoreTo from .backup', async () => {
    (PutParameterCommand as unknown as jest.Mock).mockClear();
    (DeleteParameterCommand as unknown as jest.Mock).mockClear();
    const ARN = 'arn:aws:bedrock-agentcore-runtime:us-east-1:111:runtime/foo';
    // paramExists(.backup) → found
    mockSend.mockResolvedValueOnce({ Parameter: { Value: ARN } });
    // GetParameter(.backup) → valid ARN
    mockSend.mockResolvedValueOnce({ Parameter: { Value: ARN } });
    // PutParameter(main, ARN) — repair canonical from .backup
    mockSend.mockResolvedValueOnce({});
    // PutParameter(main, MOCK_VALUE) — testValue write
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.overrideAndDeriveRestore({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      expectedRestorePrefix: 'arn:',
      waitMs: 0,
    });

    const putCalls = (PutParameterCommand as unknown as jest.Mock).mock.calls;
    // 1st PutParam: repair canonical from .backup (ARN)
    expect(putCalls[0][0]).toMatchObject({ Name: PARAM, Value: ARN });
    // 2nd PutParam: write testValue
    expect(putCalls[1][0]).toMatchObject({ Name: PARAM, Value: MOCK_VALUE });
    // No .backup write (existing .backup left in place)
    expect(putCalls.filter((c: any[]) => c[0].Name === BACKUP)).toHaveLength(0);
    // No DeleteParameter calls during override (.backup is deleted only on restore)
    expect((DeleteParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);

    expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));
  });
```

- [ ] **Step 1.6: Run Test B — confirm it passes**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns ssm-override.fixture.test -t 'recovers from a prior crash'
```
Expected: PASS.

- [ ] **Step 1.7: Add Test C — double-corruption refuses to proceed**

In the same `describe` block, AFTER Test B, add:

```typescript
  it('refuses to proceed when both .backup and canonical are corrupt', async () => {
    (PutParameterCommand as unknown as jest.Mock).mockClear();
    (DeleteParameterCommand as unknown as jest.Mock).mockClear();
    // paramExists(.backup) → found
    mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });
    // GetParameter(.backup) → poisoned mock URL (not 'arn:'-prefixed)
    mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });
    // GetParameter(main) → also poisoned (for error-message enrichment)
    mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });

    const fixture = new SsmOverrideFixture(mockCtx);

    await expect(fixture.overrideAndDeriveRestore({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      expectedRestorePrefix: 'arn:',
      waitMs: 0,
    })).rejects.toThrow(/refusing to recover.*\.backup value 'https:\/\/stale-mock.*live canonical is 'https:\/\/stale-mock/);

    // No writes attempted, no cleanup registered
    expect((PutParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);
    expect((DeleteParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);
    expect(mockCleanup.register).not.toHaveBeenCalled();
  });
```

- [ ] **Step 1.8: Run Test C — confirm it passes**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns ssm-override.fixture.test -t 'refuses to proceed when both'
```
Expected: PASS.

- [ ] **Step 1.9: Add Test D — no `.backup`, canonical corrupt throws Re-deploy error**

In the same `describe` block, AFTER Test C, add:

```typescript
  it('throws Re-deploy error when no .backup exists and canonical fails prefix check', async () => {
    (PutParameterCommand as unknown as jest.Mock).mockClear();
    // paramExists(.backup) → not found
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    // GetParameter(main) → poisoned mock URL
    mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });

    const fixture = new SsmOverrideFixture(mockCtx);

    await expect(fixture.overrideAndDeriveRestore({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      expectedRestorePrefix: 'arn:',
      waitMs: 0,
    })).rejects.toThrow(/expected canonical SSM value.*to start with 'arn:'.*Re-deploy the relevant stack/);

    expect((PutParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);
    expect(mockCleanup.register).not.toHaveBeenCalled();
  });
```

- [ ] **Step 1.10: Run Test D — confirm it passes**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns ssm-override.fixture.test -t 'throws Re-deploy error'
```
Expected: PASS.

- [ ] **Step 1.11: Run the entire fixture test file to confirm no regressions**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns ssm-override.fixture.test
```
Expected: all 10 tests (6 existing + 4 new) PASS.

- [ ] **Step 1.12: Run the full integration-testing library test suite (sanity check)**

Run:
```bash
pnpm nx run integration-testing:test
```
Expected: all PASS.

- [ ] **Step 1.13: Commit**

```bash
git add libs/integration-testing/src/fixtures/ssm-override.fixture.ts libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts
git commit -m "feat(integration-testing): add SsmOverrideFixture.overrideAndDeriveRestore with .backup-driven crash recovery"
```

---

## Task 2: Migrate `investor-profile-ctrl` Pattern A call sites

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.resilience.integration.test.ts`

- [ ] **Step 2.1: Migrate `investor-profile-ctrl.integration.test.ts`**

Open the file. Find the `beforeAll` block (around line 22). It currently contains:

```typescript
    const paramName = `/nestfolio/${ctx.prefix}-investor-profile-ctrl/agent/runtimeUrl`;
    const ssm = new SSMClient({ region: ctx.region });
    const canonical = await ssm.send(new GetParameterCommand({ Name: paramName }));
    const restoreTo = canonical.Parameter!.Value!;
    if (!restoreTo.startsWith('arn:')) {
      throw new Error(
        `Expected canonical SSM value to be an AgentCore runtime ARN, got: ${restoreTo}. ` +
        `Stack may not be deployed, or a prior test run left a mock URL behind. ` +
        `Re-deploy investor-profile-ctrl before re-running integration tests.`,
      );
    }

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({ paramName, testValue: mockUrl, restoreTo });
```

Replace that whole block with:

```typescript
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });
```

Then remove the now-unused imports at the top of the file:
```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
```
Delete this entire line.

- [ ] **Step 2.2: Migrate `investor-profile-ctrl.resilience.integration.test.ts`**

Apply the same transformation: locate the identical `const paramName = …` block (path scoped to `investor-profile-ctrl`), replace with the 5-line `overrideAndDeriveRestore` call, delete the `SSMClient`/`GetParameterCommand` import line.

- [ ] **Step 2.3: Lint the service to catch unused imports + type errors**

Run:
```bash
pnpm nx run investor-profile-ctrl:lint 2>&1 | tail -20
```
Expected: no errors. (Lint via `@nx/eslint:lint` typechecks via `@typescript-eslint` and flags the now-removed `SSMClient` / `GetParameterCommand` import if you forgot to delete it.)

- [ ] **Step 2.4: Commit**

```bash
git add services/advisory/investor-profile-ctrl/test/integration/
git commit -m "test(investor-profile-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore"
```

---

## Task 3: Migrate `advisory-narrative-ctrl` Pattern A call sites

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.resilience.integration.test.ts`

- [ ] **Step 3.1: Migrate `advisory-narrative-ctrl.integration.test.ts`**

Same pattern as Task 2.1. Locate the `const paramName = …` + `SSMClient` + `startsWith('arn:')` block in `beforeAll`. The `paramName` template will be `/nestfolio/${ctx.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`. Replace with:

```typescript
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });
```

Delete the `import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';` line at the top.

- [ ] **Step 3.2: Migrate `advisory-narrative-ctrl.resilience.integration.test.ts`**

Same transformation as Step 3.1.

- [ ] **Step 3.3: Lint**

```bash
pnpm nx run advisory-narrative-ctrl:lint 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 3.4: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/test/integration/
git commit -m "test(advisory-narrative-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore"
```

---

## Task 4: Migrate `portfolio-engine-ctrl` Pattern A call sites

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`

- [ ] **Step 4.1: Migrate `portfolio-engine-ctrl.integration.test.ts`**

Same pattern as Task 2.1. `paramName` template: `/nestfolio/${ctx.prefix}-portfolio-engine-ctrl/agent/runtimeUrl`. Replacement:

```typescript
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-portfolio-engine-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });
```

Delete the `import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';` line.

- [ ] **Step 4.2: Migrate `portfolio-engine-ctrl.resilience.integration.test.ts`**

Same transformation. Note: the resilience file's manual block may be at module scope (a top-level helper) rather than inside `beforeAll` — earlier inspection showed the `const canonical = …` at module-scope indent. Apply the same replacement, keeping the call inside `beforeAll`. Verify the file still compiles after the move.

- [ ] **Step 4.3: Lint**

```bash
pnpm nx run portfolio-engine-ctrl:lint 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 4.4: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/test/integration/
git commit -m "test(portfolio-engine-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore"
```

---

## Task 5: Migrate `market-intelligence-ctrl` Pattern A call sites

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.resilience.integration.test.ts`

- [ ] **Step 5.1: Migrate `market-intelligence-ctrl.integration.test.ts`**

Same pattern. `paramName` template: `/nestfolio/${ctx.prefix}-market-intelligence-ctrl/agent/runtimeUrl`. Replacement:

```typescript
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-market-intelligence-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });
```

Delete the `import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';` line.

- [ ] **Step 5.2: Migrate `market-intelligence-ctrl.resilience.integration.test.ts`**

Same transformation.

- [ ] **Step 5.3: Lint**

```bash
pnpm nx run market-intelligence-ctrl:lint 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 5.4: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/test/integration/
git commit -m "test(market-intelligence-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore"
```

---

## Task 6: End-to-end validation on dev account

**Files:** none (validation only).

- [ ] **Step 6.1: Verify dev account context**

Run:
```bash
aws sts get-caller-identity --query 'Account' --output text
```
Expected output: `771924376645` (dev sandbox). If anything else, fix Leapp credentials before continuing.

- [ ] **Step 6.2: Run targeted integration suites against dev**

Run (this exercises both the new method on the happy path AND auto-recovers any orphaned `.backup` parameters left over from past crashes — the implicit real-world validation):

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --projects=investor-profile-ctrl,advisory-narrative-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl 2>&1 | tee /tmp/ssm-cleanup-validation.log
```
Expected: all 4 integration projects exit 0.

If a `beforeAll` ARN-prefix error fires on the FIRST run of this command, that's the orphaned-`.backup` real-world recovery firing for the first time — re-run the same command; the second run must pass cleanly. Note this in the validation_gate text for the backlog entry.

- [ ] **Step 6.3: Spot-check that .backup parameters were cleaned up**

Run:
```bash
for svc in investor-profile-ctrl advisory-narrative-ctrl portfolio-engine-ctrl market-intelligence-ctrl; do
  aws ssm get-parameter --name "/nestfolio/dev-${svc}/agent/runtimeUrl.backup" --query 'Parameter.Value' --output text 2>&1 | grep -E '^(arn:|ParameterNotFound|An error)' | head -1 | sed "s|^|${svc}: |"
done
```
Expected: 4 lines, each one a `ParameterNotFound` or `An error … ParameterNotFound`. If any `.backup` parameter exists, the cleanup path didn't run for that service — investigate before proceeding.

---

## Task 7: Ship — flip backlog status

**Files:**
- Modify: `docs/backlog/integration-test-ssm-cleanup-hardening-on-abort.md`
- Modify: `docs/BACKLOG.md` (auto-regenerated)

- [ ] **Step 7.1: Update backlog frontmatter**

In `docs/backlog/integration-test-ssm-cleanup-hardening-on-abort.md`, change:
```yaml
status: active
```
to:
```yaml
status: shipped
closed: "2026-05-12"
validation_gate: "4 mocked-SSM unit tests in libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts (happy / .backup recovery / double-corruption / no-.backup canonical-corrupt). E2E: pnpm nx run-many -t test-integration --projects=investor-profile-ctrl,advisory-narrative-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl green on dev account 771924376645."
```

(If the actual closed date when you ship differs from 2026-05-12, use today's ISO date.)

- [ ] **Step 7.2: Regenerate the backlog index**

Run:
```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```
Expected: `✓ N backlog files; all 7 rules pass (with --fix applied)`. `docs/BACKLOG.md` is modified.

- [ ] **Step 7.3: Commit**

```bash
git add docs/backlog/integration-test-ssm-cleanup-hardening-on-abort.md docs/BACKLOG.md
git commit -m "docs(backlog): ship integration-test-ssm-cleanup-hardening-on-abort"
```

- [ ] **Step 7.4: Hand off to finishing-a-development-branch**

The implementation work is complete. Invoke the `superpowers:finishing-a-development-branch` skill to decide on merge / PR / cleanup based on whether this was done in a worktree.

---

## Spec coverage check

Walked through `docs/superpowers/specs/2026-05-12-integration-test-ssm-cleanup-hardening-on-abort-design.md` section-by-section against this plan:

- **Fixture API** (§ Design > Fixture API) → Task 1, Step 1.3 implements the exact signature.
- **Recovery algorithm steps 1-3** (§ Design > Behaviour, in order) → Task 1, Step 1.3 implementation follows the same 3-phase order (recovery branch, derive-from-canonical branch, override path).
- **Edge case: `.backup` valid, canonical also valid** (restore from `.backup` anyway) → Implementation in Step 1.3 unconditionally takes the recovery branch when `.backup` exists.
- **Edge case: `.backup` corrupt, canonical valid** (throw, name both) → Task 1, Step 1.7 (Test C) + Step 1.3 error-message construction.
- **Edge case: no `.backup`, canonical corrupt** (Re-deploy error) → Task 1, Step 1.9 (Test D) + Step 1.3 derive-branch error path.
- **Multi-worker contention out of scope** → No task; explicitly documented as out_of_scope in backlog file.
- **Pattern A call-site migration** (8 files) → Tasks 2-5, each migrating one service's 2 files.
- **Pattern B (adapter) sites untouched** → Tasks 2-5 only touch agent-ctrl trio + market-intelligence-ctrl. No adapter files appear in any task's "Modify" list.
- **Validation gate: 3 mocked-SSM unit tests** → Steps 1.5/1.7/1.9 cover (recovery / double-corruption / no-.backup canonical-corrupt). Note: plan adds a fourth case (Step 1.1, happy-path no-.backup) for completeness beyond the spec's minimum 3. This is additive coverage, not a deviation.
- **Real-world cross-check after merge** → Task 6 runs the 4-service integration suite on dev.
- **Done definition items** → All covered (method exists: Task 1; unit tests: Task 1; 8 call sites migrated: Tasks 2-5; nx run-many green: Task 6; backlog flipped + backlog-lint: Task 7).

No gaps. No spec requirement is unaddressed.

## Type / name consistency check

- Method name: `overrideAndDeriveRestore` — consistent across spec, fixture impl (Step 1.3), all 4 migration tasks (Steps 2.1, 3.1, 4.1, 5.1), all 5 specs in tests.
- Parameter name: `expectedRestorePrefix` — consistent across spec, fixture impl, all migration steps, all test cases.
- Parameter name: `paramName` — consistent.
- Constant `BACKUP` in test file: derived as `${PARAM}.backup` (existing convention) — used in Steps 1.1, 1.5, 1.7.
- Test constants `ARN`, `PARAM`, `MOCK_VALUE`, `POISONED_VALUE`, `REAL_VALUE` — `PARAM`, `MOCK_VALUE`, `POISONED_VALUE`, `REAL_VALUE` are pre-existing in the test file; `ARN` is introduced locally per test (Steps 1.1, 1.5) — no global hoisting needed since `REAL_VALUE` is `https://`-prefixed and not suitable as an ARN. Acceptable inconsistency for test readability.

No drift.
