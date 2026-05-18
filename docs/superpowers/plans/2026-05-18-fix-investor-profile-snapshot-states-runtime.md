# Fix InvestorProfileSnapshot States.Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `LookupInvestorProfileSnapshot` in the decision-state-machine fault-tolerant against absent snapshot rows by mirroring the existing Market branch's `Choice`-on-`isPresent` pattern.

**Architecture:** Replace the `sfn.CustomState` (which uses `ResultSelector` to extract `$.Item.agentOutput.M` and raises uncatchable `States.Runtime` on a `{}` GetItem response) with a `sfnTasks.DynamoGetItem` that writes the raw response to `$.investorProfileSnapshotResponse`, followed by a `Choice` on `isPresent($.investorProfileSnapshotResponse.Item)` branching to either `ExtractInvestorProfileSnapshot` (Pass — lifts the real `agentOutput` to `$.agentResults.InvokeInvestorProfile`) on hit, or `HandleMissingInvestorProfileSnapshot` (Pass — seeds `{ agentOutput: {} }`) on miss. PE+AN already tolerate empty `subject.investorProfile` via `?? {}`, so the missing path degrades the decision rather than aborting the cycle. Symmetric with how Market is already handled (lines 395-425).

**Tech Stack:** AWS CDK (`aws-cdk-lib/aws-stepfunctions`, `aws-cdk-lib/aws-stepfunctions-tasks`), Jest unit tests, Step Functions JSONPath.

**Cross-resolution:** Same fix resolves `scenario-12-rebalance-on-drift-missing-mandate-fixture` (rank 11) — `withLiveDecision()` hits the identical race in its prep cycle.

---

## File Structure

- **Modify:** `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:331-384`
  - Replace `lookupInvestorProfileSnapshot` (CustomState with `ResultSelector`) with a `DynamoGetItem` task targeting `$.investorProfileSnapshotResponse`.
  - Add `extractInvestorProfileSnapshot` Pass.
  - Add `handleMissingInvestorProfileSnapshot` Pass.
  - Add `checkInvestorProfileSnapshotPresent` Choice.
  - Update the `.otherwise()` branch of `resolveInvestorProfile` to point at the `lookup → checkPresent` chain.
- **Modify:** `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts:75-87`
  - Rewrite the existing `LookupInvestorProfileSnapshot` assertion to expect the new `DynamoGetItem` shape (no `ResultSelector`, `Next: CheckInvestorProfileSnapshotPresent`).
  - Add a new test asserting `CheckInvestorProfileSnapshotPresent` Choice + `ExtractInvestorProfileSnapshot` + `HandleMissingInvestorProfileSnapshot` Pass states, mirroring the Market-branch assertion at lines 109-136.
- **Modify:** `services/advisory/decision-workflow-ctrl/CLAUDE.md` — update §"Orchestration" Branch A description to reflect the `Choice`-on-`isPresent` fault-tolerance.

---

## Task 1: TDD — rewrite the LookupInvestorProfileSnapshot test

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts:75-87`

- [ ] **Step 1: Replace the existing `LookupInvestorProfileSnapshot` test block.**

Open `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`. Replace lines 75-87 (the existing `it('adds LookupInvestorProfileSnapshot — DDB GetItem on InvestorProfileSnapshot key, ResultPath under agentResults.InvokeInvestorProfile', ...)` block) with:

```ts
  it('adds LookupInvestorProfileSnapshot — DDB GetItem on InvestorProfileSnapshot key, captures full response on $.investorProfileSnapshotResponse (no ResultSelector — that would raise the uncatchable States.Runtime on absent rows)', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;
    const state = branchStates.LookupInvestorProfileSnapshot;
    expect(state).toBeDefined();
    expect(state.Type).toBe('Task');
    // sfnTasks.DynamoGetItem renders Resource via { Fn::Sub } using the
    // aws-partition intrinsic, so the partition slot is a CFN ref token here.
    expect(state.Resource).toMatch(/states:::dynamodb:getItem$/);
    expect(state.Parameters.Key.pk['S.$']).toBe(
      "States.Format('InvestorProfileSnapshot#{}#{}', $.tenantId, $.userId)",
    );
    expect(state.Parameters.Key.sk.S).toBe('InvestorProfileSnapshot');
    // No ResultSelector — extracting $.Item.agentOutput.M on a missing row
    // raises States.Runtime, which AWS docs say is NOT catchable. Defer the
    // extraction to a downstream Pass guarded by a Choice on isPresent.
    expect(state.ResultSelector).toBeUndefined();
    expect(state.ResultPath).toBe('$.investorProfileSnapshotResponse');
    expect(state.Next).toBe('CheckInvestorProfileSnapshotPresent');
  });

  it('Branch A fault-tolerance: Choice on $.investorProfileSnapshotResponse.Item → ExtractInvestorProfileSnapshot or HandleMissingInvestorProfileSnapshot (both write empty-tolerant shape under $.agentResults.InvokeInvestorProfile)', () => {
    const branchStates = definition.States.ParallelProjections.Branches[0].States;

    const choice = branchStates.CheckInvestorProfileSnapshotPresent;
    expect(choice).toBeDefined();
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices).toHaveLength(1);
    expect(choice.Choices[0].Variable).toBe('$.investorProfileSnapshotResponse.Item');
    expect(choice.Choices[0].IsPresent).toBe(true);
    expect(choice.Choices[0].Next).toBe('ExtractInvestorProfileSnapshot');
    expect(choice.Default).toBe('HandleMissingInvestorProfileSnapshot');

    const extract = branchStates.ExtractInvestorProfileSnapshot;
    expect(extract).toBeDefined();
    expect(extract.Type).toBe('Pass');
    expect(extract.Parameters['agentOutput.$']).toBe(
      '$.investorProfileSnapshotResponse.Item.agentOutput.M',
    );
    expect(extract.ResultPath).toBe('$.agentResults.InvokeInvestorProfile');
    expect(extract.End).toBe(true);

    const fallback = branchStates.HandleMissingInvestorProfileSnapshot;
    expect(fallback).toBeDefined();
    expect(fallback.Type).toBe('Pass');
    expect(fallback.Result).toEqual({ agentOutput: {} });
    expect(fallback.ResultPath).toBe('$.agentResults.InvokeInvestorProfile');
    expect(fallback.End).toBe(true);
  });
```

- [ ] **Step 2: Run the unit test to confirm it fails as expected.**

Run: `pnpm nx run decision-workflow-ctrl:test --testFile=test/unit/decision-state-machine.test.ts`

Expected: FAIL. The first new assertion will fail with `expect(state.Resource).toMatch(/states:::dynamodb:getItem$/)` not matching the literal CustomState resource `'arn:aws:states:::dynamodb:getItem'`, OR `ResultSelector` will still be defined. The second test (Choice + Extract + HandleMissing) will fail with `state is undefined`.

- [ ] **Step 3: Commit the failing test.**

```bash
git add services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "test(decision-workflow-ctrl): rewrite LookupInvestorProfileSnapshot expectations for Choice-on-isPresent (failing)"
```

---

## Task 2: Implement the SF Choice-on-isPresent fix

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:331-384`

- [ ] **Step 1: Replace the `lookupInvestorProfileSnapshot` definition and the `resolveInvestorProfile.otherwise()` wiring.**

Open `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`. Replace the block from line 331 through line 384 (the `lookupInvestorProfileSnapshot` CustomState definition, the `hoistInvestorProfileFromTrigger` Pass — leave that one untouched but it sits in this region — and the `resolveInvestorProfile` Choice) with the following. The replacement is bounded: `hoistInvestorProfileFromTrigger` (lines 356-380) must be preserved verbatim; only the `lookupInvestorProfileSnapshot` definition + `resolveInvestorProfile.otherwise(...)` chain change.

Specifically, replace lines 331-354 (the `lookupInvestorProfileSnapshot = new sfn.CustomState(...)` block) with:

```ts
    // Fault-tolerance: a missing InvestorProfileSnapshot row produces a
    // States.Runtime when a ResultSelector tries to extract $.Item.agentOutput.M,
    // and States.Runtime is NOT catchable per AWS docs. Capture the raw GetItem
    // response on $.investorProfileSnapshotResponse (no ResultSelector), then use
    // a Choice on isPresent($.Item) to branch — symmetric with the Market branch
    // below. PE+AN tolerate empty investorProfile via `?? {}`, so the absent path
    // degrades the decision rather than aborting the cycle.
    const lookupInvestorProfileSnapshot = new sfnTasks.DynamoGetItem(this, 'LookupInvestorProfileSnapshot', {
      table: props.table,
      key: {
        pk: sfnTasks.DynamoAttributeValue.fromString(
          sfn.JsonPath.format(
            'InvestorProfileSnapshot#{}#{}',
            sfn.JsonPath.stringAt('$.tenantId'),
            sfn.JsonPath.stringAt('$.userId'),
          ),
        ),
        sk: sfnTasks.DynamoAttributeValue.fromString('InvestorProfileSnapshot'),
      },
      resultPath: '$.investorProfileSnapshotResponse',
    });
    const extractInvestorProfileSnapshot = new sfn.Pass(this, 'ExtractInvestorProfileSnapshot', {
      parameters: {
        'agentOutput.$': '$.investorProfileSnapshotResponse.Item.agentOutput.M',
      },
      resultPath: '$.agentResults.InvokeInvestorProfile',
    });
    const handleMissingInvestorProfileSnapshot = new sfn.Pass(this, 'HandleMissingInvestorProfileSnapshot', {
      result: sfn.Result.fromObject({ agentOutput: {} }),
      resultPath: '$.agentResults.InvokeInvestorProfile',
    });
    const checkInvestorProfileSnapshotPresent = new sfn.Choice(this, 'CheckInvestorProfileSnapshotPresent')
      .when(sfn.Condition.isPresent('$.investorProfileSnapshotResponse.Item'), extractInvestorProfileSnapshot)
      .otherwise(handleMissingInvestorProfileSnapshot);
```

Then, change the existing `resolveInvestorProfile` Choice (around line 382-384) from:

```ts
    const resolveInvestorProfile = new sfn.Choice(this, 'ResolveInvestorProfile')
      .when(sfn.Condition.isPresent('$.triggerContext.goal'), hoistInvestorProfileFromTrigger)
      .otherwise(lookupInvestorProfileSnapshot);
```

to:

```ts
    const resolveInvestorProfile = new sfn.Choice(this, 'ResolveInvestorProfile')
      .when(sfn.Condition.isPresent('$.triggerContext.goal'), hoistInvestorProfileFromTrigger)
      .otherwise(lookupInvestorProfileSnapshot.next(checkInvestorProfileSnapshotPresent));
```

Note: the `.next(checkInvestorProfileSnapshotPresent)` call returns the chain head (the `lookupInvestorProfileSnapshot` Task) so `Choice.otherwise()` still accepts it. This is the same wiring pattern as Branch B (`lookupMarketSnapshot.next(checkMarketSnapshotPresent)` at line 429).

- [ ] **Step 2: Run the unit test.**

Run: `pnpm nx run decision-workflow-ctrl:test --testFile=test/unit/decision-state-machine.test.ts`

Expected: PASS — both the rewritten `LookupInvestorProfileSnapshot` test and the new `CheckInvestorProfileSnapshotPresent` test green.

- [ ] **Step 3: Run the full unit suite for the service to catch ResolveInvestorProfile / ParallelProjections regressions.**

Run: `pnpm nx test decision-workflow-ctrl`

Expected: PASS (all tests including `service.stack.test.ts` and `assemble-packet.test.ts`).

- [ ] **Step 4: Commit the implementation.**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
git commit -m "fix(decision-workflow-ctrl): tolerate absent InvestorProfileSnapshot via Choice-on-isPresent (mirrors Market branch)"
```

---

## Task 3: Update service CLAUDE.md card

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md` § "Orchestration" Branch A description

- [ ] **Step 1: Update the Branch A description.**

Find the section under "## Orchestration" that begins with `- Branch A: **ResolveInvestorProfile** (Choice)`. Replace its body with:

```markdown
     - Branch A: **ResolveInvestorProfile** (Choice) — when the trigger payload carries an InvestorProfile body, hoist it; otherwise **LookupInvestorProfileSnapshot** (DDB GetItem, captures raw response on `$.investorProfileSnapshotResponse`) → **CheckInvestorProfileSnapshotPresent** (Choice on `isPresent($.investorProfileSnapshotResponse.Item)`) → **ExtractInvestorProfileSnapshot** (Pass, lifts the real `agentOutput`) on hit, or **HandleMissingInvestorProfileSnapshot** (Pass, seeds `{ agentOutput: {} }`) on miss. Same `Choice`-on-`isPresent` shape as Branch B — workaround for SF `States.Runtime` (raised by missing JSONPath) being uncatchable. PE+AN tolerate empty `investorProfile` via `?? {}` so absent snapshot degrades the decision rather than aborting the cycle.
```

- [ ] **Step 2: Run the affected lint sweep.**

Run: `pnpm nx affected -t lint --base=origin/main`

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "docs(decision-workflow-ctrl): update CLAUDE.md Branch A for Choice-on-isPresent fault-tolerance"
```

---

## Task 4: Workspace-wide affected gate

**Files:** none (verification only)

- [ ] **Step 1: Run nx-affected tests + lint.**

Run: `pnpm nx affected -t test,lint --base=origin/main`

Expected: PASS. If anything else lights up (e.g., a transitive consumer of the construct), inspect; do NOT skip.

---

## Task 5: Deploy to dev sandbox

**Files:** none (deploy step)

- [ ] **Step 1: Deploy decision-workflow-ctrl.**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl | tee /tmp/deploy-dwc-ipsnap-fix.log`

Expected: CDK deploy succeeds; CFN updates the `DecisionStateMachine` resource with the new states (`CheckInvestorProfileSnapshotPresent`, `ExtractInvestorProfileSnapshot`, `HandleMissingInvestorProfileSnapshot`) and the modified `LookupInvestorProfileSnapshot` Task.

---

## Task 6: Scoped e2e validation (the two involved scenarios only)

**Files:** none (validation)

- [ ] **Step 1: Run the operating-mode-recommendation-shape scenario.**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=operating-mode-recommendation-shape
```

Expected: CONSERVATIVE + BALANCED + AGGRESSIVE all GREEN. Each phase materializes a `DecisionPacket` with non-empty `proposedTrades`.

- [ ] **Step 2: Run the rebalance-on-drift scenario.**

Run:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=rebalance-on-drift
```

Expected: GREEN. `withLiveDecision()` fixture completes; drift-event SF runs to completion.

- [ ] **Step 3: If any scenario fails-then-passes on rerun, treat as a real failure.**

Per `feedback_flake_means_broken.md`: pull CloudWatch evidence from the failing window (Step Functions execution history for the failed SF + Lambda logs) before continuing. Add a second confirmation pass — run both scenarios a third time. If they fail again, STOP and reopen the backlog file with the new evidence; do NOT mark shipped.

---

## Self-Review Notes

- **Spec coverage:** The "Cheapest fix" section of the backlog file lists 3 steps (convert to DynamoGetItem, add Extract+HandleMissing Pass, insert Choice). Tasks 1+2 implement all 3.
- **Cross-resolution:** Both rank 10 and rank 11 reopen on the same `LookupInvestorProfileSnapshot` failure; Task 6 covers both.
- **Symmetry with Market branch:** Verified — same state names with `InvestorProfileSnapshot` substituted for `MarketSnapshot`, same `resultPath` patterns, same `End: true` on the terminal Pass states. The branch starts at the `ResolveInvestorProfile` Choice (preserved) and the `.otherwise()` arm now flows through `lookupInvestorProfileSnapshot.next(checkInvestorProfileSnapshotPresent)`.
- **No placeholders:** All code blocks contain the actual content. No "TBD", no "similar to Task N", no "add appropriate error handling."
- **Hoist branch:** Left untouched — it's not on the failure path and its preexisting output topology (`{ agentOutput: ... }` without `resultPath`) is outside this workstream's scope. The merge step's read of `$.parallelResults[0].agentResults.InvokeInvestorProfile.agentOutput` works on the fault-tolerance branch but would not work on the hoist branch as-is; this is preexisting and not regressed by the fix.
- **Out-of-scope reminder:** Per the backlog file, do NOT refactor AssemblePacket / advisory-bff transform topology, do NOT touch test-side polling, do NOT chase the AgentCore Memory namespace mismatch in this workstream.
