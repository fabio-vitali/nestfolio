import {
  Component,
  ComponentRef,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  Type,
  ViewContainerRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpAgent, EventType } from '@ag-ui/client';
import { Subscription } from 'rxjs';
import { RunAgentInput } from '@ag-ui/core';

import { OptionsRendererComponent } from './renderers/options-renderer.component';
import { ModeCardsRendererComponent } from './renderers/mode-cards-renderer.component';
import { SliderRendererComponent } from './renderers/slider-renderer.component';
import { AmountRendererComponent } from './renderers/amount-renderer.component';
import { SummaryRendererComponent } from './renderers/summary-renderer.component';
import { ConsentRendererComponent } from './renderers/consent-renderer.component';
import { CtaRendererComponent } from './renderers/cta-renderer.component';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

type RendererType =
  | 'render_options'
  | 'render_mode_cards'
  | 'render_slider'
  | 'render_amount'
  | 'render_summary'
  | 'render_consent'
  | 'render_cta';

// ── Tool → Renderer map ───────────────────────────────────────────────────────

const TOOL_RENDERER_MAP: Partial<Record<RendererType, Type<unknown>>> = {
  render_options: OptionsRendererComponent,
  render_mode_cards: ModeCardsRendererComponent,
  render_slider: SliderRendererComponent,
  render_amount: AmountRendererComponent,
  render_summary: SummaryRendererComponent,
  render_consent: ConsentRendererComponent,
  render_cta: CtaRendererComponent,
};

const LOADING_DELAY_MS = 3_000;
const TIMEOUT_MS = 15_000;
const BFF_URL = '/api/copilotkit'; // proxied to onboarding-agent-bff

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-onboarding-chat',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chat-screen">
      <!-- Header -->
      <header class="agent-header">
        <div class="agent-avatar">N</div>
        <div>
          <div class="agent-name">Nestfolio</div>
          <div class="agent-status">{{ connectionStatus() }}</div>
        </div>
      </header>

      <!-- Progress bar -->
      <div class="progress-bar">
        <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        <span class="progress-label">{{ phaseIndex() + 1 }} di {{ totalPhases() }}</span>
      </div>

      <!-- Error banner -->
      @if (errorMessage()) {
        <div class="error-banner" role="alert">
          <span>{{ errorMessage() }}</span>
          <button class="retry-btn" (click)="retry()">Riprova</button>
        </div>
      }

      <!-- Chat area -->
      <div class="chat-area" #chatArea>
        @for (msg of messages(); track msg.id) {
          <div class="chat-bubble" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
            @if (msg.role === 'assistant' && msg.toolName) {
              <!-- Renderer slot — filled dynamically by ViewContainerRef -->
              <div [attr.data-tool-slot]="msg.id" class="renderer-slot"></div>
            } @else {
              <p class="bubble-text">{{ msg.content }}</p>
            }
          </div>
        }

        <!-- Loading indicator (shown after 3s of no response) -->
        @if (showLoading()) {
          <div class="chat-bubble assistant">
            <span class="loading-dots">
              <span></span><span></span><span></span>
            </span>
            <span class="loading-label">Un momento...</span>
          </div>
        }

        <!-- Timeout message -->
        @if (timedOut()) {
          <div class="chat-bubble assistant timeout-msg">
            <p>La risposta sta richiedendo troppo tempo.</p>
            <button class="retry-btn" (click)="retry()">Riprova</button>
          </div>
        }
      </div>

      <!-- User input -->
      <div class="chat-input-row">
        <input
          class="chat-input"
          type="text"
          placeholder="Scrivi un messaggio..."
          [value]="inputValue()"
          (input)="inputValue.set($any($event.target).value)"
          (keydown.enter)="sendMessage()"
          [disabled]="isStreaming()"
        />
        <button
          class="send-btn"
          (click)="sendMessage()"
          [disabled]="isStreaming() || !inputValue().trim()"
        >
          Invia
        </button>
      </div>
    </div>
  `,
  styleUrl: './onboarding-theme.css',
})
export class OnboardingChatComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly vcr = inject(ViewContainerRef);

  // ── State signals ──────────────────────────────────────────────────────────
  phaseIndex = signal(0);
  totalPhases = signal(7);
  progressPercent = computed(() => ((this.phaseIndex() + 1) / this.totalPhases()) * 100);

  messages = signal<ChatMessage[]>([]);
  inputValue = signal('');
  isStreaming = signal(false);
  showLoading = signal(false);
  timedOut = signal(false);
  errorMessage = signal<string | null>(null);
  connectionStatus = signal('Attivo ora');

  // ── Internal state ─────────────────────────────────────────────────────────
  private agent: HttpAgent | null = null;
  private streamSub: Subscription | null = null;
  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private threadId = crypto.randomUUID();
  private pendingToolId: string | null = null;
  private pendingToolName: string | null = null;
  private pendingToolArgs = '';
  private rendererRefs: ComponentRef<unknown>[] = [];

  ngOnInit(): void {
    this.agent = new HttpAgent({ url: BFF_URL });
    this.destroyRef.onDestroy(() => this.cleanup());
    // Kick off with an initial agent turn to get the greeting
    this.runAgent([]);
  }

  sendMessage(): void {
    const text = this.inputValue().trim();
    if (!text || this.isStreaming()) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    this.messages.update((prev) => [...prev, userMsg]);
    this.inputValue.set('');
    this.runAgent(this.messages());
  }

  retry(): void {
    this.errorMessage.set(null);
    this.timedOut.set(false);
    this.runAgent(this.messages());
  }

  // ── AG-UI SSE stream ───────────────────────────────────────────────────────

  private runAgent(history: ChatMessage[]): void {
    if (!this.agent) return;
    this.cleanup();

    this.isStreaming.set(true);
    this.showLoading.set(false);
    this.timedOut.set(false);
    this.errorMessage.set(null);

    // Loading indicator after 3 s
    this.loadingTimer = setTimeout(() => {
      if (this.isStreaming()) this.showLoading.set(true);
    }, LOADING_DELAY_MS);

    // Hard timeout after 15 s
    this.timeoutTimer = setTimeout(() => {
      if (this.isStreaming()) {
        this.isStreaming.set(false);
        this.showLoading.set(false);
        this.timedOut.set(true);
        this.cleanup();
      }
    }, TIMEOUT_MS);

    const input: RunAgentInput = {
      threadId: this.threadId,
      runId: crypto.randomUUID(),
      messages: history.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })) as RunAgentInput['messages'],
      tools: [],
      context: [],
      forwardedProps: {},
      state: {},
    };

    let currentMsgId: string | null = null;

    this.streamSub = this.agent.run(input).subscribe({
      next: (event) => {
        switch (event.type) {
          case EventType.RUN_STARTED:
            this.connectionStatus.set('Risponde...');
            break;

          case EventType.TEXT_MESSAGE_START: {
            currentMsgId = (event as { messageId?: string }).messageId ?? crypto.randomUUID();
            const msg: ChatMessage = { id: currentMsgId, role: 'assistant', content: '' };
            this.messages.update((prev) => [...prev, msg]);
            this.showLoading.set(false);
            break;
          }

          case EventType.TEXT_MESSAGE_CONTENT: {
            const chunk = (event as { delta?: string }).delta ?? '';
            if (currentMsgId) {
              this.messages.update((prev) =>
                prev.map((m) =>
                  m.id === currentMsgId ? { ...m, content: m.content + chunk } : m
                )
              );
            }
            break;
          }

          case EventType.TEXT_MESSAGE_END:
            currentMsgId = null;
            break;

          case EventType.TOOL_CALL_START: {
            const e = event as { toolCallId?: string; toolName?: string };
            this.pendingToolId = e.toolCallId ?? crypto.randomUUID();
            this.pendingToolName = e.toolName ?? null;
            this.pendingToolArgs = '';
            this.showLoading.set(false);
            break;
          }

          case EventType.TOOL_CALL_ARGS: {
            const e = event as { delta?: string };
            this.pendingToolArgs += e.delta ?? '';
            break;
          }

          case EventType.TOOL_CALL_END: {
            if (this.pendingToolName) {
              const toolName = this.pendingToolName as RendererType;
              let toolArgs: Record<string, unknown> = {};
              try {
                toolArgs = JSON.parse(this.pendingToolArgs || '{}') as Record<string, unknown>;
              } catch {
                // ignore parse errors — args may arrive incomplete
              }
              const msgId = this.pendingToolId ?? crypto.randomUUID();
              const msg: ChatMessage = {
                id: msgId,
                role: 'assistant',
                content: '',
                toolName,
                toolArgs,
              };
              this.messages.update((prev) => [...prev, msg]);
              // Render the tool component after the view updates
              setTimeout(() => this.mountRenderer(msgId, toolName, toolArgs), 0);
            }
            this.pendingToolId = null;
            this.pendingToolName = null;
            this.pendingToolArgs = '';
            break;
          }

          case EventType.STATE_SNAPSHOT: {
            const state = (event as { snapshot?: Record<string, unknown> }).snapshot ?? {};
            if (typeof state['phase_index'] === 'number') {
              this.phaseIndex.set(state['phase_index'] as number);
            }
            break;
          }

          case EventType.RUN_FINISHED:
            this.finishStream();
            break;
        }
      },
      error: (err: unknown) => {
        console.error('[OnboardingChat] SSE error:', err);
        this.errorMessage.set('Connessione interrotta. Controlla la tua rete e riprova.');
        this.finishStream();
      },
      complete: () => {
        this.finishStream();
      },
    });
  }

  // ── Renderer mounting ──────────────────────────────────────────────────────

  private mountRenderer(
    msgId: string,
    toolName: RendererType,
    args: Record<string, unknown>
  ): void {
    const rendererType = TOOL_RENDERER_MAP[toolName];
    if (!rendererType) return;

    const slot = document.querySelector(`[data-tool-slot="${msgId}"]`);
    if (!slot) return;

    // Create component and project into the DOM slot
    const ref = this.vcr.createComponent(rendererType as Type<unknown>);
    const inputs = args as Record<string, unknown>;

    // Pass inputs if the component accepts them via setInput
    for (const [key, value] of Object.entries(inputs)) {
      try {
        ref.setInput(key, value);
      } catch {
        // component may not have this input
      }
    }

    slot.appendChild(ref.location.nativeElement);
    this.rendererRefs.push(ref);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private finishStream(): void {
    this.isStreaming.set(false);
    this.showLoading.set(false);
    this.connectionStatus.set('Attivo ora');
    if (this.loadingTimer) clearTimeout(this.loadingTimer);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
  }

  private cleanup(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = null;
    if (this.loadingTimer) { clearTimeout(this.loadingTimer); this.loadingTimer = null; }
    if (this.timeoutTimer) { clearTimeout(this.timeoutTimer); this.timeoutTimer = null; }
    this.rendererRefs.forEach((r) => r.destroy());
    this.rendererRefs = [];
  }
}
