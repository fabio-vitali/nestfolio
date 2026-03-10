import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'nf-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="nf-header">
      @if (showMenuToggle()) {
        <button class="menu-toggle" (click)="menuToggle.emit()" aria-label="Toggle menu">
          <i class="pi pi-bars"></i>
        </button>
      }
      <span class="nf-header-title">{{ title() }}</span>
      <div class="nf-header-actions">
        <ng-content />
      </div>
    </header>
  `,
  styles: [`
    .nf-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--p-surface-0);
      border-bottom: 1px solid var(--p-surface-200);
      z-index: 10;
    }
    .menu-toggle {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.25rem;
      color: var(--p-text-color);
      padding: 0.25rem;
    }
    .nf-header-title {
      font-weight: 600;
      font-size: 1.125rem;
      color: var(--p-text-color);
    }
    .nf-header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `],
})
export class HeaderComponent {
  title = input('Nestfolio');
  showMenuToggle = input(false);
  menuToggle = output<void>();
}
