import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/shell/i18n';
import { CurrencyFormatPipe, PercentFormatPipe } from '@nestfolio/ui';
import type { PortfolioReturnSummary } from '../services/comparison.service';

@Component({
  selector: 'app-comparison-detail',
  standalone: true,
  imports: [CommonModule, CardModule, CurrencyFormatPipe, PercentFormatPipe],
  template: `
    <div class="comparison-columns">
      <p-card styleClass="stream-card actual-card">
        <div class="stream-header">
          <span class="stream-badge actual">{{ i18n.t('dashboard.comparison.actual') }}</span>
        </div>
        <div class="stream-metrics">
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.totalValue') }}</span>
            <span class="metric-value">{{ (actual?.totalValueCents ?? 0) | currencyFormat }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.cashBalance') }}</span>
            <span class="metric-value">{{ (actual?.cashBalanceCents ?? 0) | currencyFormat }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.positions') }}</span>
            <span class="metric-value">{{ actual?.positionCount ?? 0 }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.totalReturn') }}</span>
            <span class="metric-value" [class.positive]="(actual?.totalReturnPercent ?? 0) > 0" [class.negative]="(actual?.totalReturnPercent ?? 0) < 0">
              {{ (actual?.totalReturnPercent ?? 0) > 0 ? '+' : '' }}{{ (actual?.totalReturnPercent ?? 0) | percentFormat }}
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.returnCents') }}</span>
            <span class="metric-value" [class.positive]="(actual?.totalReturnCents ?? 0) > 0" [class.negative]="(actual?.totalReturnCents ?? 0) < 0">
              {{ (actual?.totalReturnCents ?? 0) | currencyFormat }}
            </span>
          </div>
        </div>
      </p-card>

      <p-card styleClass="stream-card simulated-card">
        <div class="stream-header">
          <span class="stream-badge simulated">{{ i18n.t('dashboard.comparison.simulated') }}</span>
        </div>
        <div class="stream-metrics">
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.totalValue') }}</span>
            <span class="metric-value">{{ (simulated?.totalValueCents ?? 0) | currencyFormat }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.cashBalance') }}</span>
            <span class="metric-value">{{ (simulated?.cashBalanceCents ?? 0) | currencyFormat }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.positions') }}</span>
            <span class="metric-value">{{ simulated?.positionCount ?? 0 }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.totalReturn') }}</span>
            <span class="metric-value" [class.positive]="(simulated?.totalReturnPercent ?? 0) > 0" [class.negative]="(simulated?.totalReturnPercent ?? 0) < 0">
              {{ (simulated?.totalReturnPercent ?? 0) > 0 ? '+' : '' }}{{ (simulated?.totalReturnPercent ?? 0) | percentFormat }}
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">{{ i18n.t('dashboard.comparison.returnCents') }}</span>
            <span class="metric-value" [class.positive]="(simulated?.totalReturnCents ?? 0) > 0" [class.negative]="(simulated?.totalReturnCents ?? 0) < 0">
              {{ (simulated?.totalReturnCents ?? 0) | currencyFormat }}
            </span>
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .comparison-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .stream-header {
      margin-bottom: 0.75rem;
    }

    .stream-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stream-badge.actual {
      background: var(--blue-50, #eff6ff);
      color: var(--blue-700, #1d4ed8);
    }

    .stream-badge.simulated {
      background: var(--purple-50, #faf5ff);
      color: var(--purple-700, #7c3aed);
    }

    .stream-metrics {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .metric {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }

    .metric-label {
      font-size: 0.8rem;
      color: var(--nf-text-secondary, #6c757d);
    }

    .metric-value {
      font-size: 1rem;
      font-weight: 600;
      color: var(--nf-text-primary, #212529);
    }

    .metric-value.positive { color: var(--green-500, #22c55e); }
    .metric-value.negative { color: var(--red-500, #ef4444); }

    @media (max-width: 768px) {
      .comparison-columns {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class ComparisonDetailComponent {
  readonly i18n = inject(I18nService);

  @Input() actual: PortfolioReturnSummary | null = null;
  @Input() simulated: PortfolioReturnSummary | null = null;
}
