import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { I18nService } from '@nestfolio/i18n';
import { PercentFormatPipe } from '@nestfolio/ui-components';
import type { SimulationSummary } from '../stores/dashboard.store';

@Component({
  selector: 'app-comparison-card',
  standalone: true,
  imports: [CommonModule, RouterModule, CardModule, ButtonModule, PercentFormatPipe],
  template: `
    <p-card styleClass="comparison-card">
      <div class="comparison-header">
        <span class="pi pi-chart-line comparison-icon"></span>
        <span class="comparison-title">{{ i18n.t('dashboard.comparison.title') }}</span>
      </div>

      <div class="comparison-body">
        <div class="return-item">
          <span class="return-label">{{ i18n.t('dashboard.comparison.yourPortfolio') }}</span>
          <span
            class="return-value"
            [class.positive]="(summary?.actualReturnPercent ?? 0) > 0"
            [class.negative]="(summary?.actualReturnPercent ?? 0) < 0"
          >
            {{ (summary?.actualReturnPercent ?? 0) > 0 ? '+' : ''
            }}{{ summary?.actualReturnPercent ?? 0 | percentFormat }}
          </span>
        </div>

        <div class="return-divider"></div>

        <div class="return-item">
          <span class="return-label">{{ i18n.t('dashboard.comparison.agentAdvice') }}</span>
          <span
            class="return-value"
            [class.positive]="(summary?.simulatedReturnPercent ?? 0) > 0"
            [class.negative]="(summary?.simulatedReturnPercent ?? 0) < 0"
          >
            {{ (summary?.simulatedReturnPercent ?? 0) > 0 ? '+' : ''
            }}{{ summary?.simulatedReturnPercent ?? 0 | percentFormat }}
          </span>
        </div>
      </div>

      <div class="comparison-footer">
        <span
          class="diff-label"
          [class.positive]="(summary?.returnDifferencePercent ?? 0) > 0"
          [class.negative]="(summary?.returnDifferencePercent ?? 0) < 0"
        >
          {{ i18n.t('dashboard.comparison.difference') }}:
          {{ (summary?.returnDifferencePercent ?? 0) > 0 ? '+' : ''
          }}{{ summary?.returnDifferencePercent ?? 0 | percentFormat }}
        </span>
        <p-button
          [label]="i18n.t('dashboard.comparison.viewDetails')"
          [routerLink]="['comparison']"
          icon="pi pi-arrow-right"
          iconPos="right"
          [text]="true"
          size="small"
        />
      </div>
    </p-card>
  `,
  styles: [
    `
      :host ::ng-deep .comparison-card .p-card-body {
        padding: 0.75rem;
      }

      .comparison-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }

      .comparison-icon {
        color: var(--primary-500, #6366f1);
        font-size: 1rem;
      }

      .comparison-title {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--nf-text-secondary, #6c757d);
      }

      .comparison-body {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 0.75rem;
      }

      .return-item {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        flex: 1;
      }

      .return-label {
        font-size: 0.75rem;
        color: var(--nf-text-secondary, #6c757d);
      }

      .return-value {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--nf-text-primary, #212529);
      }

      .return-value.positive {
        color: var(--green-500, #22c55e);
      }
      .return-value.negative {
        color: var(--red-500, #ef4444);
      }

      .return-divider {
        width: 1px;
        height: 2rem;
        background: var(--surface-200, #e5e7eb);
      }

      .comparison-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid var(--surface-200, #e5e7eb);
        padding-top: 0.5rem;
      }

      .diff-label {
        font-size: 0.8rem;
        font-weight: 500;
      }

      .diff-label.positive {
        color: var(--green-500, #22c55e);
      }
      .diff-label.negative {
        color: var(--red-500, #ef4444);
      }
    `,
  ],
})
export class ComparisonCardComponent {
  readonly i18n = inject(I18nService);

  @Input() summary: SimulationSummary | null = null;
}
