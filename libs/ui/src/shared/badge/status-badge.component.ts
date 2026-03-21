import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BadgeSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

@Component({
  selector: 'nf-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="nf-badge" [ngClass]="'nf-badge--' + severity()">
      {{ label() }}
    </span>
  `,
  styles: [`
    .nf-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.625rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
    }
    .nf-badge--success { background: var(--p-green-100); color: var(--p-green-700); }
    .nf-badge--info { background: var(--p-blue-100); color: var(--p-blue-700); }
    .nf-badge--warn { background: var(--p-yellow-100); color: var(--p-yellow-700); }
    .nf-badge--danger { background: var(--p-red-100); color: var(--p-red-700); }
    .nf-badge--secondary { background: var(--p-surface-200); color: var(--p-surface-600); }
  `],
})
export class StatusBadgeComponent {
  label = input.required<string>();
  severity = input<BadgeSeverity>('secondary');
}
