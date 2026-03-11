import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-order-history',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="order-history-placeholder">
      <h2>Order History</h2>
      <p>Coming soon — paginated ledger entries.</p>
    </div>
  `,
  styles: [`
    .order-history-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 50vh;
      color: var(--nf-text-secondary, #6c757d);
    }
  `],
})
export class OrderHistoryComponent {}
