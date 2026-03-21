import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { I18nService } from '@nestfolio/shell/i18n';
import { CurrencyFormatPipe, EmptyStateComponent } from '@nestfolio/ui';
import type { PositionSnapshot } from '../stores/dashboard.store';

@Component({
  selector: 'app-positions-table',
  standalone: true,
  imports: [CommonModule, TableModule, CurrencyFormatPipe, EmptyStateComponent],
  template: `
    @if (positions.length === 0) {
      <nf-empty-state
        [title]="i18n.t('dashboard.positions.noPositions')"
        icon="pi pi-chart-bar"
      />
    } @else {
      <p-table
        [value]="positions"
        [scrollable]="true"
        scrollHeight="flex"
        [sortField]="'marketValueCents'"
        [sortOrder]="-1"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="symbol" aria-sort="none">{{ i18n.t('dashboard.positions.symbol') }} <p-sortIcon field="symbol" /></th>
            <th pSortableColumn="assetClass" aria-sort="none">{{ i18n.t('dashboard.positions.assetClass') }} <p-sortIcon field="assetClass" /></th>
            <th pSortableColumn="quantity" class="text-right" aria-sort="none">{{ i18n.t('dashboard.positions.quantity') }} <p-sortIcon field="quantity" /></th>
            <th pSortableColumn="avgCostBasisCents" class="text-right" aria-sort="none">{{ i18n.t('dashboard.positions.avgCost') }} <p-sortIcon field="avgCostBasisCents" /></th>
            <th pSortableColumn="currentPriceCents" class="text-right" aria-sort="none">{{ i18n.t('dashboard.positions.currentPrice') }} <p-sortIcon field="currentPriceCents" /></th>
            <th pSortableColumn="marketValueCents" class="text-right" aria-sort="none">{{ i18n.t('dashboard.positions.marketValue') }} <p-sortIcon field="marketValueCents" /></th>
            <th pSortableColumn="weightPercent" class="text-right" aria-sort="none">{{ i18n.t('dashboard.positions.weight') }} <p-sortIcon field="weightPercent" /></th>
            <th pSortableColumn="unrealizedPnlCents" class="text-right" aria-sort="none">{{ i18n.t('dashboard.positions.pnl') }} <p-sortIcon field="unrealizedPnlCents" /></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-position>
          <tr>
            <td><strong>{{ position.symbol }}</strong></td>
            <td>{{ position.assetClass }}</td>
            <td class="text-right">{{ position.quantity }}</td>
            <td class="text-right">{{ position.avgCostBasisCents | currencyFormat }}</td>
            <td class="text-right">{{ position.currentPriceCents | currencyFormat }}</td>
            <td class="text-right">{{ position.marketValueCents | currencyFormat }}</td>
            <td class="text-right">{{ position.weightPercent | number:'1.1-1' }}%</td>
            <td class="text-right" [class.positive]="position.unrealizedPnlCents > 0" [class.negative]="position.unrealizedPnlCents < 0">
              {{ position.unrealizedPnlCents | currencyFormat }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .text-right { text-align: right; }
    .positive { color: var(--green-500, #22c55e); }
    .negative { color: var(--red-500, #ef4444); }
  `],
})
export class PositionsTableComponent {
  readonly i18n = inject(I18nService);
  @Input() positions: PositionSnapshot[] = [];
}
