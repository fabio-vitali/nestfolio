import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '@nestfolio/shell/i18n';
import { EmptyStateComponent } from '@nestfolio/ui';

@Component({
  selector: 'app-advisory-placeholder',
  standalone: true,
  imports: [CommonModule, EmptyStateComponent],
  template: `
    <nf-empty-state
      icon="pi pi-chart-line"
      [title]="i18n.t('advisory.selectDecision')"
      [message]="i18n.t('advisory.selectDecisionHint')"
    />
  `,
})
export class AdvisoryPlaceholderComponent {
  readonly i18n = inject(I18nService);
}
