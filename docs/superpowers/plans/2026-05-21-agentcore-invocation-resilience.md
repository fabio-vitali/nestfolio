# AgentCore Invocation Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make IP-ctrl's AgentCore invocation survive `maxVms` quota saturation via SQS native retry, and fix the `ledger-bff` fractional-quantity schema bug.

**Architecture:** (A) `event-processor` `isRetryable()` reclassifies `ServiceQuotaExceededException`/`ThrottlingException` as retryable so the SQS pipeline reports them as batch-item-failures → SQS redrive. (B) IP-ctrl ingress is tuned (Lambda 150s, SQS visibility 240s) so a redrive lands ≈ 4 min after a failure, and the `onboarded()` e2e fixture budget widens to 360s to tolerate it. Plus the `ledger-bff` `quantity` schema fix.

**Tech Stack:** TypeScript, AWS CDK, event-processor lib, Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md`

---

### Task 1: Defect A — `isRetryable()` reclassifies quota/throttle exceptions

**Files:**
- Modify: `libs/event-processor/src/internal/errors.ts` (`isRetryable`)
- Test: `libs/event-processor/test/domain/errors.test.ts` (or wherever `isRetryable` is covered — verify at step 1)

- [ ] **Step 1: Write the failing test.** Add cases asserting `isRetryable()` returns `true` for an AWS-SDK-shaped error with `name: 'ServiceQuotaExceededException'`, `$fault: 'client'`, `$retryable: undefined`; same for `name: 'ThrottlingException'`. Keep an existing non-retryable client-fault case (e.g. `ValidationException`) asserting `false`.

```ts
it('treats ServiceQuotaExceededException as retryable despite $fault client', () => {
  const err = Object.assign(new Error('maxVms limit exceeded'), {
    name: 'ServiceQuotaExceededException', $fault: 'client',
  });
  expect(isRetryable(err)).toBe(true);
});
it('treats ThrottlingException as retryable', () => {
  const err = Object.assign(new Error('rate exceeded'), {
    name: 'ThrottlingException', $fault: 'client',
  });
  expect(isRetryable(err)).toBe(true);
});
it('keeps a generic client-fault exception non-retryable', () => {
  const err = Object.assign(new Error('bad input'), {
    name: 'ValidationException', $fault: 'client',
  });
  expect(isRetryable(err)).toBe(false);
});
```

- [ ] **Step 2: Run, verify the new quota/throttle cases fail.** `pnpm nx test event-processor` (or the focused file). Expected: the two new cases FAIL (returns false), the ValidationException case passes.

- [ ] **Step 3: Implement.** In `isRetryable()`, before the `$fault` check:

```ts
export function isRetryable(error: unknown): boolean {
  if (error instanceof NotRetryableError) return false;
  if (isAwsSdkError(error)) {
    // Quota and throttle exceptions are transient by definition ("resubmit
    // later") even though the SDK marks them $fault:'client' with no
    // $retryable hint. Treat them as retryable so SQS redrive can recover.
    if (error.name === 'ServiceQuotaExceededException' || error.name === 'ThrottlingException') {
      return true;
    }
    return error.$retryable !== undefined || error.$fault !== 'client';
  }
  return true;
}
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm nx test event-processor`. Expected: all PASS.

- [ ] **Step 5: Commit.** `git add libs/event-processor/src/internal/errors.ts libs/event-processor/test/...; git commit`.

---

### Task 2: Defect B — IP-ctrl ingress timing

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts` (the `Ingress` call, ~line 33)
- Test: `services/advisory/investor-profile-ctrl/test/.../service.stack.test.ts`

- [ ] **Step 1: Write the failing CDK assertion.** Assert the IP-ctrl Ingress Lambda `Timeout` is `150` and the ingress SQS queue `VisibilityTimeout` is `240`.

```ts
template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({ Timeout: 150 }));
template.hasResourceProperties('AWS::SQS::Queue', Match.objectLike({ VisibilityTimeout: 240 }));
```

- [ ] **Step 2: Run, verify it fails.** `pnpm nx test investor-profile-ctrl`. Expected: FAIL (Timeout currently 300, VisibilityTimeout 1800).

- [ ] **Step 3: Implement.** Add explicit `lambdaTimeout` + `visibilityTimeout` props to the `Ingress` call (keep `profile: agentProps`). Add `Duration` import if absent.

```ts
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [ /* unchanged */ ],
  profile: agentProps,
  // IP-ctrl is a continuous-projection writer with NO production deadline
  // (it resumes no SF task token). Tuned so a maxVms-driven SQS redrive
  // lands ~4min after a failure — see the agentcore-invocation-resilience spec.
  lambdaTimeout: Duration.seconds(150),
  visibilityTimeout: Duration.seconds(240),
  lambdaProps: { paramsAndSecrets: PARAMS_AND_SECRETS_LAYER },
});
```

- [ ] **Step 4: Run tests, verify pass.** `pnpm nx test investor-profile-ctrl`. Expected: PASS.

- [ ] **Step 5: Commit.**

---

### Task 3: Defect B — widen the `onboarded()` fixture budget

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts` (`onboarded()`, the `InvestorProfileSnapshot` poll, ~line 122 + 134)

- [ ] **Step 1: Implement.** Change the snapshot poll deadline `60_000 → 360_000`; update the throw message. Add a one-line comment citing the spec (native-retry recovery window).

```ts
// 360s covers one full SQS native-retry redrive: IP-ctrl ingress visibility
// timeout (240s) + agent invoke (~90s p99) + CDC/EB/adapter (~20s). See
// docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md
const deadline = Date.now() + 360_000;
// ...
throw new Error('onboarded(): InvestorProfileSnapshot not materialised within 360s');
```

- [ ] **Step 2: Typecheck.** `pnpm nx run e2e-feature-tests:lint` (or `tsc`). Expected: clean.

- [ ] **Step 3: Commit.**

---

### Task 4: ledger-bff `quantity` schema fix

**Files:**
- Modify: `services/ledger/ledger-bff/src/schema.graphql`

- [ ] **Step 1: Implement.** `Position.quantity` and `PositionDiff.{actualQuantity,simulatedQuantity,quantityDiff}`: `Int! → Float!`. (Downstream TS already uses `number`; no resolver change. `dashboard-bff` already uses `Float!`.)

- [ ] **Step 2: Run ledger-bff tests.** `pnpm nx test ledger-bff`. Expected: PASS (existing tests use integer literals, valid as `Float`).

- [ ] **Step 3: Commit.**

---

### Task 5: Deploy + e2e validation gate

- [ ] **Step 1: Deploy.** `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,ledger-bff` plus any `event-processor`-consumer redeploys (the lib change affects every consumer — deploy advisory + ledger + investor services that import it, or full deploy).

- [ ] **Step 2: E2e gate — run 1.** `AWS_PROFILE=nestfolio-dev NODE_OPTIONS='--experimental-vm-modules' pnpm jest --config apps/e2e-feature-tests/jest.config.js --runInBand --testPathPatterns "accept-decision.e2e|request-closure.e2e|update-goal.e2e"`. Expected: 3/3 PASS.

- [ ] **Step 3: E2e gate — runs 2 and 3.** Repeat. All three runs must be green (per `feedback_flake_means_broken`). If any run fails, pull CloudWatch evidence from that run's window before proceeding.

- [ ] **Step 4: Mark the backlog item shipped.** Set `status: shipped` + `validation_gate` in `docs/backlog/agentcore-invocation-resilience.md`; run `node .claude/skills/backlog-lint/lint.mjs --fix`.

---

## Out of scope

Per the spec §7: in-handler retry inside `invoke-agentcore.ts` (rejected); production `maxVms` quota increase (`agentcore-maxvms-prod-quota-increase`, QUEUED); `onboarded()` AgentCore decoupling (`e2e-fixture-agentcore-synchronous-coupling`, QUEUED); PE/AN backlog-trap tuning (`agent-pipeline-backlog-trap-impl`).
