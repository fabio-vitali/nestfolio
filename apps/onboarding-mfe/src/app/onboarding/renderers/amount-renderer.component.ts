import { Component, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-amount-renderer',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="amount-container">
      <label class="amount-label">{{ label() }}</label>
      <div class="amount-presets">
        @for (preset of presets(); track preset) {
          <button class="preset-btn" [class.selected]="customAmount() === preset" (click)="selectPreset(preset)">
            {{ currency() }} {{ preset | number }}
          </button>
        }
      </div>
      <div class="amount-custom">
        <span class="amount-currency">{{ currency() }}</span>
        <input
          type="number"
          class="amount-input"
          data-testid="amount-input"
          [value]="customAmount()"
          (input)="onInput($event)"
          placeholder="Importo personalizzato"
        />
      </div>
    </div>
  `,
  styles: [`
    .amount-container { display: flex; flex-direction: column; gap: 0.75rem; }
    .amount-label { font-weight: 600; }
    .amount-presets { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .preset-btn {
      padding: 0.4rem 0.8rem; border: 2px solid var(--nf-border, #e0e0e0);
      border-radius: 8px; background: var(--nf-bg-card, #fff); cursor: pointer; font-weight: 500;
    }
    .preset-btn:hover { border-color: var(--p-primary-color); }
    .preset-btn.selected { border-color: var(--p-primary-color); background: var(--p-primary-50, #eef); }
    .amount-custom { display: flex; align-items: center; gap: 0.5rem; border: 2px solid var(--nf-border, #e0e0e0); border-radius: 8px; padding: 0.5rem; }
    .amount-currency { font-weight: 600; color: var(--nf-text-secondary); }
    .amount-input { border: none; outline: none; flex: 1; font-size: 1rem; }
  `],
})
export class AmountRendererComponent {
  label = input.required<string>();
  currency = input.required<string>();
  presets = input.required<number[]>();
  amountChange = output<number>();

  customAmount = signal<number | null>(null);

  selectPreset(amount: number): void {
    this.customAmount.set(amount);
    this.amountChange.emit(amount);
  }

  onInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.customAmount.set(value);
    this.amountChange.emit(value);
  }
}
