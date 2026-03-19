import { Component, input, output } from '@angular/core';

interface OptionItem {
  id: string;
  emoji?: string;
  label: string;
  description?: string;
}

@Component({
  selector: 'app-options-renderer',
  standalone: true,
  template: `
    <div class="options-container">
      <h3 class="options-title">{{ title() }}</h3>
      <div class="options-grid">
        @for (opt of options(); track opt.id) {
          <button class="option-card" [class.selected]="selectedId === opt.id" (click)="select(opt.id)">
            @if (opt.emoji) { <span class="option-emoji">{{ opt.emoji }}</span> }
            <span class="option-label">{{ opt.label }}</span>
            @if (opt.description) { <span class="option-desc">{{ opt.description }}</span> }
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .options-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
    .option-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
      padding: 1rem; border: 2px solid var(--nf-border, #e0e0e0); border-radius: 12px;
      background: var(--nf-bg-card, #fff); cursor: pointer; transition: all 0.2s;
    }
    .option-card:hover { border-color: var(--p-primary-color); }
    .option-card.selected { border-color: var(--p-primary-color); background: var(--p-primary-50, #eef); }
    .option-emoji { font-size: 1.5rem; }
    .option-label { font-weight: 600; text-align: center; }
    .option-desc { font-size: 0.85rem; color: var(--nf-text-secondary); text-align: center; }
    .options-title { margin: 0 0 1rem; font-size: 1rem; }
  `],
})
export class OptionsRendererComponent {
  title = input.required<string>();
  options = input.required<OptionItem[]>();
  selected = output<string>();

  selectedId: string | null = null;

  select(id: string): void {
    this.selectedId = id;
    this.selected.emit(id);
  }
}
