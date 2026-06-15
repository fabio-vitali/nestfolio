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

// Canonical risk domains owned by investor-bff
// (services/investor/investor-bff/src/domain/risk-profile.service.ts).
// We CANNOT import that backend module across the frontend/backend boundary
// (same constraint as the OperatingMode union in go-live.service.ts), so we
// restate the two label arrays here. `computeRiskProfile` clamps each index to
// [0,3] and writes the lowercase label string back onto the profile, so these
// are also the exact strings getProfile() returns for reverse-seeding.
const TOLERANCE_LABELS = ['hold', 'cautious', 'selective', 'aggressive'] as const;
const EXPERIENCE_LABELS = ['novice', 'beginner', 'intermediate', 'expert'] as const;

// Display options are DERIVED from the canonical label arrays (values 0..3),
// so the select can never diverge from the backend domain.
const TOLERANCE_OPTIONS: SelectOption<number>[] = TOLERANCE_LABELS.map((label, value) => ({
  label,
  value,
}));
const EXPERIENCE_OPTIONS: SelectOption<number>[] = EXPERIENCE_LABELS.map((label, value) => ({
  label,
  value,
}));

// Reverse-seeding maps keyed on the ACTUAL stored label strings (lowercased),
// so a returning user who has saved before seeds back to the right index.
const TOLERANCE_RESPONSE_TO_IDX: Record<string, number> = Object.fromEntries(
  TOLERANCE_LABELS.map((label, value) => [label, value]),
);
const EXPERIENCE_LEVEL_TO_IDX: Record<string, number> = Object.fromEntries(
  EXPERIENCE_LABELS.map((label, value) => [label, value]),
);

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
            <div class="form-field">
              <label class="field-label">{{ 'settings.goLive.steps.riskProfile.experienceLabel' | translate }}</label>
              <p-select
                [options]="experienceOptions"
                [ngModel]="experienceIdx()"
                (ngModelChange)="experienceIdx.set($event)"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'settings.goLive.steps.riskProfile.experiencePlaceholder' | translate"
                styleClass="w-full"
                data-testid="risk-experience-input"
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

        <!-- Step 5: Fund Account (optional — link to existing deposit flow, does NOT gate confirm) -->
        @if (activeStep() === 4) {
          <p-card header="{{ 'settings.goLive.steps.fund.title' | translate }}">
            <p class="step-description">{{ 'settings.goLive.steps.fund.description' | translate }}</p>
            <div class="fund-note">
              <i class="pi pi-info-circle fund-icon"></i>
              <span>{{ 'settings.goLive.steps.fund.note' | translate }}</span>
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
                [label]="'settings.goLive.steps.fund.fundAccount' | translate"
                severity="secondary"
                icon="pi pi-wallet"
                (onClick)="goToFund()"
                data-testid="fund-account-link"
              />
              <p-button
                [label]="'settings.goLive.steps.fund.continue' | translate"
                icon="pi pi-arrow-right"
                iconPos="right"
                (onClick)="nextStep()"
                data-testid="step-next-btn"
              />
            </div>
          </p-card>
        }

        <!-- Step 6: Confirmation -->
        @if (activeStep() === 5) {
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
  // Risk(0) -> Goals(1) -> OperatingMode(2) -> Mandate(3) -> Fund(4) -> Confirm(5)
  readonly totalSteps = 6;

  readonly profile = signal<InvestorProfile | null>(null);
  readonly mandateAccepted = signal(false);
  readonly toleranceIdx = signal(0);
  readonly experienceIdx = signal(0);
  readonly goalObjective = signal('');
  readonly operatingMode = signal<OperatingMode>('BALANCED');

  readonly toleranceOptions = TOLERANCE_OPTIONS;
  readonly experienceOptions = EXPERIENCE_OPTIONS;
  readonly operatingModeOptions = OPERATING_MODE_OPTIONS;

  readonly steps = computed<WizardStep[]>(() => [
    { label: this.i18n.t('settings.goLive.steps.riskProfile.label'), icon: 'pi pi-shield' },
    { label: this.i18n.t('settings.goLive.steps.goals.label'), icon: 'pi pi-flag' },
    { label: this.i18n.t('settings.goLive.steps.operatingMode.label'), icon: 'pi pi-sliders-h' },
    { label: this.i18n.t('settings.goLive.steps.mandate.label'), icon: 'pi pi-lock' },
    { label: this.i18n.t('settings.goLive.steps.fund.label'), icon: 'pi pi-wallet' },
    { label: this.i18n.t('settings.goLive.steps.confirm.label'), icon: 'pi pi-check-circle' },
  ]);

  async ngOnInit(): Promise<void> {
    const profile = await this.goLive.getProfile();
    this.profile.set(profile);
    this.goalObjective.set(profile.goal.objective);
    this.operatingMode.set(profile.operatingMode);
    // Reverse-seed from the actual stored label strings (lowercased to match
    // the canonical TOLERANCE_LABELS/EXPERIENCE_LABELS); fall back to 0 only if
    // a stored value is genuinely unrecognised.
    const toleranceKey = profile.riskProfile.toleranceResponse.toLowerCase();
    const experienceKey = profile.riskProfile.experienceLevel.toLowerCase();
    this.toleranceIdx.set(TOLERANCE_RESPONSE_TO_IDX[toleranceKey] ?? 0);
    this.experienceIdx.set(EXPERIENCE_LEVEL_TO_IDX[experienceKey] ?? 0);
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
    await this.goLive.updateRiskProfile(this.toleranceIdx(), this.experienceIdx());
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

  // Funding is optional and reuses the existing deposit flow (design D6).
  // It does NOT gate confirm — it simply links the user to the deposit route.
  goToFund(): void {
    void this.router.navigate(['/deposit']);
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
