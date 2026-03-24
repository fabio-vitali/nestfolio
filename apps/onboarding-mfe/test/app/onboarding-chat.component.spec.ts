import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingChatComponent } from '../../src/app/onboarding/onboarding-chat.component';
import { provideRouter } from '@angular/router';
import { EMPTY, Subject } from 'rxjs';

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

describe('OnboardingChatComponent', () => {
  let fixture: ComponentFixture<OnboardingChatComponent>;
  let component: OnboardingChatComponent;

  beforeEach(async () => {
    mockHttpAgent.run.mockReturnValue(EMPTY);

    await TestBed.configureTestingModule({
      imports: [OnboardingChatComponent],
      providers: [provideRouter([])],
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
});
