import { Component, input, output } from '@angular/core';

interface ModeCard {
  id: string;
  title: string;
  badge?: string;
  details: string[];
}

@Component({
  selector: 'app-mode-cards-renderer',
  standalone: true,
  template: `
    <div class="mode-cards-container">
      <h3 class="mode-cards-title">{{ title() }}</h3>
      <div class="mode-cards-grid">
        @for (card of cards(); track card.id) {
          <button class="mode-card" [attr.data-testid]="'mode-' + card.id" [class.selected]="selectedId === card.id" (click)="select(card.id)">
            <div class="mode-card-header">
              <span class="mode-card-title">{{ card.title }}</span>
              @if (card.badge) { <span class="mode-badge">{{ card.badge }}</span> }
            </div>
            <ul class="mode-details">
              @for (detail of card.details; track detail) {
                <li>{{ detail }}</li>
              }
            </ul>
          </button>
        }
      </div>
    </div>
  `,
  styles: [`
    .mode-cards-container { display: flex; flex-direction: column; gap: 1rem; }
    .mode-cards-title { margin: 0 0 0.5rem; font-size: 1rem; }
    .mode-cards-grid { display: flex; flex-direction: column; gap: 0.75rem; }
    .mode-card {
      display: flex; flex-direction: column; gap: 0.5rem; text-align: left;
      padding: 1rem; border: 2px solid var(--nf-border, #e0e0e0); border-radius: 12px;
      background: var(--nf-bg-card, #fff); cursor: pointer; transition: all 0.2s;
    }
    .mode-card:hover { border-color: var(--p-primary-color); }
    .mode-card.selected { border-color: var(--p-primary-color); background: var(--p-primary-50, #eef); }
    .mode-card-header { display: flex; justify-content: space-between; align-items: center; }
    .mode-card-title { font-weight: 700; font-size: 1rem; }
    .mode-badge {
      font-size: 0.7rem; font-weight: 600; padding: 0.15rem 0.5rem;
      background: var(--p-primary-color); color: white; border-radius: 99px;
    }
    .mode-details { margin: 0; padding-left: 1.2rem; font-size: 0.85rem; color: var(--nf-text-secondary); }
    .mode-details li { margin-bottom: 0.2rem; }
  `],
})
export class ModeCardsRendererComponent {
  title = input.required<string>();
  cards = input.required<ModeCard[]>();
  selected = output<string>();

  selectedId: string | null = null;

  select(id: string): void {
    this.selectedId = id;
    this.selected.emit(id);
  }
}
