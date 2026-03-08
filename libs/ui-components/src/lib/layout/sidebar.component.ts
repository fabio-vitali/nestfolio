import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NavItem } from './bottom-nav.component';

@Component({
  selector: 'nf-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="nf-sidebar" [class.collapsed]="collapsed()">
      @for (item of items(); track item.route) {
        <a
          class="sidebar-item"
          [routerLink]="item.route"
          routerLinkActive="active"
          [title]="item.label"
        >
          <i [class]="item.icon"></i>
          @if (!collapsed()) {
            <span class="sidebar-label">{{ item.label }}</span>
          }
        </a>
      }
    </nav>
  `,
  styles: [`
    .nf-sidebar {
      display: flex;
      flex-direction: column;
      width: 220px;
      background: var(--p-surface-50);
      border-right: 1px solid var(--p-surface-200);
      padding: 0.5rem 0;
      transition: width 0.2s;
    }
    .nf-sidebar.collapsed {
      width: 56px;
    }
    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      color: var(--p-text-color);
      text-decoration: none;
      transition: background 0.15s;
    }
    .sidebar-item:hover {
      background: var(--p-surface-100);
    }
    .sidebar-item.active {
      color: var(--p-primary-color);
      background: var(--p-primary-50);
    }
    .sidebar-item i {
      font-size: 1.25rem;
      width: 1.5rem;
      text-align: center;
    }
    .sidebar-label {
      white-space: nowrap;
      overflow: hidden;
    }
  `],
})
export class SidebarComponent {
  items = input<NavItem[]>([]);
  collapsed = input(false);
}
