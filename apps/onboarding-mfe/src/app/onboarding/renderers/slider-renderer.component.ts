import { Component, input, output, signal } from '@angular/core';

@Component({
  selector: 'app-slider-renderer',
  standalone: true,
  template: `
    <div class="slider-container">
      <label class="slider-label">
        {{ label() }}
        <span class="slider-value">{{ currentValue() }}{{ unit() ? ' ' + unit() : '' }}</span>
      </label>
      <input
        type="range"
        class="slider-input"
        data-testid="slider-input"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [value]="currentValue()"
        (input)="onChange($event)"
      />
      <div class="slider-range">
        <span>{{ min() }}{{ unit() ? ' ' + unit() : '' }}</span>
        <span>{{ max() }}{{ unit() ? ' ' + unit() : '' }}</span>
      </div>
    </div>
  `,
  styles: [`
    .slider-container { display: flex; flex-direction: column; gap: 0.5rem; }
    .slider-label { display: flex; justify-content: space-between; font-weight: 600; }
    .slider-value { color: var(--p-primary-color); }
    .slider-input { width: 100%; accent-color: var(--p-primary-color); }
    .slider-range { display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--nf-text-secondary); }
  `],
})
export class SliderRendererComponent {
  label = input.required<string>();
  min = input.required<number>();
  max = input.required<number>();
  step = input.required<number>();
  unit = input<string>('');
  valueChange = output<number>();

  currentValue = signal<number>(0);

  onChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.currentValue.set(value);
    this.valueChange.emit(value);
  }
}
