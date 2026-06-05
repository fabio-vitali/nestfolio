import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '@nestfolio/shell/i18n';

@Component({
  selector: 'app-advisory-cycle-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (generating) {
      <div class="cycle-banner generating" data-testid="dashboard-advisory-generating">
        <span class="pi pi-spin pi-spinner"></span>
        <span class="cycle-text">{{ i18n.t('dashboard.advisory.generatingTitle') }}</span>
      </div>
    } @else if (failed) {
      <div class="cycle-banner failed" data-testid="dashboard-advisory-failed">
        <span class="pi pi-exclamation-triangle"></span>
        <span class="cycle-text">
          {{ i18n.t('dashboard.advisory.failedTitle') }} — {{ i18n.t('dashboard.advisory.failedHint') }}
        </span>
      </div>
    }
  `,
  styles: [`
    .cycle-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .cycle-banner.generating {
      background: var(--p-surface-50, #f8f9fa);
      border: 1px dashed var(--p-primary-300, #93c5fd);
      color: var(--p-surface-700, #374151);
    }
    .cycle-banner.generating .pi-spinner { color: var(--p-primary-500, #3b82f6); }
    .cycle-banner.failed {
      background: var(--orange-50, #fff7ed);
      border: 1px solid var(--orange-200, #fed7aa);
      color: var(--nf-text-primary, #212529);
    }
    .cycle-banner.failed .pi-exclamation-triangle { color: var(--orange-500, #f97316); }
  `],
})
export class AdvisoryCycleStatusComponent {
  readonly i18n = inject(I18nService);
  @Input() generating = false;
  @Input() failed = false;
}
