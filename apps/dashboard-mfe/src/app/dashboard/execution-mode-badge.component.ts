import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '@nestfolio/shell/i18n';

export type ExecutionMode = 'simulation' | 'live' | string | null;

@Component({
  selector: 'app-execution-mode-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (executionMode) {
      <span
        class="mode-badge"
        [class.mode-badge--live]="isLive"
        [class.mode-badge--sim]="!isLive"
        [attr.aria-label]="i18n.t(isLive ? 'dashboard.badge.live' : 'dashboard.badge.sim')"
        data-testid="execution-mode-badge"
        [attr.data-testid-state]="isLive ? 'execution-mode-live' : 'execution-mode-sim'"
      >
        @if (isLive) {
          <span class="mode-dot mode-dot--live"></span>
        }
        {{ isLive ? i18n.t('dashboard.badge.live') : i18n.t('dashboard.badge.sim') }}
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    .mode-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.625rem;
      border-radius: 9999px;
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1;
    }

    .mode-badge--live {
      background: var(--green-100, #dcfce7);
      color: var(--green-700, #15803d);
      border: 1px solid var(--green-200, #bbf7d0);
    }

    .mode-badge--sim {
      background: var(--p-surface-100, #f3f4f6);
      color: var(--nf-text-secondary, #6c757d);
      border: 1px solid var(--p-surface-200, #e5e7eb);
    }

    .mode-dot {
      width: 0.4375rem;
      height: 0.4375rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .mode-dot--live {
      background: var(--green-500, #22c55e);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `],
})
export class ExecutionModeBadgeComponent {
  readonly i18n = inject(I18nService);

  @Input() executionMode: ExecutionMode = null;

  get isLive(): boolean {
    return this.executionMode === 'live';
  }
}
