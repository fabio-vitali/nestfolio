import { Component, Input, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TooltipModule } from 'primeng/tooltip';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { CurrencyFormatPipe, PercentFormatPipe } from '@nestfolio/ui';
import type { PortfolioSummary, AdvisoryStatus } from '../stores/dashboard.store';

const DEPOSIT_FLAG = 'initiateDeposit';

@Component({
  selector: 'app-kpi-cards',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TooltipModule, CurrencyFormatPipe, PercentFormatPipe],
  template: `
    <div class="kpi-cards">
      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.totalValue') }}</div>
        <div class="kpi-value" [attr.aria-label]="i18n.t('dashboard.overview.totalValue') + ': ' + ((portfolioSummary?.totalValueCents ?? 0) | currencyFormat)">{{ (portfolioSummary?.totalValueCents ?? 0) | currencyFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.cashBalance') }}</div>
        <div class="kpi-value" [attr.aria-label]="i18n.t('dashboard.overview.cashBalance') + ': ' + ((portfolioSummary?.cashBalanceCents ?? 0) | currencyFormat)">{{ (portfolioSummary?.cashBalanceCents ?? 0) | currencyFormat }}</div>
        <p-button
          label="Deposit"
          size="small"
          [outlined]="true"
          data-testid="cta-deposit"
          [disabled]="depositDisabled()"
          [pTooltip]="depositDisabled() ? (depositReason() || 'Deposits paused — the brokerage circuit is open.') : null"
          (onClick)="goDeposit()" />
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.unrealizedPnl') }}</div>
        <div class="kpi-value" [class.positive]="totalPnl > 0" [class.negative]="totalPnl < 0" [attr.aria-label]="i18n.t('dashboard.overview.unrealizedPnl') + ': ' + (totalPnl | currencyFormat)">
          {{ totalPnl | currencyFormat }}
        </div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.drift') }}</div>
        <div class="kpi-value" [attr.aria-label]="i18n.t('dashboard.overview.drift') + ': ' + ((portfolioSummary?.driftPercent ?? 0) | percentFormat)">{{ (portfolioSummary?.driftPercent ?? 0) | percentFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.pendingDecisions') }}</div>
        <div class="kpi-value" [class.alert]="(advisoryStatus?.pendingDecisionsCount ?? 0) > 0" [attr.aria-label]="i18n.t('dashboard.overview.pendingDecisions') + ': ' + (advisoryStatus?.pendingDecisionsCount ?? 0)">
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

    :host ::ng-deep .kpi-card { text-align: center; }
    :host ::ng-deep .kpi-card .p-card-body { padding: 0.75rem; }

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
      .kpi-cards { grid-template-columns: repeat(2, 1fr); }
    }
  `],
})
export class KpiCardsComponent {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly flagsStore = inject(FeatureFlagsStore);

  @Input() portfolioSummary: PortfolioSummary | null = null;
  @Input() totalPnl = 0;
  @Input() advisoryStatus: AdvisoryStatus | null = null;

  readonly depositDisabled = computed(() => !this.flagsStore.isEnabled(DEPOSIT_FLAG));
  readonly depositReason = computed(() => this.flagsStore.flags()[DEPOSIT_FLAG]?.reason ?? null);

  goDeposit(): void {
    this.router.navigate(['/investor/deposit']);
  }
}
