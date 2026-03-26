import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { StepsModule } from 'primeng/steps';
import { I18nService } from '@nestfolio/shell/i18n';
import { TranslatePipe } from '@ngx-translate/core';

interface WizardStep {
  label: string;
  icon: string;
}

@Component({
  selector: 'app-go-live-wizard',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, MessageModule, StepsModule, TranslatePipe],
  template: `
    <div class="go-live-wizard">
      <div class="wizard-header">
        <h1 class="wizard-title">{{ 'settings.goLive.wizardTitle' | translate }}</h1>
        <p class="wizard-subtitle">{{ 'settings.goLive.wizardSubtitle' | translate }}</p>
      </div>

      <p-steps
        [model]="steps()"
        [activeIndex]="activeStep()"
        [readonly]="true"
        styleClass="wizard-steps"
      />

      <div class="wizard-body">
        <!-- Step 1: Review Risk Profile -->
        @if (activeStep() === 0) {
          <p-card header="{{ 'settings.goLive.steps.riskProfile.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.riskProfile.description' | translate }}</p>
            <div class="review-items">
              <div class="review-item">
                <span class="pi pi-shield review-icon"></span>
                <div>
                  <div class="review-label">{{ 'settings.goLive.steps.riskProfile.riskLevel' | translate }}</div>
                  <div class="review-value">{{ 'settings.goLive.steps.riskProfile.reviewedInOnboarding' | translate }}</div>
                </div>
              </div>
            </div>
            <div class="step-actions">
              <p-button
                [label]="'settings.goLive.next' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="nextStep()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 2: Review Goals -->
        @if (activeStep() === 1) {
          <p-card header="{{ 'settings.goLive.steps.goals.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.goals.description' | translate }}</p>
            <div class="review-items">
              <div class="review-item">
                <span class="pi pi-flag review-icon"></span>
                <div>
                  <div class="review-label">{{ 'settings.goLive.steps.goals.investmentGoal' | translate }}</div>
                  <div class="review-value">{{ 'settings.goLive.steps.goals.reviewedInOnboarding' | translate }}</div>
                </div>
              </div>
            </div>
            <div class="step-actions">
              <p-button
                [label]="'settings.goLive.back' | translate"
                severity="secondary"
                [outlined]="true"
                (onClick)="prevStep()"
                data-testid="step-back-btn"
              />
              <p-button
                [label]="'settings.goLive.next' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="nextStep()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 3: Review Mandate & Guardrails -->
        @if (activeStep() === 2) {
          <p-card header="{{ 'settings.goLive.steps.mandate.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.mandate.description' | translate }}</p>
            <div class="review-items">
              <div class="review-item">
                <span class="pi pi-lock review-icon"></span>
                <div>
                  <div class="review-label">{{ 'settings.goLive.steps.mandate.mandateLevel' | translate }}</div>
                  <div class="review-value">{{ 'settings.goLive.steps.mandate.reviewedInOnboarding' | translate }}</div>
                </div>
              </div>
            </div>
            <p-message
              severity="warn"
              [text]="'settings.goLive.steps.mandate.guardrailsWarning' | translate"
              styleClass="w-full"
            />
            <div class="step-actions">
              <p-button
                [label]="'settings.goLive.back' | translate"
                severity="secondary"
                [outlined]="true"
                (onClick)="prevStep()"
                data-testid="step-back-btn"
              />
              <p-button
                [label]="'settings.goLive.next' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="nextStep()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 4: Fund Account -->
        @if (activeStep() === 3) {
          <p-card header="{{ 'settings.goLive.steps.fund.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.fund.description' | translate }}</p>
            <div class="fund-note">
              <span class="pi pi-info-circle fund-icon"></span>
              <p>{{ 'settings.goLive.steps.fund.note' | translate }}</p>
            </div>
            <div class="step-actions">
              <p-button
                [label]="'settings.goLive.back' | translate"
                severity="secondary"
                [outlined]="true"
                (onClick)="prevStep()"
                data-testid="step-back-btn"
              />
              <p-button
                [label]="'settings.goLive.next' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="nextStep()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 5: Confirmation -->
        @if (activeStep() === 4) {
          <p-card header="{{ 'settings.goLive.steps.confirm.title' | translate }}">
            <div class="confirmation-summary">
              <p class="step-description">{{ 'settings.goLive.steps.confirm.summary' | translate }}</p>

              <p-message
                severity="error"
                [text]="'settings.goLive.steps.confirm.riskWarning' | translate"
                styleClass="w-full confirm-warning"
              />

              <p-message
                severity="warn"
                [text]="'settings.goLive.steps.confirm.irreversibleWarning' | translate"
                styleClass="w-full confirm-warning"
              />
            </div>

            <div class="step-actions">
              <p-button
                [label]="'settings.goLive.back' | translate"
                severity="secondary"
                [outlined]="true"
                (onClick)="prevStep()"
                [disabled]="confirming()"
                data-testid="step-back-btn"
              />
              <p-button
                [label]="'settings.goLive.steps.confirm.confirmButton' | translate"
                severity="danger"
                icon="pi pi-check"
                [loading]="confirming()"
                (onClick)="confirmGoLive()"
                data-testid="confirm-go-live-btn"
              />
            </div>
          </p-card>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .go-live-wizard {
      max-width: 42rem;
      margin: 0 auto;
      padding: 1.5rem;
    }

    .wizard-header {
      margin-bottom: 2rem;
      text-align: center;
    }

    .wizard-title {
      margin: 0 0 0.5rem;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--nf-text-primary, #212529);
    }

    .wizard-subtitle {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--nf-text-secondary, #6c757d);
    }

    .wizard-steps {
      margin-bottom: 1.5rem;
    }

    .wizard-body {
      margin-top: 1.5rem;
    }

    .step-description {
      color: var(--nf-text-secondary, #6c757d);
      margin-bottom: 1rem;
    }

    .review-items {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .review-item {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem;
      border-radius: 0.5rem;
      background: var(--p-surface-50, #f9fafb);
    }

    .review-icon {
      font-size: 1.25rem;
      color: var(--p-blue-500, #3b82f6);
      flex-shrink: 0;
    }

    .review-label {
      font-size: 0.8125rem;
      color: var(--nf-text-secondary, #6c757d);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .review-value {
      font-weight: 600;
      color: var(--nf-text-primary, #212529);
    }

    .fund-note {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.75rem;
      background: var(--p-blue-50, #eff6ff);
      border: 1px solid var(--p-blue-100, #dbeafe);
      border-radius: 0.5rem;
      margin-bottom: 1rem;
    }

    .fund-icon {
      color: var(--p-blue-500, #3b82f6);
      flex-shrink: 0;
    }

    .confirmation-summary {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .confirm-warning {
      margin-bottom: 0;
    }

    .step-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--p-surface-200, #e5e7eb);
    }

    .w-full { width: 100%; }
  `],
})
export class GoLiveWizardComponent {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  readonly activeStep = signal(0);
  readonly confirming = signal(false);
  readonly totalSteps = 5;

  readonly steps = computed<WizardStep[]>(() => [
    { label: this.i18n.t('settings.goLive.steps.riskProfile.label'), icon: 'pi pi-shield' },
    { label: this.i18n.t('settings.goLive.steps.goals.label'), icon: 'pi pi-flag' },
    { label: this.i18n.t('settings.goLive.steps.mandate.label'), icon: 'pi pi-lock' },
    { label: this.i18n.t('settings.goLive.steps.fund.label'), icon: 'pi pi-wallet' },
    { label: this.i18n.t('settings.goLive.steps.confirm.label'), icon: 'pi pi-check-circle' },
  ]);

  nextStep(): void {
    if (this.activeStep() < this.totalSteps - 1) {
      this.activeStep.update((s) => s + 1);
    }
  }

  prevStep(): void {
    if (this.activeStep() > 0) {
      this.activeStep.update((s) => s - 1);
    }
  }

  async confirmGoLive(): Promise<void> {
    this.confirming.set(true);
    try {
      // Navigate to onboarding-mfe with go-live flowType
      // The onboarding-bff will receive flowType='go-live' via the session context
      await this.router.navigate(['/onboarding'], {
        queryParams: { flowType: 'go-live' },
      });
    } finally {
      this.confirming.set(false);
    }
  }
}
