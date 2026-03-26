import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/shell/i18n';

@Component({
  selector: 'app-go-live-cta',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule],
  template: `
    @if (executionMode === 'simulation') {
      <p-card styleClass="go-live-cta-card">
        <div class="go-live-cta">
          <div class="cta-content">
            <span class="pi pi-send cta-icon"></span>
            <div class="cta-text">
              <h3 class="cta-title">{{ i18n.t('settings.goLive.ctaTitle') }}</h3>
              <p class="cta-description">{{ i18n.t('settings.goLive.ctaDescription') }}</p>
            </div>
          </div>
          <p-button
            [label]="i18n.t('settings.goLive.ctaButton')"
            icon="pi pi-arrow-right"
            iconPos="right"
            severity="success"
            (onClick)="navigateToWizard()"
            data-testid="go-live-cta-btn"
          />
        </div>
      </p-card>
    }
  `,
  styles: [`
    :host { display: block; }

    .go-live-cta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }

    .cta-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .cta-icon {
      font-size: 1.75rem;
      color: var(--green-500, #22c55e);
      flex-shrink: 0;
    }

    .cta-title {
      margin: 0 0 0.25rem;
      font-size: 1rem;
      font-weight: 700;
      color: var(--nf-text-primary, #212529);
    }

    .cta-description {
      margin: 0;
      font-size: 0.875rem;
      color: var(--nf-text-secondary, #6c757d);
    }
  `],
})
export class GoLiveCtaComponent {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  @Input() executionMode: string | null = null;

  navigateToWizard(): void {
    this.router.navigate(['/settings', 'go-live']);
  }
}
