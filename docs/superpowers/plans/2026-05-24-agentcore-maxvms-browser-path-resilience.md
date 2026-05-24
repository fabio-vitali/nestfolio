# AgentCore maxVms browser-path resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-22-agentcore-maxvms-browser-path-resilience-design.md`

**Goal:** Make AgentCore `maxVms` saturation non-fatal for the onboarding browser path. Two independent fixes: (1) shorten the 4 advisory/investor agent runtime `idleTimeout`/`maxLifetime` to 2 min / 30 min so finished sessions free their micro-VMs well before the ~240 s SQS-redrive window; (2) make `onboarding-chat.component.ts` auto-retry a 402/429 SSE error with `[2 s, 4 s, 8 s]` backoff and surface a "reconnecting" UI state instead of the dead-end error.

**Architecture:** Code-only — no new CDK constructs, no new dependencies. Fix 1 passes `idleTimeout`/`maxLifetime` to the existing `AgentRuntime` extension construct (overriding its 15 min / 4 h defaults) in 4 stacks. Fix 2 reads `err.status` on the AG-UI `HttpAgent` SSE error (the library attaches both `status` and the parsed `payload` body), schedules `runAgent(this.messages())` on a backoff timer when it's 402/429, and renders a new `reconnecting` signal in the template.

**Tech Stack:** AWS CDK (`@aws-cdk/aws-bedrock-agentcore-alpha` 2.243.0-alpha.0; `LifecycleConfigurationProperty` maps to CFN `LifecycleConfiguration.{IdleRuntimeSessionTimeout,MaxLifetime}` in seconds), Jest CDK assertions (`aws-cdk-lib/assertions.Template`), Angular 21 standalone component with signals, `@ag-ui/client` `HttpAgent` SSE, Jest fake timers.

---

## File map

**Create:** none.

**Modify (CDK stacks — Fix 1):**
- `services/advisory/investor-profile-ctrl/src/service.stack.ts:120-134`
- `services/advisory/portfolio-engine-ctrl/src/service.stack.ts:117-131` (also add `Duration` import)
- `services/advisory/market-intelligence-ctrl/src/service.stack.ts:145-158`
- `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:100-113` (also add `Duration` import)

**Modify (CDK stack tests — Fix 1):**
- `services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts`
- `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`
- `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`
- `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`

**Modify (onboarding MFE — Fix 2):**
- `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`
- `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts`

---

## Task 1 — Tighten the 4 advisory/investor agent runtime idle/lifetime

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts:120-134`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts:117-131`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts:145-158`
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:100-113`
- Test: `services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts`
- Test: `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`
- Test: `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`
- Test: `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`

All 4 stacks receive the *same* change. Test the 4 in one TDD cycle, then modify the 4 in one batch, one commit.

- [ ] **Step 1: Install deps (worktree first-use)**

```bash
pnpm install --frozen-lockfile
```

Expected: completes without errors. Required because this worktree was created fresh.

- [ ] **Step 2: Add the failing assertion to investor-profile-ctrl**

In `services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts`, add this new `it` block inside the existing `describe('InvestorProfileCtrlStack', ...)`. Place it directly after the `'tunes the Ingress Lambda timeout...'` test (so all the timing-related assertions sit together):

```ts
  it('overrides the AgentCore Runtime idle/lifetime to 2 min / 30 min', () => {
    // Defaults from libs/cdk-constructs/src/extensions/agent-runtime.ts are
    // 15 min idle / 4 h max — far too loose for headless burst sessions that
    // are never re-invoked. 2 min idle sits below the 240 s SQS-redrive window
    // (see `agentcore-invocation-resilience`) so a 402'd invoke's micro-VMs
    // are reclaimed before its redrive fires. CFN serialises Duration in seconds.
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: 120,
        MaxLifetime: 1800,
      },
    });
  });
```

- [ ] **Step 3: Add the same failing assertion to portfolio-engine-ctrl**

In `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`, add the identical `it` block inside its `describe`:

```ts
  it('overrides the AgentCore Runtime idle/lifetime to 2 min / 30 min', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: 120,
        MaxLifetime: 1800,
      },
    });
  });
```

- [ ] **Step 4: Add the same failing assertion to market-intelligence-ctrl**

In `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`, add the same `it` block.

```ts
  it('overrides the AgentCore Runtime idle/lifetime to 2 min / 30 min', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: 120,
        MaxLifetime: 1800,
      },
    });
  });
```

- [ ] **Step 5: Add the same failing assertion to advisory-narrative-ctrl**

In `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`, add the same `it` block.

```ts
  it('overrides the AgentCore Runtime idle/lifetime to 2 min / 30 min', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: 120,
        MaxLifetime: 1800,
      },
    });
  });
```

- [ ] **Step 6: Run all 4 unit suites and verify the 4 new tests fail**

```bash
pnpm nx run-many --target=test --projects=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl
```

Expected: each suite has exactly **1 failing test** — the new `overrides the AgentCore Runtime idle/lifetime to 2 min / 30 min`. Failure should be a `Template has X resources with type AWS::BedrockAgentCore::Runtime, but none match as expected`-style diff showing no `LifecycleConfiguration` is set.

- [ ] **Step 7: Modify investor-profile-ctrl service.stack.ts**

`Duration` is already imported (line 1). Edit `services/advisory/investor-profile-ctrl/src/service.stack.ts` — replace the existing `new AgentRuntime(...)` props block at lines 120–134 with the same block plus two new properties:

```ts
    // AgentRuntime (no tool Lambdas for this service — RAG only)
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'investor-profile'),
      description: 'user-goals (Haiku) + risk-assessment (Sonnet 4.6) parallel orchestration',
      state,
      modelIds: [modelSonnetId, modelHaikuId],
      toolTargets: [],
      // Tightened from construct defaults (15 min / 4 h) — headless burst
      // sessions; idle sits below the 240 s SQS-redrive window so quota frees
      // before redrive (see agentcore-maxvms-browser-path-resilience spec).
      idleTimeout: Duration.minutes(2),
      maxLifetime: Duration.minutes(30),
      environmentVariables: {
        MODEL_SONNET_ID: modelSonnetId,
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
    });
```

- [ ] **Step 8: Modify portfolio-engine-ctrl service.stack.ts**

PE-ctrl does NOT yet import `Duration`. Add it to the existing imports (top of file). Add this line near the existing imports from `aws-cdk-lib`:

```ts
import { Duration } from 'aws-cdk-lib';
```

Then replace the `new AgentRuntime(...)` props block at lines 117–131:

```ts
    // AgentRuntime
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'portfolio_engine_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'portfolio-engine'),
      description: 'portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelSonnetId],
      toolTargets: [],
      idleTimeout: Duration.minutes(2),
      maxLifetime: Duration.minutes(30),
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
    });
```

- [ ] **Step 9: Modify market-intelligence-ctrl service.stack.ts**

`Duration` is already imported (line 6). Replace the `new AgentRuntime(...)` props block at lines 145–158:

```ts
    // AgentRuntime
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'market_intelligence_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'market-intelligence'),
      description: 'market-research (Sonnet) single agent with tool access',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
      idleTimeout: Duration.minutes(2),
      maxLifetime: Duration.minutes(30),
      environmentVariables: {
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
    });
```

- [ ] **Step 10: Modify advisory-narrative-ctrl service.stack.ts**

AN-ctrl does NOT yet import `Duration`. Add the import:

```ts
import { Duration } from 'aws-cdk-lib';
```

Then replace the `new AgentRuntime(...)` props block at lines 100–113:

```ts
    // AgentRuntime (no tool Lambdas — all context arrives in event payload)
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_narrative_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'advisory-narrative'),
      description: 'explainability (Haiku 4.5, 8192 tokens) agent with feedback loop KB',
      state,
      modelIds: [modelHaikuId],
      toolTargets: [],
      idleTimeout: Duration.minutes(2),
      maxLifetime: Duration.minutes(30),
      environmentVariables: {
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
    });
```

- [ ] **Step 11: Run all 4 suites again and verify all green**

```bash
pnpm nx run-many --target=test --projects=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl
```

Expected: every suite passes, including the 4 new assertions. If a suite fails with a CFN-key casing diff (e.g. `idleRuntimeSessionTimeout` vs `IdleRuntimeSessionTimeout`), read the actual template excerpt in the failure output and update the assertion to match the rendered key. (The L1 `aws-cdk-lib/aws-bedrockagentcore` generated CFN spec uses PascalCase — confirmed in `bedrockagentcore.generated.d.ts:3920-3934` — so the PascalCase assertion above should match without adjustment.)

- [ ] **Step 12: Run lint on the same 4 projects**

```bash
pnpm nx run-many --target=lint --projects=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl
```

Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/service.stack.ts \
        services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts \
        services/advisory/portfolio-engine-ctrl/src/service.stack.ts \
        services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts \
        services/advisory/market-intelligence-ctrl/src/service.stack.ts \
        services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts \
        services/advisory/advisory-narrative-ctrl/src/service.stack.ts \
        services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
fix(advisory): tighten 4 agent runtime idle/lifetime to 2min/30min

Overrides the AgentRuntime construct defaults (15min/4h) on the 4
advisory/investor agent runtimes (IP/PE/MI/AN-ctrl). Headless burst
sessions are never re-invoked, so the 13-min idle window after a
finished decision cycle is pure quota waste — and across an e2e
run it drives concurrent micro-VM count to the account maxVms
ceiling, surfacing as 402 ServiceQuotaExceededException on
unrelated paths (notably the browser-direct onboarding SSE call).

The 2-min idle sits below the 240s SQS-visibility window that
agentcore-invocation-resilience set on IP-ctrl, so a 402'd invoke's
micro-VMs are reclaimed before its native redrive fires — the
desired interaction.

Each stack's unit test gains a CDK assertion on
LifecycleConfiguration.{IdleRuntimeSessionTimeout=120,MaxLifetime=1800}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Onboarding browser auto-retry on 402/429 SSE errors

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`
- Modify: `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts`

This task adds the retry state, the backoff scheduler, the terminal-message split, the cleanup hook, and the template banner. Multiple TDD cycles inside one task, single commit at the end. The existing spec mocks `HttpAgent` with `mockHttpAgent.run` returning a `Subject` — error tests emit via `sub$.error({ status, payload, message })`.

- [ ] **Step 1: Add the failing test for "quota error schedules retry after 2 s"**

Append this `describe` block to `apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts`, after the existing tests:

```ts
  describe('quota-error auto-retry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('schedules a retry after 2s on a 402 SSE error and shows reconnecting state', async () => {
      const sub$ = new Subject<unknown>();
      mockHttpAgent.run.mockReturnValue(sub$.asObservable());
      component.ngOnInit();
      await drainMicrotasks();
      expect(mockHttpAgent.run).toHaveBeenCalledTimes(1);

      const quotaErr = Object.assign(new Error('HTTP 402: {"message":"maxVms limit exceeded"}'), {
        status: 402,
        payload: { message: 'maxVms limit exceeded' },
      });
      sub$.error(quotaErr);
      await drainMicrotasks();

      expect(component.errorMessage()).toBeNull();
      expect(component.reconnecting()).toBe(true);

      jest.advanceTimersByTime(2_000);
      await drainMicrotasks();

      expect(mockHttpAgent.run).toHaveBeenCalledTimes(2);
    });
  });
```

- [ ] **Step 2: Run the spec and verify this new test fails**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: the new test fails with `Property 'reconnecting' does not exist on type 'OnboardingChatComponent'` (the signal isn't there yet) and `mockHttpAgent.run` called only once.

- [ ] **Step 3: Add the `reconnecting` signal + backoff schedule + auto-retry plumbing**

Edit `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`. Below the existing `TIMEOUT_MS = 45_000;` constant (around line 63), add:

```ts
// Backoff schedule for AgentCore quota (402) / throttle (429) errors. The
// browser is the retry-of-last-resort for the onboarding SSE path (the backend
// SQS native-redrive of agentcore-invocation-resilience covers only the
// event-driven agents). 3 attempts ≈ 14s total added wait — fits the e2e
// POM's 60s waitForRenderer with no POM change; absorbs transient saturation
// without papering over sustained quota exhaustion.
const RETRY_BACKOFF_MS = [2_000, 4_000, 8_000] as const;
```

In the component class, after the existing signal declarations (around line 175 — alongside `connectionStatus`), add:

```ts
  reconnecting = signal(false);
```

After the existing private state (around line 190, near `agentState`), add:

```ts
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
```

Then **replace** the existing stream `error` callback (currently around lines 394–399) with the new branching logic:

```ts
      error: (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[OnboardingChat] SSE error:', err);
        const status = (err as { status?: number } | null)?.status;
        const isQuota = status === 402 || status === 429;
        if (isQuota && this.retryAttempt < RETRY_BACKOFF_MS.length) {
          const delay = RETRY_BACKOFF_MS[this.retryAttempt];
          this.retryAttempt += 1;
          this.cleanup();
          this.reconnecting.set(true);
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.runAgent(this.messages());
          }, delay);
          return;
        }
        this.errorMessage.set(
          isQuota
            ? 'Servizio temporaneamente sovraccarico, riprova tra poco.'
            : 'Connessione interrotta. Controlla la tua rete e riprova.',
        );
        this.reconnecting.set(false);
        this.finishStream();
      },
```

The counter must reset on every *user-initiated* turn. Find the `private async runAgent(history: ChatMessage[]): Promise<void> {` body (around line 231). The reset cannot live at the top of `runAgent()` because auto-retry also calls `runAgent()` — that would defeat the budget. Instead, reset in the three user-initiated entry points. Add `this.retryAttempt = 0;` and `this.reconnecting.set(false);` as the first lines of each of: `ngOnInit` (right before `this.runAgent([])`), `submitUserContent` (right before `this.runAgent(this.messages())`), and `retry` (right before `this.runAgent(this.messages())`). Existing reset of `errorMessage`/`timedOut` in `runAgent` stays — those are per-attempt, not per-budget.

`ngOnInit` (~line 200):

```ts
  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.cleanup();
      this.destroyAllRenderers();
    });
    this.retryAttempt = 0;
    this.reconnecting.set(false);
    this.runAgent([]);
  }
```

`submitUserContent` (~line 216):

```ts
  private submitUserContent(content: string): void {
    if (!content || this.isStreaming()) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content };
    this.messages.update((prev) => [...prev, userMsg]);
    this.retryAttempt = 0;
    this.reconnecting.set(false);
    this.runAgent(this.messages());
  }
```

`retry` (~line 223):

```ts
  retry(): void {
    this.errorMessage.set(null);
    this.timedOut.set(false);
    this.retryAttempt = 0;
    this.reconnecting.set(false);
    this.runAgent(this.messages());
  }
```

Finally, extend `cleanup()` (find it — it currently clears `streamSub`/timers) so that on cleanup we also cancel any pending retry timer. Locate the `cleanup()` method and add the `retryTimer` clearance alongside the existing timer clears:

```ts
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
```

Also: the auto-retry's `runAgent()` call clears `reconnecting` at its start (the stream is in flight again — RUN_STARTED isn't dispatched on error, so the cleanest place is at the top of the new in-flight stream). Add `this.reconnecting.set(false);` as the first line inside `runAgent()` (right above the existing `this.isStreaming.set(true);`).

- [ ] **Step 4: Run the spec and verify the first test passes**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: the `schedules a retry after 2s on a 402 SSE error...` test passes. All previously-passing tests still pass.

- [ ] **Step 5: Add the failing test for "3 failed attempts → terminal quota message"**

Inside the same `quota-error auto-retry` describe block, add:

```ts
    it('shows a quota-specific terminal message after 3 failed retries', async () => {
      const sub$ = new Subject<unknown>();
      mockHttpAgent.run.mockReturnValue(sub$.asObservable());
      component.ngOnInit();
      await drainMicrotasks();

      const quotaErr = Object.assign(new Error('HTTP 402'), { status: 402 });

      // Attempt 1 fails → schedules retry 1
      sub$.error(quotaErr);
      await drainMicrotasks();
      jest.advanceTimersByTime(2_000);
      await drainMicrotasks();

      // Attempt 2 fails → schedules retry 2
      sub$.error(quotaErr);
      await drainMicrotasks();
      jest.advanceTimersByTime(4_000);
      await drainMicrotasks();

      // Attempt 3 fails → schedules retry 3
      sub$.error(quotaErr);
      await drainMicrotasks();
      jest.advanceTimersByTime(8_000);
      await drainMicrotasks();

      // Attempt 4 fails → budget exhausted → terminal quota message
      sub$.error(quotaErr);
      await drainMicrotasks();

      expect(mockHttpAgent.run).toHaveBeenCalledTimes(4);
      expect(component.reconnecting()).toBe(false);
      expect(component.errorMessage()).toBe(
        'Servizio temporaneamente sovraccarico, riprova tra poco.',
      );
    });
```

- [ ] **Step 6: Run and verify it passes**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: passes (the Step 3 implementation already covers exhaustion).

- [ ] **Step 7: Add the failing test for "non-quota error → immediate error, no retry"**

Inside the same describe block:

```ts
    it('does not auto-retry on a non-quota error and surfaces the generic message', async () => {
      const sub$ = new Subject<unknown>();
      mockHttpAgent.run.mockReturnValue(sub$.asObservable());
      component.ngOnInit();
      await drainMicrotasks();

      const networkErr = Object.assign(new Error('network down'), { status: 0 });
      sub$.error(networkErr);
      await drainMicrotasks();

      jest.advanceTimersByTime(10_000);
      await drainMicrotasks();

      expect(mockHttpAgent.run).toHaveBeenCalledTimes(1);
      expect(component.reconnecting()).toBe(false);
      expect(component.errorMessage()).toBe(
        'Connessione interrotta. Controlla la tua rete e riprova.',
      );
    });
```

- [ ] **Step 8: Run and verify it passes**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: passes.

- [ ] **Step 9: Add the failing test for "user-initiated send resets the budget"**

Inside the same describe block:

```ts
    it('resets the retry budget when the user sends a new message', async () => {
      const sub$ = new Subject<unknown>();
      mockHttpAgent.run.mockReturnValue(sub$.asObservable());
      component.ngOnInit();
      await drainMicrotasks();

      const quotaErr = Object.assign(new Error('HTTP 402'), { status: 402 });
      // Exhaust the budget: 4 failures (3 retries + 1 budget-exhausted)
      for (const ms of [2_000, 4_000, 8_000]) {
        sub$.error(quotaErr);
        await drainMicrotasks();
        jest.advanceTimersByTime(ms);
        await drainMicrotasks();
      }
      sub$.error(quotaErr);
      await drainMicrotasks();
      expect(component.errorMessage()).not.toBeNull();

      // User sends a new message — counter must reset; a fresh 402 must
      // schedule a retry (not fall straight to the terminal message).
      const callsBeforeSend = mockHttpAgent.run.mock.calls.length;
      component.inputValue.set('hello again');
      component.sendMessage();
      await drainMicrotasks();
      expect(mockHttpAgent.run.mock.calls.length).toBe(callsBeforeSend + 1);

      sub$.error(quotaErr);
      await drainMicrotasks();
      expect(component.reconnecting()).toBe(true);
      expect(component.errorMessage()).toBeNull();
    });
```

- [ ] **Step 10: Run and verify it passes**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: passes (Step 3's resets in `submitUserContent`/`sendMessage` path do the work).

- [ ] **Step 11: Add the failing test for "destroying the component cancels the pending retry timer"**

Inside the same describe block:

```ts
    it('cancels the pending retry timer when the component is destroyed', async () => {
      const sub$ = new Subject<unknown>();
      mockHttpAgent.run.mockReturnValue(sub$.asObservable());
      component.ngOnInit();
      await drainMicrotasks();

      const quotaErr = Object.assign(new Error('HTTP 402'), { status: 402 });
      sub$.error(quotaErr);
      await drainMicrotasks();
      expect(component.reconnecting()).toBe(true);

      // Tear the component down before the backoff fires.
      fixture.destroy();
      jest.advanceTimersByTime(10_000);
      await drainMicrotasks();

      // No second call: the timer was cleared on destroy.
      expect(mockHttpAgent.run).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 12: Run and verify it passes**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: passes (the `cleanup()` extension in Step 3 cancels the timer; `destroyRef.onDestroy(() => this.cleanup())` is already wired).

- [ ] **Step 13: Add the failing test for the reconnecting banner in the template**

Inside the same describe block:

```ts
    it('renders a reconnecting banner while waiting for the next retry', async () => {
      const sub$ = new Subject<unknown>();
      mockHttpAgent.run.mockReturnValue(sub$.asObservable());
      component.ngOnInit();
      await drainMicrotasks();

      const quotaErr = Object.assign(new Error('HTTP 402'), { status: 402 });
      sub$.error(quotaErr);
      await drainMicrotasks();
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector('.reconnecting-banner');
      expect(banner).toBeTruthy();
      expect(banner.textContent).toContain('Riconnessione in corso');
    });
```

- [ ] **Step 14: Run and verify it fails**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: this new test fails — no `.reconnecting-banner` element in the DOM yet.

- [ ] **Step 15: Add the reconnecting banner to the template**

In `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`, find the existing error-banner block in the inline template (around line 88 — `@if (errorMessage()) { ... }`). Add a new `@if (reconnecting())` block immediately above it, so that during an auto-retry the user sees a reconnecting state distinct from the dead-end error alert:

```html
      <!-- Reconnecting banner — shown during quota-error auto-retry -->
      @if (reconnecting()) {
        <div class="reconnecting-banner" role="status">
          <span>Riconnessione in corso…</span>
        </div>
      }

      <!-- Error banner -->
      @if (errorMessage()) {
        <div class="error-banner" role="alert">
          <span>{{ errorMessage() }}</span>
          <button class="retry-btn" (click)="retry()">Riprova</button>
        </div>
      }
```

- [ ] **Step 16: Run and verify the banner test passes**

```bash
pnpm nx run onboarding-mfe:test --testPathPattern=onboarding-chat.component.spec
```

Expected: passes. All previous tests still pass.

- [ ] **Step 17: Run the full onboarding-mfe suite + lint**

```bash
pnpm nx run-many --target=test,lint --projects=onboarding-mfe
```

Expected: all green.

- [ ] **Step 18: Commit**

```bash
git add apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts \
        apps/onboarding-mfe/test/app/onboarding-chat.component.spec.ts
git commit -m "$(cat <<'EOF'
fix(onboarding-mfe): auto-retry 402/429 SSE errors with backoff

The onboarding chat talks browser-direct to AgentCore via SSE — no
SQS queue, so the backend's agentcore-invocation-resilience
native-redrive does nothing for this path. A maxVms 402 lands in
the AG-UI HttpAgent's `error` callback as
`{status: 402, payload: {message: "maxVms limit exceeded..."}}` and
the previous dead-end "Connessione interrotta" copy is misleading
(the user's network is fine).

New behavior: on err.status 402 or 429, with budget remaining,
schedule runAgent(this.messages()) on the next backoff slot
[2s, 4s, 8s] and show a 'Riconnessione in corso…' banner. Counter
resets on user-initiated turns (ngOnInit, sendMessage, retry).
Budget exhaustion shows an accurate quota terminal message; the
generic copy stays for non-quota errors. Pending retry timer is
cleared by cleanup() (already wired into destroyRef).

Tests: 5 new cases via mocked HttpAgent Subject + fake timers —
retry-on-402, 3-attempt terminal, non-quota no-retry, user-send
resets budget, destroy cancels pending timer, banner DOM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Deploy to dev + Playwright validation

This task ships nothing new but proves the validation gate from the spec. No commit produced — deploy is a side effect, e2e is read-only.

- [ ] **Step 1: Deploy the 4 advisory services to the dev sandbox**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --services=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl \
  2>&1 | tee /tmp/agentcore-maxvms-deploy.log
```

Expected: deploy completes for all 4 services without CFN errors.

If CloudFormation reports a runtime *replacement* (the `AWS::BedrockAgentCore::Runtime` logical id receives a new physical id with a fresh `-XXXXXXXXXX` suffix) rather than an in-place update on the `LifecycleConfiguration` change, that is acceptable — each agent's Step Functions orchestration reads the runtime ARN via SSM within the same per-service deploy, so the new ARN is propagated in the same `deploy.sh` invocation. No cross-stack staleness like the onboarding↔investor-web `copilot-rewrite.js` coupling. Note which behavior occurred in the validation summary at the end.

- [ ] **Step 2: Verify the 4 runtimes are READY post-deploy**

```bash
AWS_PROFILE=nestfolio-dev aws bedrock-agentcore-control list-agent-runtimes \
  --region us-east-1 \
  --query "agentRuntimes[?contains(agentRuntimeName,'investor_profile_agents') || contains(agentRuntimeName,'portfolio_engine_agents') || contains(agentRuntimeName,'market_intelligence_agents') || contains(agentRuntimeName,'advisory_narrative_agents')].[agentRuntimeName,agentRuntimeId,status]" \
  --output text
```

Expected: all 4 rows show status `READY`.

- [ ] **Step 3: Confirm the lifecycleConfiguration values on the deployed runtimes**

```bash
for id in $(AWS_PROFILE=nestfolio-dev aws bedrock-agentcore-control list-agent-runtimes \
  --region us-east-1 \
  --query "agentRuntimes[?contains(agentRuntimeName,'_agents')].agentRuntimeId" --output text); do
  echo "=== $id ==="
  AWS_PROFILE=nestfolio-dev aws bedrock-agentcore-control get-agent-runtime \
    --region us-east-1 --agent-runtime-id "$id" \
    --query "[agentRuntimeName,lifecycleConfiguration]" --output json
done
```

Expected: each agent runtime shows `lifecycleConfiguration: {idleRuntimeSessionTimeout: 120, maxLifetime: 1800}`. (Onboarding stays 300/3600; it was not touched.)

- [ ] **Step 4: Rerun the 2 previously-failing Playwright specs**

```bash
pnpm exec playwright test --config apps/nestfolio-e2e/playwright.config.ts \
  apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts \
  apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts \
  2>&1 | tee /tmp/nestfolio-e2e-validation.log
```

Expected: both specs pass. No `renderer-render_options` timeout at the onboarding phase-1 step.

- [ ] **Step 5: If a transient 402 surfaces during the run, confirm the auto-retry absorbed it**

Check the Playwright trace for the spec(s) that completed. If the trace `0-trace.network` shows a 402 response on `/api/copilotkit` followed by a second `POST /api/copilotkit` 200 (or another 402 followed by a third successful POST), the new browser auto-retry is doing exactly what it was built for. Note this in the validation summary. If both specs pass with no 402 at all, the idle-timeout headroom alone resolved the saturation — also a valid outcome.

- [ ] **Step 6: Write the validation gate**

Update `docs/backlog/agentcore-maxvms-browser-path-resilience.md` frontmatter to `status: shipped`, set `validation_gate:` to a one-paragraph summary of: unit suite counts green (Task 1 + Task 2), per-runtime `lifecycleConfiguration` values from Step 3, both Playwright specs pass with timings from Step 4, and whether the run exercised the auto-retry path (Step 5). Then:

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
git add docs/backlog/agentcore-maxvms-browser-path-resilience.md docs/BACKLOG.md
git commit -m "docs(backlog): ship agentcore-maxvms-browser-path-resilience"
```

Expected: `backlog-lint` passes; the file moves from ACTIVE to Recently Shipped in `BACKLOG.md`.
