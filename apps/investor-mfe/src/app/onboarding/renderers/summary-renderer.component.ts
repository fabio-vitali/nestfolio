import { Component, input } from '@angular/core';

interface SummaryRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-summary-renderer',
  standalone: true,
  template: `
    <div class="summary-container">
      <h3 class="summary-title">{{ title() }}</h3>
      <div class="summary-rows">
        @for (row of rows(); track row.label) {
          <div class="summary-row">
            <span class="summary-label">{{ row.label }}</span>
            <span class="summary-value">{{ row.value }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .summary-container { display: flex; flex-direction: column; gap: 0.5rem; }
    .summary-title { margin: 0 0 0.75rem; font-size: 1rem; }
    .summary-rows { display: flex; flex-direction: column; gap: 0.5rem; }
    .summary-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0.8rem; border-radius: 8px; background: var(--nf-bg-subtle, #f8f8f8);
    }
    .summary-label { color: var(--nf-text-secondary); font-size: 0.9rem; }
    .summary-value { font-weight: 600; }
  `],
})
export class SummaryRendererComponent {
  title = input.required<string>();
  rows = input.required<SummaryRow[]>();
}
