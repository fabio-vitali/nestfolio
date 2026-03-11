import { Component, Input } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { TableModule } from 'primeng/table';
import { I18nService } from '@nestfolio/i18n';
import type { LedgerPosition } from '../stores/time-travel.store';

@Component({
  selector: 'app-time-travel-portfolio',
  standalone: true,
  imports: [CommonModule, TableModule, DecimalPipe],
  template: `
    <div class="time-travel-portfolio">
      <div class="portfolio-header">
        <h3>{{ i18n.t('dashboard.timeTravel.historicalPositions') }}</h3>
        <div class="portfolio-stats">
          <span class="stat">
            {{ i18n.t('dashboard.timeTravel.totalValue') }}:
            {{ i18n.formatCurrency(totalValueCents / 100) }}
          </span>
          <span class="stat">
            {{ i18n.t('dashboard.timeTravel.cash') }}:
            {{ i18n.formatCurrency(cashBalanceCents / 100) }}
          </span>
        </div>
      </div>

      @if (positions.length === 0) {
        <div class="empty-state">
          {{ i18n.t('dashboard.timeTravel.noPositions') }}
        </div>
      } @else {
        <p-table [value]="positions" [scrollable]="true" scrollHeight="400px" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ i18n.t('dashboard.positions.symbol') }}</th>
              <th class="text-right">{{ i18n.t('dashboard.positions.quantity') }}</th>
              <th class="text-right">{{ i18n.t('dashboard.positions.avgCost') }}</th>
              <th class="text-right">{{ i18n.t('dashboard.timeTravel.lastPrice') }}</th>
              <th class="text-right">{{ i18n.t('dashboard.positions.marketValue') }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-pos>
            <tr>
              <td class="font-semibold">{{ pos.symbol }}</td>
              <td class="text-right">{{ pos.quantity | number:'1.0-2' }}</td>
              <td class="text-right">{{ i18n.formatCurrency(pos.averageCostBasis) }}</td>
              <td class="text-right">{{ i18n.formatCurrency(pos.lastFillPrice) }}</td>
              <td class="text-right">{{ i18n.formatCurrency(pos.quantity * pos.lastFillPrice) }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
  `,
  styles: [`
    .time-travel-portfolio {
      background: var(--surface-card, #ffffff);
      border-radius: 8px;
      border: 1px solid var(--surface-border, #dee2e6);
      padding: 1rem;
    }

    .portfolio-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .portfolio-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .portfolio-stats {
      display: flex;
      gap: 1.5rem;
    }

    .stat {
      font-size: 0.875rem;
      color: var(--text-color-secondary, #6c757d);
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-color-secondary, #6c757d);
    }

    .text-right {
      text-align: right;
    }

    .font-semibold {
      font-weight: 600;
    }

    @media (max-width: 768px) {
      .portfolio-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
      }

      .portfolio-stats {
        flex-direction: column;
        gap: 0.25rem;
      }
    }
  `],
})
export class TimeTravelPortfolioComponent {
  @Input() positions: LedgerPosition[] = [];
  @Input() totalValueCents = 0;
  @Input() cashBalanceCents = 0;

  constructor(readonly i18n: I18nService) {}
}
