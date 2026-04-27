import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { OnboardingChatComponent } from '../../src/app/onboarding/onboarding-chat.component';
import { OptionsRendererComponent } from '../../src/app/onboarding/renderers/options-renderer.component';
import { ModeCardsRendererComponent } from '../../src/app/onboarding/renderers/mode-cards-renderer.component';
import { SliderRendererComponent } from '../../src/app/onboarding/renderers/slider-renderer.component';
import { AmountRendererComponent } from '../../src/app/onboarding/renderers/amount-renderer.component';
import { ConsentRendererComponent } from '../../src/app/onboarding/renderers/consent-renderer.component';
import { SummaryRendererComponent } from '../../src/app/onboarding/renderers/summary-renderer.component';
import { provideRouter } from '@angular/router';
import { EMPTY, Subject } from 'rxjs';
import { AuthStore, COPILOT_API_URL } from '@nestfolio/shell';

// ── Mock aws-amplify/auth ──────────────────────────────────────────────────────

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(async () => ({
    tokens: { idToken: { toString: () => 'fake-id-token' } },
  })),
}));

// ── Mock @ag-ui/client ────────────────────────────────────────────────────────

const mockRun$ = new Subject<unknown>();

const mockHttpAgent = {
  run: jest.fn(() => mockRun$.asObservable()),
};

jest.mock('@ag-ui/client', () => ({
  HttpAgent: jest.fn().mockImplementation(() => mockHttpAgent),
  EventType: {
    RUN_STARTED: 'RUN_STARTED',
    TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
    TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
    TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
    TOOL_CALL_START: 'TOOL_CALL_START',
    TOOL_CALL_ARGS: 'TOOL_CALL_ARGS',
    TOOL_CALL_END: 'TOOL_CALL_END',
    TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
    STATE_SNAPSHOT: 'STATE_SNAPSHOT',
    RUN_FINISHED: 'RUN_FINISHED',
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

const mockAuthStore = { user: () => ({ tenantId: 'tenant-xyz' }) };

describe('OnboardingChatComponent', () => {
  let fixture: ComponentFixture<OnboardingChatComponent>;
  let component: OnboardingChatComponent;

  beforeEach(async () => {
    mockHttpAgent.run.mockReturnValue(EMPTY);
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [OnboardingChatComponent],
      providers: [
        provideRouter([]),
        { provide: COPILOT_API_URL, useValue: 'https://example.cloudfront.net/api/copilotkit' },
        { provide: AuthStore, useValue: mockAuthStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Structural tests ───────────────────────────────────────────────────────

  it('renders agent header', () => {
    expect(fixture.nativeElement.querySelector('.agent-header')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Nestfolio');
  });

  it('renders progress bar', () => {
    expect(fixture.nativeElement.querySelector('.progress-bar')).toBeTruthy();
  });

  it('has default 7 total phases', () => {
    expect(component.totalPhases()).toBe(7);
  });

  it('computes progress percent correctly', () => {
    // default: phaseIndex=0, totalPhases=7 → (0+1)/7*100 ≈ 14.28
    expect(component.progressPercent()).toBeCloseTo(14.28, 1);
    component.phaseIndex.set(6);
    expect(component.progressPercent()).toBeCloseTo(100, 0);
  });

  it('renders chat input and send button', () => {
    expect(fixture.nativeElement.querySelector('.chat-input')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.send-btn')).toBeTruthy();
  });

  // ── AG-UI integration tests ────────────────────────────────────────────────

  it('appends a user message on sendMessage()', () => {
    component.inputValue.set('Ciao');
    component.sendMessage();
    const msgs = component.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Ciao');
  });

  it('clears inputValue after sendMessage()', () => {
    component.inputValue.set('Test');
    component.sendMessage();
    expect(component.inputValue()).toBe('');
  });

  it('does not send empty messages', () => {
    component.inputValue.set('   ');
    component.sendMessage();
    expect(component.messages()).toHaveLength(0);
  });

  it('sets isStreaming true while agent is running', () => {
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Hello');
    component.sendMessage();
    expect(component.isStreaming()).toBe(true);
  });

  it('sets isStreaming false when stream completes', () => {
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Hello');
    component.sendMessage();
    sub$.complete();
    expect(component.isStreaming()).toBe(false);
  });

  it('sets errorMessage on stream error', () => {
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Hello');
    component.sendMessage();
    sub$.error(new Error('network failure'));
    expect(component.errorMessage()).toBeTruthy();
  });

  it('appends assistant text message on TEXT_MESSAGE_CONTENT event', () => {
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Ciao');
    component.sendMessage();

    sub$.next({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
    sub$.next({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Benvenuto' });
    sub$.next({ type: 'TEXT_MESSAGE_END' });
    sub$.next({ type: 'RUN_FINISHED' });

    const assistantMsgs = component.messages().filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe('Benvenuto');
  });

  it('updates phaseIndex from STATE_SNAPSHOT event', () => {
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Go');
    component.sendMessage();

    sub$.next({ type: 'STATE_SNAPSHOT', snapshot: { phase_index: 3 } });
    sub$.complete();

    expect(component.phaseIndex()).toBe(3);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('shows loading indicator after 3s delay', () => {
    jest.useFakeTimers();
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Hello');
    component.sendMessage();

    expect(component.showLoading()).toBe(false);
    jest.advanceTimersByTime(3000);
    expect(component.showLoading()).toBe(true);

    sub$.complete();
  });

  it('shows timeout message after 15s', () => {
    jest.useFakeTimers();
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());
    component.inputValue.set('Hello');
    component.sendMessage();

    jest.advanceTimersByTime(15000);
    expect(component.timedOut()).toBe(true);
    expect(component.isStreaming()).toBe(false);
  });

  it('retry() clears error and re-runs the agent', () => {
    component.errorMessage.set('Error occurred');
    component.timedOut.set(true);
    component.retry();
    expect(component.errorMessage()).toBeNull();
    expect(component.timedOut()).toBe(false);
  });

  it('renders error banner when errorMessage is set', async () => {
    component.errorMessage.set('Connessione interrotta.');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error-banner')).toBeTruthy();
  });

  // ── Bridge wiring ──────────────────────────────────────────────────────────

  it('passes the absolute copilotApiUrl to HttpAgent', () => {
    const { HttpAgent } = require('@ag-ui/client');
    expect(HttpAgent).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.cloudfront.net/api/copilotkit' }),
    );
  });

  it('provides a headers factory that includes Bearer token + session-id', async () => {
    const { HttpAgent } = require('@ag-ui/client');
    const call = HttpAgent.mock.calls.at(-1)[0] as { headers?: () => Promise<Record<string, string>> };
    expect(typeof call.headers).toBe('function');
    const headers = await call.headers!();
    expect(headers['Authorization']).toBe('Bearer fake-id-token');
    expect(headers['x-amzn-bedrock-agentcore-runtime-session-id']).toMatch(/^tenant-xyz\/.+/);
  });

  it('persists the sessionId part across remounts via sessionStorage', async () => {
    const { HttpAgent } = require('@ag-ui/client');
    const firstCall = HttpAgent.mock.calls.at(-1)[0] as { headers: () => Promise<Record<string, string>> };
    const firstHeaders = await firstCall.headers();
    const firstSid = firstHeaders['x-amzn-bedrock-agentcore-runtime-session-id'];

    // Remount the component (destroy + recreate).
    fixture.destroy();
    fixture = TestBed.createComponent(OnboardingChatComponent);
    fixture.detectChanges();

    const secondCall = HttpAgent.mock.calls.at(-1)[0] as { headers: () => Promise<Record<string, string>> };
    const secondHeaders = await secondCall.headers();
    expect(secondHeaders['x-amzn-bedrock-agentcore-runtime-session-id']).toBe(firstSid);
  });

  // ── mountRenderer integration test ────────────────────────────────────────

  it('mountRenderer wires render_options output to submitUserContent', async () => {
    const sub$ = new Subject<unknown>();
    mockHttpAgent.run.mockReturnValue(sub$.asObservable());

    // First user turn — triggers TOOL_CALL_END for render_options
    component.inputValue.set('start');
    component.sendMessage();
    // runAgent is async (awaits fetchAuthSession) — drain the microtask queue
    // so the HttpAgent.run() subscription is set up before we push events
    await Promise.resolve();
    await Promise.resolve();

    sub$.next({ type: 'TOOL_CALL_START', toolCallId: 'tc-1', toolName: 'render_options' });
    sub$.next({ type: 'TOOL_CALL_ARGS', delta: JSON.stringify({ title: 'Pick one', options: [{ id: 'GROWTH', label: 'Growth' }] }) });
    sub$.next({ type: 'TOOL_CALL_END' });
    sub$.next({ type: 'RUN_FINISHED' });
    sub$.complete();

    // Let Angular render the tool-slot div (needed before the real setTimeout fires)
    fixture.detectChanges();
    await fixture.whenStable();

    // The production code calls setTimeout(..., 0) before mountRenderer.
    // Advance fake timer is not needed here since we're using real timers.
    // We just need the macrotask queue to drain — use setImmediate if available.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();

    // Reach into rendererRefs to grab the live OptionsRendererComponent instance
    const refs = (component as unknown as { rendererRefs: ComponentRef<unknown>[] }).rendererRefs;
    expect(refs).toHaveLength(1);
    const optionsInstance = refs[0].instance as OptionsRendererComponent;

    // Reset the agent-run spy so we count the next call only
    mockHttpAgent.run.mockClear();
    mockHttpAgent.run.mockReturnValue(EMPTY);

    // Emit user selection from the mounted renderer
    optionsInstance.selected.emit('GROWTH');
    // submitUserContent → runAgent is async (awaits fetchAuthSession) — drain microtasks
    await Promise.resolve();
    await Promise.resolve();

    // Verify the wiring: synthetic user message + agent re-run
    const userMessages = component.messages().filter(m => m.role === 'user');
    expect(userMessages.at(-1)?.content).toBe('GROWTH');
    expect(mockHttpAgent.run).toHaveBeenCalledTimes(1);
  });
});

// ── CTA renderer click → session refresh + AuthStore patch + dashboard navigate ──
//
// Design note: onCtaClick uses a single fetchAuthSession({ forceRefresh: true })
// rather than calling forceRefreshSession() (which is a wrapper that also calls
// fetchAuthSession internally) and then fetchAuthSession again. One round-trip to
// Cognito is enough; it returns the fresh tokens AND the idToken payload we need
// to read custom:onboarding_completed_at. forceRefreshSession() would be redundant.

describe('OnboardingChatComponent — CTA renderer click', () => {
  let fixture: ComponentFixture<OnboardingChatComponent>;
  let component: OnboardingChatComponent;
  let mockUpdateUser: jest.Mock;

  beforeEach(async () => {
    mockUpdateUser = jest.fn();
    const ctaAuthStore = {
      user: () => ({ tenantId: 'tenant-cta' }),
      updateUser: mockUpdateUser,
    };

    // Configure fetchAuthSession to return a session with onboarding_completed_at in payload
    const { fetchAuthSession } = require('aws-amplify/auth');
    (fetchAuthSession as jest.Mock).mockImplementation(async (opts?: { forceRefresh?: boolean }) => {
      if (opts?.forceRefresh) {
        return {
          tokens: {
            idToken: {
              toString: () => 'fresh-id-token',
              payload: { 'custom:onboarding_completed_at': '2026-04-27T10:00:00.000Z' },
            },
            accessToken: { toString: () => 'fresh-access-token' },
          },
        };
      }
      return {
        tokens: { idToken: { toString: () => 'fake-id-token' } },
      };
    });

    await TestBed.configureTestingModule({
      imports: [OnboardingChatComponent],
      providers: [
        provideRouter([]),
        { provide: COPILOT_API_URL, useValue: 'https://example.cloudfront.net/api/copilotkit' },
        { provide: AuthStore, useValue: ctaAuthStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('onCtaClick() force-refreshes session, patches AuthStore, and navigates to /dashboard', async () => {
    const { fetchAuthSession } = require('aws-amplify/auth');
    const router = TestBed.inject(require('@angular/router').Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.onCtaClick('complete');

    // fetchAuthSession was called with forceRefresh: true
    expect(fetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true });

    // AuthStore.updateUser was called with the decoded onboardingCompletedAt
    expect(mockUpdateUser).toHaveBeenCalledWith({
      onboardingCompletedAt: '2026-04-27T10:00:00.000Z',
    });

    // router.navigate was called with ['/dashboard']
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('onCtaClick() still navigates to /dashboard even if onboarding_completed_at is absent', async () => {
    const { fetchAuthSession } = require('aws-amplify/auth');
    (fetchAuthSession as jest.Mock).mockImplementation(async (opts?: { forceRefresh?: boolean }) => {
      if (opts?.forceRefresh) {
        return {
          tokens: {
            idToken: { toString: () => 'fresh-token', payload: {} },
            accessToken: { toString: () => 'access' },
          },
        };
      }
      return { tokens: { idToken: { toString: () => 'fake-id-token' } } };
    });
    const router = TestBed.inject(require('@angular/router').Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.onCtaClick('complete');

    // updateUser is NOT called when the claim is absent
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('onCtaClick() sets errorMessage and does NOT navigate when fetchAuthSession rejects', async () => {
    jest.requireMock('aws-amplify/auth').fetchAuthSession.mockRejectedValueOnce(new Error('cognito-down'));
    const router = TestBed.inject(require('@angular/router').Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    await component.onCtaClick('complete');

    expect(component.errorMessage()).toBeTruthy();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ── Renderer output → agent feedback loop ─────────────────────────────────────
//
// Each test verifies that when a renderer emits its user-input output,
// submitUserContent() is called with the correct synthetic message content,
// which in turn appends a user ChatMessage and re-runs the agent.
//
// Strategy: create the renderer component in isolation via TestBed, emit its
// output, and assert the effect on the chat component via a spy on the
// protected submitUserContent method.

describe('OnboardingChatComponent — renderer output wiring', () => {
  let fixture: ComponentFixture<OnboardingChatComponent>;
  let component: OnboardingChatComponent;
  let submitSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockHttpAgent.run.mockReturnValue(EMPTY);
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [
        OnboardingChatComponent,
        OptionsRendererComponent,
        ModeCardsRendererComponent,
        SliderRendererComponent,
        AmountRendererComponent,
        ConsentRendererComponent,
        SummaryRendererComponent,
      ],
      providers: [
        provideRouter([]),
        { provide: COPILOT_API_URL, useValue: 'https://example.cloudfront.net/api/copilotkit' },
        { provide: AuthStore, useValue: { user: () => ({ tenantId: 'tenant-xyz' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Spy on the protected helper — cast through any to access it
    submitSpy = jest.spyOn(component as unknown as { submitUserContent(c: string): void }, 'submitUserContent');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('options renderer: selected output submits the chosen id as user content', () => {
    const rendererFixture = TestBed.createComponent(OptionsRendererComponent);
    rendererFixture.componentRef.setInput('title', 'Scegli');
    rendererFixture.componentRef.setInput('options', [{ id: 'GROWTH', label: 'Crescita' }]);
    rendererFixture.detectChanges();

    // Simulate the wiring: subscribe submitUserContent to the renderer's output
    rendererFixture.componentInstance.selected.subscribe((id: string) =>
      (component as unknown as { submitUserContent(c: string): void }).submitUserContent(id)
    );

    rendererFixture.componentInstance.select('GROWTH');

    expect(submitSpy).toHaveBeenCalledWith('GROWTH');
  });

  it('mode-cards renderer: selected output submits the chosen id as user content', () => {
    const rendererFixture = TestBed.createComponent(ModeCardsRendererComponent);
    rendererFixture.componentRef.setInput('title', 'Modalità');
    rendererFixture.componentRef.setInput('cards', [{ id: 'BALANCED', title: 'Bilanciato', details: [] }]);
    rendererFixture.detectChanges();

    rendererFixture.componentInstance.selected.subscribe((id: string) =>
      (component as unknown as { submitUserContent(c: string): void }).submitUserContent(id)
    );

    rendererFixture.componentInstance.select('BALANCED');

    expect(submitSpy).toHaveBeenCalledWith('BALANCED');
  });

  it('slider renderer: valueChange output submits String(value) as user content', () => {
    const rendererFixture = TestBed.createComponent(SliderRendererComponent);
    rendererFixture.componentRef.setInput('label', 'Orizzonte');
    rendererFixture.componentRef.setInput('min', 1);
    rendererFixture.componentRef.setInput('max', 30);
    rendererFixture.componentRef.setInput('step', 1);
    rendererFixture.detectChanges();

    rendererFixture.componentInstance.valueChange.subscribe((v: number) =>
      (component as unknown as { submitUserContent(c: string): void }).submitUserContent(String(v))
    );

    rendererFixture.componentInstance.currentValue.set(10);
    rendererFixture.componentInstance.valueChange.emit(10);

    expect(submitSpy).toHaveBeenCalledWith('10');
  });

  it('amount renderer: amountChange output submits String(value) as user content', () => {
    const rendererFixture = TestBed.createComponent(AmountRendererComponent);
    rendererFixture.componentRef.setInput('label', 'Investimento iniziale');
    rendererFixture.componentRef.setInput('currency', '€');
    rendererFixture.componentRef.setInput('presets', [1000, 5000, 10000]);
    rendererFixture.detectChanges();

    rendererFixture.componentInstance.amountChange.subscribe((v: number) =>
      (component as unknown as { submitUserContent(c: string): void }).submitUserContent(String(v))
    );

    rendererFixture.componentInstance.selectPreset(5000);

    expect(submitSpy).toHaveBeenCalledWith('5000');
  });

  it('consent renderer: accepted=true submits "Accetto"; accepted=false submits "Rifiuto"', () => {
    const rendererFixture = TestBed.createComponent(ConsentRendererComponent);
    rendererFixture.componentRef.setInput('label', 'Accetta i termini');
    rendererFixture.detectChanges();

    rendererFixture.componentInstance.accepted.subscribe((v: boolean) =>
      (component as unknown as { submitUserContent(c: string): void }).submitUserContent(v ? 'Accetto' : 'Rifiuto')
    );

    rendererFixture.componentInstance.accepted.emit(true);
    expect(submitSpy).toHaveBeenCalledWith('Accetto');

    rendererFixture.componentInstance.accepted.emit(false);
    expect(submitSpy).toHaveBeenCalledWith('Rifiuto');
  });

  it('summary renderer: confirmed output submits "Confermo" as user content', () => {
    const rendererFixture = TestBed.createComponent(SummaryRendererComponent);
    rendererFixture.componentRef.setInput('title', 'Riepilogo');
    rendererFixture.componentRef.setInput('rows', [{ label: 'Obiettivo', value: 'Crescita' }]);
    rendererFixture.detectChanges();

    rendererFixture.componentInstance.confirmed.subscribe(() =>
      (component as unknown as { submitUserContent(c: string): void }).submitUserContent('Confermo')
    );

    rendererFixture.componentInstance.onConfirm();

    expect(submitSpy).toHaveBeenCalledWith('Confermo');
  });
});
