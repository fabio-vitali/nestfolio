import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'nf-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="nf-bottom-nav">
      @for (item of items(); track item.route) {
        <a
          class="bottom-nav-item"
          [routerLink]="item.route"
          routerLinkActive="active"
        >
          <i [class]="item.icon"></i>
          <span>{{ item.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: [`
    .nf-bottom-nav {
      display: flex;
      justify-content: space-around;
      align-items: center;
      background: var(--p-surface-0);
      border-top: 1px solid var(--p-surface-200);
      padding: 0.5rem 0;
    }
    .bottom-nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      color: var(--p-text-muted-color);
      text-decoration: none;
      font-size: 0.7rem;
      padding: 0.25rem 0.75rem;
    }
    .bottom-nav-item i {
      font-size: 1.25rem;
    }
    .bottom-nav-item.active {
      color: var(--p-primary-color);
    }
  `],
})
export class BottomNavComponent {
  items = input<NavItem[]>([]);
}
