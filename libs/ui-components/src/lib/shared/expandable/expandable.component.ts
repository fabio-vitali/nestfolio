import { Component, input, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'nf-expandable',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nf-expandable" [class.nf-expandable--open]="open()">
      <button
        class="nf-expandable__header"
        type="button"
        (click)="toggle()"
        [attr.aria-expanded]="open()"
      >
        <span class="nf-expandable__title">{{ title() }}</span>
        <span class="nf-expandable__chevron">&#9662;</span>
      </button>
      @if (open()) {
        <div class="nf-expandable__body">
          <ng-content />
        </div>
      }
    </div>
  `,
  styles: [`
    .nf-expandable {
      border: 1px solid var(--p-surface-200);
      border-radius: 0.5rem;
      margin-bottom: 0.5rem;
      overflow: hidden;
    }

    .nf-expandable__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 0.75rem 1rem;
      border: none;
      background: var(--p-surface-50);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--p-surface-700);
      transition: background 0.15s;
    }

    .nf-expandable__header:hover {
      background: var(--p-surface-100);
    }

    .nf-expandable__chevron {
      font-size: 0.75rem;
      transition: transform 0.2s;
      color: var(--p-surface-500);
    }

    .nf-expandable--open .nf-expandable__chevron {
      transform: rotate(180deg);
    }

    .nf-expandable__body {
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--p-surface-200);
    }
  `],
})
export class ExpandableComponent implements OnInit {
  title = input.required<string>();
  initialOpen = input(false);

  open = signal(false);

  ngOnInit(): void {
    this.open.set(this.initialOpen());
  }

  toggle(): void {
    this.open.update((v) => !v);
  }
}
