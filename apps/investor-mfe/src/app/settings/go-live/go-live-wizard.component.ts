import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { StepsModule } from 'primeng/steps';
import { I18nService } from '@nestfolio/shell/i18n';
import { TranslatePipe } from '@ngx-translate/core';
import { GoLiveService, InvestorProfile, OperatingMode } from '../../services/go-live.service';

interface WizardStep {
  label: string;
  icon: string;
}

interface SelectOption<T> {
  label: string;
  value: T;
}

const TOLERANCE_OPTIONS: SelectOption<number>[] = [
  { label: 'Conservative', value: 0 },
  { label: 'Moderate', value: 1 },
  { label: 'Balanced', value: 2 },
  { label: 'Growth', value: 3 },
  { label: 'Aggressive', value: 4 },
];

const TOLERANCE_RESPONSE_TO_IDX: Record<string, number> = {
  CONSERVATIVE: 0,
  MODERATE: 1,
  BALANCED: 2,
  GROWTH: 3,
  AGGRESSIVE: 4,
};

const OPERATING_MODE_OPTIONS: SelectOption<OperatingMode>[] = [
  { label: 'Conservative', value: 'CONSERVATIVE' },
  { label: 'Balanced', value: 'BALANCED' },
  { label: 'Aggressive', value: 'AGGRESSIVE' },
];

@Component({
  selector: 'app-go-live-wizard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    CheckboxModule,
    MessageModule,
    SelectModule,
    StepsModule,
    TranslatePipe,
  ],
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
        <!-- Step 1: Review & Edit Risk Profile -->
        @if (activeStep() === 0) {
          <p-card header="{{ 'settings.goLive.steps.riskProfile.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.riskProfile.description' | translate }}</p>
            <div class="form-field">
              <label class="field-label">{{ 'settings.goLive.steps.riskProfile.toleranceLabel' | translate }}</label>
              <p-select
                [options]="toleranceOptions"
                [ngModel]="toleranceIdx()"
                (ngModelChange)="toleranceIdx.set($event)"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'settings.goLive.steps.riskProfile.tolerancePlaceholder' | translate"
                styleClass="w-full"
                data-testid="risk-tolerance-input"
              />
            </div>
            <div class="step-actions">
              <p-button
                [label]="'settings.goLive.steps.riskProfile.saveAndContinue' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="saveRiskProfile()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 2: Review & Edit Goals -->
        @if (activeStep() === 1) {
          <p-card header="{{ 'settings.goLive.steps.goals.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.goals.description' | translate }}</p>
            <div class="form-field">
              <label class="field-label">{{ 'settings.goLive.steps.goals.objectiveLabel' | translate }}</label>
              <input
                type="text"
                class="p-inputtext w-full"
                [ngModel]="goalObjective()"
                (ngModelChange)="goalObjective.set($event)"
                [placeholder]="'settings.goLive.steps.goals.objectivePlaceholder' | translate"
                data-testid="goal-objective-input"
              />
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
                [label]="'settings.goLive.steps.goals.saveAndContinue' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="saveGoal()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 3: Review & Edit Operating Mode -->
        @if (activeStep() === 2) {
          <p-card header="{{ 'settings.goLive.steps.operatingMode.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.operatingMode.description' | translate }}</p>
            <div class="form-field">
              <label class="field-label">{{ 'settings.goLive.steps.operatingMode.modeLabel' | translate }}</label>
              <p-select
                [options]="operatingModeOptions"
                [ngModel]="operatingMode()"
                (ngModelChange)="operatingMode.set($event)"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'settings.goLive.steps.operatingMode.modePlaceholder' | translate"
                styleClass="w-full"
                data-testid="operating-mode-select"
              />
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
                [label]="'settings.goLive.steps.operatingMode.saveAndContinue' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="saveOperatingMode()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 4: Accept Mandate -->
        @if (activeStep() === 3) {
          <p-card header="{{ 'settings.goLive.steps.mandate.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.mandate.description' | translate }}</p>
            <p-message
              severity="warn"
              [text]="'settings.goLive.steps.mandate.guardrailsWarning' | translate"
              styleClass="w-full"
            />
            <div class="mandate-accept">
              <p-checkbox
                [ngModel]="mandateAccepted()"
                (ngModelChange)="mandateAccepted.set($event)"
                [binary]="true"
                inputId="mandate-accept"
                data-testid="mandate-accept-checkbox"
              />
              <label for="mandate-accept" class="mandate-label">
                {{ 'settings.goLive.steps.mandate.acceptLabel' | translate }}
              </label>
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
                [label]="'settings.goLive.steps.mandate.saveAndContinue' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                [disabled]="!mandateAccepted()"
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
                [disabled]="confirming() || !mandateAccepted()"
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

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }

    .field-label {
      font-size: 0.8125rem;
      color: var(--nf-text-secondary, #6c757d);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .mandate-accept {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem;
      margin: 1rem 0;
      border-radius: 0.5rem;
      background: var(--p-surface-50, #f9fafb);
    }

    .mandate-label {
      font-size: 0.9375rem;
      color: var(--nf-text-primary, #212529);
      cursor: pointer;
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
export class GoLiveWizardComponent implements OnInit {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly goLive = inject(GoLiveService);

  readonly activeStep = signal(0);
  readonly confirming = signal(false);
  readonly totalSteps = 5;

  readonly profile = signal<InvestorProfile | null>(null);
  readonly mandateAccepted = signal(false);
  readonly toleranceIdx = signal(0);
  readonly goalObjective = signal('');
  readonly operatingMode = signal<OperatingMode>('BALANCED');

  readonly toleranceOptions = TOLERANCE_OPTIONS;
  readonly operatingModeOptions = OPERATING_MODE_OPTIONS;

  readonly steps = computed<WizardStep[]>(() => [
    { label: this.i18n.t('settings.goLive.steps.riskProfile.label'), icon: 'pi pi-shield' },
    { label: this.i18n.t('settings.goLive.steps.goals.label'), icon: 'pi pi-flag' },
    { label: this.i18n.t('settings.goLive.steps.operatingMode.label'), icon: 'pi pi-sliders-h' },
    { label: this.i18n.t('settings.goLive.steps.mandate.label'), icon: 'pi pi-lock' },
    { label: this.i18n.t('settings.goLive.steps.confirm.label'), icon: 'pi pi-check-circle' },
  ]);

  async ngOnInit(): Promise<void> {
    const profile = await this.goLive.getProfile();
    this.profile.set(profile);
    this.goalObjective.set(profile.goal.objective);
    this.operatingMode.set(profile.operatingMode);
    const toleranceResponseKey = profile.riskProfile.toleranceResponse.toUpperCase();
    this.toleranceIdx.set(TOLERANCE_RESPONSE_TO_IDX[toleranceResponseKey] ?? 0);
  }

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

  async saveRiskProfile(): Promise<void> {
    await this.goLive.updateRiskProfile(this.toleranceIdx(), 0);
    this.nextStep();
  }

  async saveGoal(): Promise<void> {
    await this.goLive.updateGoal({ objective: this.goalObjective() });
    this.nextStep();
  }

  async saveOperatingMode(): Promise<void> {
    await this.goLive.updateOperatingMode(this.operatingMode());
    this.nextStep();
  }

  async confirmGoLive(): Promise<void> {
    if (!this.mandateAccepted()) return;
    this.confirming.set(true);
    try {
      await this.goLive.confirmGoLive();
      await this.router.navigate(['/dashboard']);
    } finally {
      this.confirming.set(false);
    }
  }
}
