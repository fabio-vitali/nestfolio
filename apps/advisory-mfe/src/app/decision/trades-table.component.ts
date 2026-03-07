import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import type { ProposedAction } from '../stores/advisory.store';

@Component({
  selector: 'app-trades-table',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <table class="trades-table">
      <thead>
        <tr>
          <th>{{ 'advisory.detail.tradeSymbol' | translate }}</th>
          <th>{{ 'advisory.detail.tradeSide' | translate }}</th>
          <th class="text-right">{{ 'advisory.detail.tradeQty' | translate }}</th>
          <th>{{ 'advisory.detail.tradeType' | translate }}</th>
        </tr>
      </thead>
      <tbody>
        @for (trade of trades(); track trade.symbol) {
          <tr>
            <td class="symbol-cell">{{ trade.symbol }}</td>
            <td>
              <span class="side-tag" [class.side-buy]="trade.side === 'BUY'" [class.side-sell]="trade.side === 'SELL'">
                {{ trade.side }}
              </span>
            </td>
            <td class="text-right">{{ trade.quantity }}</td>
            <td>{{ trade.actionType }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: [`
    .trades-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }

    .trades-table th {
      text-align: left;
      padding: 0.375rem 0.5rem;
      font-weight: 600;
      color: var(--p-surface-500);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      border-bottom: 1px solid var(--p-surface-200);
    }

    .trades-table td {
      padding: 0.5rem;
      border-bottom: 1px solid var(--p-surface-100);
    }

    .trades-table tr:last-child td { border-bottom: none; }

    .symbol-cell { font-weight: 600; }

    .text-right { text-align: right; }

    .side-tag {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .side-buy {
      background: var(--p-green-100);
      color: var(--p-green-700);
    }

    .side-sell {
      background: var(--p-red-100);
      color: var(--p-red-700);
    }
  `],
})
export class TradesTableComponent {
  trades = input.required<ProposedAction[]>();
}
