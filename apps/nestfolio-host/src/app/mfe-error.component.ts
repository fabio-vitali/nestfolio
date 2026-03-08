import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-mfe-error',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mfe-error">
      <i class="pi pi-exclamation-circle mfe-error-icon"></i>
      <h2 class="mfe-error-title">Module Load Error</h2>
      <p class="mfe-error-message">
        This section could not be loaded. Please check your connection and try again.
      </p>
      <p-button
        label="Retry"
        icon="pi pi-refresh"
        (onClick)="retry()"
        severity="secondary"
      />
    </div>
  `,
  styles: [`
    .mfe-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 50vh;
      padding: 2rem;
      text-align: center;
    }
    .mfe-error-icon {
      font-size: 3rem;
      color: var(--p-red-500, #ef4444);
      margin-bottom: 1rem;
    }
    .mfe-error-title {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      color: var(--nf-text-primary, #212529);
    }
    .mfe-error-message {
      margin: 0 0 1.5rem;
      font-size: 0.9375rem;
      color: var(--nf-text-secondary, #6c757d);
      max-width: 24rem;
    }
  `],
})
export class MfeErrorComponent {
  retry(): void {
    window.location.reload();
  }
}
