import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';

@Component({
  selector: 'app-allocation-chart',
  standalone: true,
  imports: [CommonModule, CardModule],
  template: `
    <p-card [header]="i18n.t('portfolio.allocation')" styleClass="allocation-card">
      @if (allocationEntries.length === 0) {
        <div class="no-data">{{ i18n.t('common.noData') }}</div>
      } @else {
        <div class="allocation-bars">
          @for (entry of allocationEntries; track entry.label) {
            <div class="allocation-row">
              <div class="allocation-label">{{ entry.label }}</div>
              <div class="allocation-bar-container">
                <div
                  class="allocation-bar-fill"
                  [style.width.%]="entry.percent"
                  [style.background]="entry.color"
                ></div>
              </div>
              <div class="allocation-pct">{{ entry.percent | number:'1.1-1' }}%</div>
            </div>
          }
        </div>
      }
    </p-card>
  `,
  styles: [`
    .no-data {
      text-align: center;
      color: var(--nf-text-secondary, #6c757d);
      padding: 1rem 0;
    }

    .allocation-bars {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .allocation-row {
      display: grid;
      grid-template-columns: 80px 1fr 50px;
      align-items: center;
      gap: 0.5rem;
    }

    .allocation-label {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--nf-text-primary, #212529);
    }

    .allocation-bar-container {
      height: 12px;
      background: var(--nf-bg-secondary, #e9ecef);
      border-radius: 6px;
      overflow: hidden;
    }

    .allocation-bar-fill {
      height: 100%;
      border-radius: 6px;
      transition: width 0.3s ease;
    }

    .allocation-pct {
      font-size: 0.8rem;
      text-align: right;
      color: var(--nf-text-secondary, #6c757d);
    }
  `],
})
export class AllocationChartComponent {
  readonly i18n = inject(I18nService);

  @Input() set allocation(value: Record<string, number>) {
    this.allocationEntries = this.buildEntries(value);
  }
  allocationEntries: Array<{ label: string; percent: number; color: string }> = [];

  private readonly COLORS: Record<string, string> = {
    EQUITY: '#3b82f6',
    BOND: '#10b981',
    CASH: '#f59e0b',
    COMMODITY: '#8b5cf6',
    REAL_ESTATE: '#ec4899',
    OTHER: '#6b7280',
  };

  private buildEntries(allocation: Record<string, number>): Array<{ label: string; percent: number; color: string }> {
    return Object.entries(allocation)
      .sort(([, a], [, b]) => b - a)
      .map(([label, percent]) => ({
        label,
        percent,
        color: this.COLORS[label] ?? this.COLORS['OTHER'],
      }));
  }
}
