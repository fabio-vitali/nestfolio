import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'nf-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="nf-empty-state">
      <i [class]="icon()" class="nf-empty-state-icon"></i>
      <h3 class="nf-empty-state-title">{{ title() }}</h3>
      @if (message()) {
        <p class="nf-empty-state-message">{{ message() }}</p>
      }
      <div class="nf-empty-state-actions">
        <ng-content />
      </div>
    </div>
  `,
  styles: [`
    .nf-empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      text-align: center;
    }
    .nf-empty-state-icon {
      font-size: 3rem;
      color: var(--p-surface-400);
      margin-bottom: 1rem;
    }
    .nf-empty-state-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--p-text-color);
      margin: 0 0 0.5rem;
    }
    .nf-empty-state-message {
      font-size: 0.875rem;
      color: var(--p-text-muted-color);
      margin: 0 0 1.5rem;
      max-width: 24rem;
    }
    .nf-empty-state-actions {
      display: flex;
      gap: 0.5rem;
    }
  `],
})
export class EmptyStateComponent {
  icon = input('pi pi-inbox');
  title = input.required<string>();
  message = input<string>();
}
