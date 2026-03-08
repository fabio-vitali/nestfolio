import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';

@Component({
  selector: 'app-welcome-step',
  standalone: true,
  imports: [CommonModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-card>
      <div class="welcome-content">
        <div class="welcome-icon">
          <i class="pi pi-user-plus"></i>
        </div>
        <h2>{{ i18n.t('onboarding.welcome.title') }}</h2>
        <p class="welcome-subtitle">{{ i18n.t('onboarding.welcome.subtitle') }}</p>

        <div class="steps-preview">
          <div class="preview-item">
            <i class="pi pi-check-circle"></i>
            <span>{{ i18n.t('onboarding.welcome.step1') }}</span>
          </div>
          <div class="preview-item">
            <i class="pi pi-flag"></i>
            <span>{{ i18n.t('onboarding.welcome.step2') }}</span>
          </div>
          <div class="preview-item">
            <i class="pi pi-shield"></i>
            <span>{{ i18n.t('onboarding.welcome.step3') }}</span>
          </div>
          <div class="preview-item">
            <i class="pi pi-sliders-h"></i>
            <span>{{ i18n.t('onboarding.welcome.step4') }}</span>
          </div>
          <div class="preview-item">
            <i class="pi pi-file-edit"></i>
            <span>{{ i18n.t('onboarding.welcome.step5') }}</span>
          </div>
        </div>
      </div>
    </p-card>
  `,
  styles: [`
    .welcome-content {
      text-align: center;
      padding: 1rem 0;
    }
    .welcome-icon {
      font-size: 3rem;
      color: var(--p-primary-500);
      margin-bottom: 1rem;
    }
    .welcome-icon i {
      font-size: 3rem;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.5rem;
      color: var(--nf-text-primary);
    }
    .welcome-subtitle {
      color: var(--nf-text-secondary);
      margin: 0 0 2rem;
      font-size: 1rem;
    }
    .steps-preview {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      text-align: left;
      max-width: 400px;
      margin: 0 auto;
    }
    .preview-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: var(--nf-bg-secondary, #f8f9fa);
    }
    .preview-item i {
      font-size: 1.25rem;
      color: var(--p-primary-500);
      width: 1.5rem;
      text-align: center;
    }
    .preview-item span {
      font-size: 0.9375rem;
    }
  `],
})
export class WelcomeStepComponent {
  readonly i18n = inject(I18nService);
}
