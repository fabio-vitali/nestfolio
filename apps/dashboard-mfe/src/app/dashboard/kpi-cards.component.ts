import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';
import { CurrencyFormatPipe, PercentFormatPipe } from '@nestfolio/ui-components';
import type { PortfolioSummary, AdvisoryStatus } from '../stores/dashboard.store';

@Component({
  selector: 'app-kpi-cards',
  standalone: true,
  imports: [CommonModule, CardModule, CurrencyFormatPipe, PercentFormatPipe],
  template: `
    <div class="kpi-cards">
      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.totalValue') }}</div>
        <div class="kpi-value">{{ (portfolioSummary?.totalValueCents ?? 0) | currencyFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.cashBalance') }}</div>
        <div class="kpi-value">{{ (portfolioSummary?.cashBalanceCents ?? 0) | currencyFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.unrealizedPnl') }}</div>
        <div class="kpi-value" [class.positive]="totalPnl > 0" [class.negative]="totalPnl < 0">
          {{ totalPnl | currencyFormat }}
        </div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.drift') }}</div>
        <div class="kpi-value">{{ (portfolioSummary?.driftPercent ?? 0) | percentFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.pendingDecisions') }}</div>
        <div class="kpi-value" [class.alert]="(advisoryStatus?.pendingDecisionsCount ?? 0) > 0">
          {{ advisoryStatus?.pendingDecisionsCount ?? 0 }}
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .kpi-cards {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.75rem;
    }

    :host ::ng-deep .kpi-card {
      text-align: center;
    }

    :host ::ng-deep .kpi-card .p-card-body {
      padding: 0.75rem;
    }

    .kpi-label {
      font-size: 0.75rem;
      color: var(--nf-text-secondary, #6c757d);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }

    .kpi-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--nf-text-primary, #212529);
    }

    .kpi-value.positive { color: var(--green-500, #22c55e); }
    .kpi-value.negative { color: var(--red-500, #ef4444); }
    .kpi-value.alert { color: var(--orange-500, #f97316); }

    @media (max-width: 768px) {
      .kpi-cards {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `],
})
export class KpiCardsComponent {
  readonly i18n = inject(I18nService);

  @Input() portfolioSummary: PortfolioSummary | null = null;
  @Input() totalPnl = 0;
  @Input() advisoryStatus: AdvisoryStatus | null = null;
}
