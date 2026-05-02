import { test, expect } from '../fixtures/test';
import { AgentTraceTrap } from '@nestfolio/e2e-feature-tests';
import { OnboardingChatPage, type OperatingMode } from '../pages/onboarding.page';
import { DashboardPage } from '../pages/dashboard.page';
import { InvestorPage } from '../pages/investor.page';
import { AdvisoryPage } from '../pages/advisory.page';
import { HostPage } from '../pages/host.page';
import { injectAdvisoryUpdate } from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';
// Spike 1.3 concluded `initiateDeposit` defaults to ENABLED when no flag row
// exists, so Phase 4 Task 4.2 was skipped. The import below stays commented;
// uncomment only if a future regression flips that default to disabled.
// import { enableDepositFlag } from '../fixtures/enable-deposit-flag';

test('new-investor-happy-path: onboarding → deposit → decision → logout', async ({
  ctx,
  tenant,
  authedPage,
}) => {
  const onboarding = new OnboardingChatPage(authedPage);
  const dashboard = new DashboardPage(authedPage);
  const investor = new InvestorPage(authedPage);
  const advisory = new AdvisoryPage(authedPage);
  const host = new HostPage(authedPage);

  // Step 1 — arm AgentTraceTrap for onboarding BEFORE any agent-triggering action.
  const trap = await test.step('arm agent trace trap', () =>
    AgentTraceTrap.arm(ctx, 'onboarding'),
  );

  // Step 2 — navigate to /onboarding; shell routes to onboarding-mfe.
  await test.step('route to onboarding', async () => {
    await onboarding.goto();
    await expect(authedPage).toHaveURL(/\/onboarding$/);
    // First renderer proves the graph started AND native-federation loaded the remote.
    await onboarding.waitForRenderer('render_options', 60_000);
    expect(await onboarding.phaseIndex()).toBe(0);
  });

  // Step 3 — walk phases 0..4 (options → mode-cards → slider → amount → summary).
  await test.step('phase 0: options', async () => {
    await onboarding.selectOption('growth');
    await onboarding.waitForRenderer('render_mode_cards');
    expect(await onboarding.phaseIndex()).toBe(1);
  });

  const pickedMode: OperatingMode = 'balanced';
  await test.step('phase 1: mode cards', async () => {
    await onboarding.selectMode(pickedMode);
    await onboarding.waitForRenderer('render_slider');
    expect(await onboarding.phaseIndex()).toBe(2);
  });

  await test.step('phase 2: slider', async () => {
    await onboarding.setSlider(10);
    await onboarding.waitForRenderer('render_amount');
    expect(await onboarding.phaseIndex()).toBe(3);
  });

  await test.step('phase 3: amount', async () => {
    await onboarding.setAmount(50_000_00);
    await onboarding.waitForRenderer('render_summary');
    expect(await onboarding.phaseIndex()).toBe(4);
  });

  await test.step('phase 4: summary', async () => {
    await onboarding.confirmSummary();
    await onboarding.waitForRenderer('render_consent');
    expect(await onboarding.phaseIndex()).toBe(5);
  });

  // Step 4 — mid-wizard product question → KB interaction (transitional observability).
  // The spec explicitly allows a single observability assertion for the KB tool call
  // because no UI citations surface exists yet (Phase 2 / Phase 3 future work).
  await test.step('KB plumbing: ask a product question', async () => {
    await onboarding.sendMessage('Come funziona il rebalancing?');
    await onboarding.waitForAssistantReply(90_000);

    // The onboarding agent emits ONE AgentTraceEnvelope per /invocations call,
    // so by the time the user reaches this step there are already several
    // (initial render + commits + render). Poll across all collected traces
    // until one carries the search_knowledge_base toolCall, since the trap's
    // default minCount returns on the first arriving envelope (which is the
    // initial render with empty toolCalls).
    const deadline = Date.now() + 90_000;
    let kbCall: { toolName: string; status: string; argKeys: string[] } | undefined;
    while (Date.now() < deadline && !kbCall) {
      const traces = await trap.waitFor({
        correlationId: tenant.tenantId,
        minCount: 1,
        timeoutMs: Math.max(2_000, deadline - Date.now()),
      });
      kbCall = traces
        .flatMap((t) => t.envelope.toolCalls)
        .find((c) => c.toolName === 'search_knowledge_base');
      if (!kbCall) await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(kbCall, 'expected a search_knowledge_base tool call on onboarding bus').toBeTruthy();
    expect(kbCall!.status).toBe('success');
    expect(kbCall!.argKeys).toContain('query');
  });

  // Step 5 — consent + CTA; after CTA, OnboardingChatComponent.onCtaClick
  //          forces Amplify session refresh and navigates to /dashboard.
  await test.step('phase 5: consent', async () => {
    await onboarding.grantConsent();
    await onboarding.waitForRenderer('render_cta');
    expect(await onboarding.phaseIndex()).toBe(6);
  });

  await test.step('phase 6: CTA → redirect', async () => {
    await onboarding.clickCta();
    await expect(authedPage).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  });

  // Step 6 — dashboard renders post-onboarded shell.
  await test.step('dashboard loaded', async () => {
    await dashboard.waitForLoaded();
  });

  // Step 7 — fund account flow.
  await test.step('deposit: form → initiated → detected', async () => {
    // Commented branch: if Task 1.3's flag default ever flips, uncomment.
    // await enableDepositFlag(ctx, tenant);

    await dashboard.clickDeposit();
    await expect(authedPage).toHaveURL(/\/investor\/deposit$/);
    await investor.waitForDepositForm();
    await investor.enterAmount(5000);
    await investor.confirm();
    await investor.waitForInitiated();
    await investor.waitForDetected();
  });

  // Step 8 — pending-decisions counter advances on the dashboard, AND a
  //          subsequent IAM-signed publishDashboardUpdate broadcast reaches
  //          the live subscription without a page reload (WSS path proof).
  await test.step('decision pipeline triggers + WSS live-update verified', async () => {
    await authedPage.goto('/dashboard');
    await dashboard.waitForLoaded();
    // Pipeline write reaches the dashboard via either getDashboard query or
    // a WSS frame — accept whichever; baseline is the current displayed count.
    await dashboard.waitForPendingDecisionsAtLeast(1, 180_000);
    const baseline = await dashboard.getCurrentPendingDecisions();

    // Inject a sentinel value the pipeline never produces. The dashboard is
    // mounted with an active subscription; the only way `.alert-text` updates
    // to this value (no reload) is via the onDashboardUpdate WSS broadcast.
    const sentinel = baseline + 100;
    await injectAdvisoryUpdate(ctx, tenant.tenantId, sentinel);
    await dashboard.waitForPendingDecisionsExactly(sentinel, 30_000);

    // Wait for advisory-bff's projection to actually carry the decision row
    // the dashboard counter is announcing. The two projections run in
    // parallel and advisory typically lags the dashboard by 30+ seconds; if
    // we navigate to /advisory before the row exists, Step 9's 15s POM
    // timeout fires on empty state — a pipeline-latency bug masquerading as
    // a UI race. See `wait-for-advisory-projection.ts` for the rationale.
    await waitForAdvisoryDecisionRow(ctx, tenant);
  });

  // Step 9-10 — read rationale; accept decision.
  await test.step('open decision, read rationale, confirm', async () => {
    await advisory.goToFirstPendingDecision();
    await advisory.waitForRationale();
    const rationale = await advisory.rationaleText();
    expect(rationale.length).toBeGreaterThan(10); // non-empty narrative agent output
    await advisory.confirm();
    await advisory.waitForConfirmed();
  });

  // Step 11 — logout.
  await test.step('logout', async () => {
    await host.logout();
    await host.waitForLogin();
    await host.assertAuthStoreUnauthenticated();
  });
});
