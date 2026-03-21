import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { I18nService } from '@nestfolio/shell/i18n';
import { CurrencyFormatPipe } from '@nestfolio/ui';
import type { ComparisonDivergence } from '../services/comparison.service';

@Component({
  selector: 'app-comparison-divergence-table',
  standalone: true,
  imports: [CommonModule, TableModule, CurrencyFormatPipe],
  template: `
    <div class="divergence-section">
      <div class="divergence-header">
        <h3 class="divergence-title">{{ i18n.t('dashboard.comparison.divergence') }}</h3>
        @if (divergence) {
          <div class="divergence-stats">
            <span class="stat">
              {{ i18n.t('dashboard.comparison.missedDecisions') }}:
              {{ divergence.missedDecisions }} / {{ divergence.totalDecisions }}
            </span>
            <span
              class="stat"
              [class.positive]="divergence.returnDifferenceCents > 0"
              [class.negative]="divergence.returnDifferenceCents < 0"
            >
              {{ i18n.t('dashboard.comparison.valueDifference') }}:
              {{ divergence.returnDifferenceCents | currencyFormat }}
            </span>
          </div>
        }
      </div>

      <p-table
        [value]="divergence?.positionDifferences ?? []"
        [rows]="20"
        styleClass="p-datatable-sm p-datatable-striped"
        [scrollable]="true"
        scrollHeight="400px"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>{{ i18n.t('dashboard.comparison.symbol') }}</th>
            <th class="text-right">{{ i18n.t('dashboard.comparison.actualQty') }}</th>
            <th class="text-right">{{ i18n.t('dashboard.comparison.simulatedQty') }}</th>
            <th class="text-right">{{ i18n.t('dashboard.comparison.qtyDiff') }}</th>
            <th class="text-right">{{ i18n.t('dashboard.comparison.actualValue') }}</th>
            <th class="text-right">{{ i18n.t('dashboard.comparison.simulatedValue') }}</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-pos>
          <tr>
            <td class="font-semibold">{{ pos.symbol }}</td>
            <td class="text-right">{{ pos.actualQuantity }}</td>
            <td class="text-right">{{ pos.simulatedQuantity }}</td>
            <td
              class="text-right"
              [class.positive]="pos.quantityDifference > 0"
              [class.negative]="pos.quantityDifference < 0"
            >
              {{ pos.quantityDifference > 0 ? '+' : '' }}{{ pos.quantityDifference }}
            </td>
            <td class="text-right">{{ pos.actualValueCents | currencyFormat }}</td>
            <td class="text-right">{{ pos.simulatedValueCents | currencyFormat }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="6" class="text-center">
              {{ i18n.t('dashboard.comparison.noDivergence') }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: [
    `
      .divergence-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .divergence-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .divergence-title {
        font-size: 1rem;
        font-weight: 600;
        margin: 0;
        color: var(--nf-text-primary, #212529);
      }

      .divergence-stats {
        display: flex;
        gap: 1rem;
      }

      .stat {
        font-size: 0.8rem;
        color: var(--nf-text-secondary, #6c757d);
      }

      .stat.positive {
        color: var(--green-500, #22c55e);
      }
      .stat.negative {
        color: var(--red-500, #ef4444);
      }

      .text-right {
        text-align: right;
      }
      .text-center {
        text-align: center;
      }
      .font-semibold {
        font-weight: 600;
      }

      .positive {
        color: var(--green-500, #22c55e);
      }
      .negative {
        color: var(--red-500, #ef4444);
      }
    `,
  ],
})
export class ComparisonDivergenceTableComponent {
  readonly i18n = inject(I18nService);

  @Input() divergence: ComparisonDivergence | null = null;
}
