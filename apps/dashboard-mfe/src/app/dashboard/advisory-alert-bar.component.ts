import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { I18nService } from '@nestfolio/shell/i18n';
import type { AdvisoryStatus } from '../stores/dashboard.store';

@Component({
  selector: 'app-advisory-alert-bar',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule],
  template: `
    <div class="alert-bar" data-testid="advisory-alert-bar">
      <div class="alert-content">
        <span class="pi pi-exclamation-triangle alert-icon"></span>
        <span class="alert-text">
          {{ i18n.t('advisory.pendingDecisions') }}: {{ advisoryStatus?.pendingDecisionsCount ?? 0 }}
        </span>
      </div>
      <p-button
        [label]="i18n.t('dashboard.advisory.viewAll')"
        [routerLink]="['/advisory']"
        icon="pi pi-arrow-right"
        iconPos="right"
        [text]="true"
        size="small"
      />
    </div>
  `,
  styles: [`
    .alert-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 1rem;
      background: var(--orange-50, #fff7ed);
      border: 1px solid var(--orange-200, #fed7aa);
      border-radius: 0.5rem;
    }

    .alert-content {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .alert-icon {
      color: var(--orange-500, #f97316);
    }

    .alert-text {
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--nf-text-primary, #212529);
    }
  `],
})
export class AdvisoryAlertBarComponent {
  readonly i18n = inject(I18nService);
  @Input() advisoryStatus: AdvisoryStatus | null = null;
}
