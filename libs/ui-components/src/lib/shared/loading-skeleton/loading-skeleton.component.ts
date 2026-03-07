import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'nf-loading-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="nf-skeleton-container">
      @for (_ of rows; track $index) {
        <div
          class="nf-skeleton-line"
          [style.width]="widths[$index % widths.length]"
          [style.height]="height()"
        ></div>
      }
    </div>
  `,
  styles: [`
    .nf-skeleton-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .nf-skeleton-line {
      background: linear-gradient(
        90deg,
        var(--p-surface-200) 25%,
        var(--p-surface-100) 50%,
        var(--p-surface-200) 75%
      );
      background-size: 200% 100%;
      animation: nf-shimmer 1.5s infinite;
      border-radius: 0.375rem;
    }
    @keyframes nf-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `],
})
export class LoadingSkeletonComponent {
  count = input(3);
  height = input('1rem');

  readonly widths = ['100%', '85%', '70%', '90%', '60%'];

  get rows(): number[] {
    return Array.from({ length: this.count() });
  }
}
