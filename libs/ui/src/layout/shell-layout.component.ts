import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './header.component';
import { SidebarComponent } from './sidebar.component';
import { BottomNavComponent, NavItem } from './bottom-nav.component';

@Component({
  selector: 'nf-shell-layout',
  standalone: true,
  imports: [CommonModule, HeaderComponent, SidebarComponent, BottomNavComponent],
  template: `
    <div class="shell-layout" [class.sidebar-collapsed]="sidebarCollapsed">
      <nf-header
        [title]="title()"
        [showMenuToggle]="true"
        (menuToggle)="sidebarCollapsed = !sidebarCollapsed"
      >
        <ng-content select="[nfHeaderActions]" />
      </nf-header>
      <div class="shell-body">
        <nf-sidebar
          [items]="navItems()"
          [collapsed]="sidebarCollapsed"
          class="shell-sidebar"
        />
        <main class="shell-content">
          <ng-content />
        </main>
      </div>
      <nf-bottom-nav [items]="navItems()" class="shell-bottom-nav" />
    </div>
  `,
  styles: [`
    .shell-layout {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .shell-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .shell-sidebar {
      display: none;
    }
    .shell-content {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }
    .shell-bottom-nav {
      display: block;
    }
    @media (min-width: 768px) {
      .shell-sidebar {
        display: block;
      }
      .shell-bottom-nav {
        display: none;
      }
    }
  `],
})
export class ShellLayoutComponent {
  title = input('Nestfolio');
  navItems = input<NavItem[]>([]);
  sidebarCollapsed = false;
}
