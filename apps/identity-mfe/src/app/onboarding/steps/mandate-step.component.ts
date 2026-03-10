import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RadioButtonModule } from 'primeng/radiobutton';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { I18nService } from '@nestfolio/i18n';
import type { MandateInput } from '../../stores/onboarding.store';
import { OnboardingStore } from '../../stores/onboarding.store';

interface CadenceOption {
  label: string;
  value: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL';
}

@Component({
  selector: 'app-mandate-step',
  standalone: true,
  imports: [CommonModule, FormsModule, RadioButtonModule, InputNumberModule, SelectModule, CardModule, DividerModule],
  template: `
    <div class="mandate-step">
      <h3>{{ i18n.t('onboarding.mandate.title') }}</h3>
      <p class="step-description">{{ i18n.t('onboarding.mandate.description') }}</p>

      <p-card>
        <div class="mandate-form">
          <div class="mandate-level">
            <label class="section-label">{{ i18n.t('onboarding.mandate.levelLabel') }}</label>
            <div class="level-options">
              <div class="level-option">
                <p-radioButton
                  name="mandateLevel"
                  value="ADVISORY"
                  [(ngModel)]="level"
                  (ngModelChange)="onFormChange()"
                  inputId="advisory"
                />
                <label for="advisory">
                  <strong>{{ i18n.t('onboarding.mandate.advisory') }}</strong>
                  <span>{{ i18n.t('onboarding.mandate.advisoryDesc') }}</span>
                </label>
              </div>
              <div class="level-option">
                <p-radioButton
                  name="mandateLevel"
                  value="DISCRETIONARY"
                  [(ngModel)]="level"
                  (ngModelChange)="onFormChange()"
                  inputId="discretionary"
                />
                <label for="discretionary">
                  <strong>{{ i18n.t('onboarding.mandate.discretionary') }}</strong>
                  <span>{{ i18n.t('onboarding.mandate.discretionaryDesc') }}</span>
                </label>
              </div>
            </div>
          </div>

          @if (level === 'DISCRETIONARY') {
            <p-divider />
            <div class="discretionary-params">
              <div class="field">
                <label for="turnoverCap">{{ i18n.t('onboarding.mandate.turnoverCap') }}</label>
                <p-inputNumber
                  id="turnoverCap"
                  [(ngModel)]="monthlyTurnoverCapPercent"
                  (ngModelChange)="onFormChange()"
                  [min]="0"
                  [max]="100"
                  suffix="%"
                  styleClass="w-full"
                  inputStyleClass="w-full"
                />
              </div>

              <div class="field">
                <label for="coolDown">{{ i18n.t('onboarding.mandate.coolDownDays') }}</label>
                <p-inputNumber
                  id="coolDown"
                  [(ngModel)]="coolDownDays"
                  (ngModelChange)="onFormChange()"
                  [min]="1"
                  [max]="30"
                  suffix=" days"
                  styleClass="w-full"
                  inputStyleClass="w-full"
                />
              </div>

              <div class="field">
                <label for="cadence">{{ i18n.t('onboarding.mandate.rebalanceCadence') }}</label>
                <p-select
                  id="cadence"
                  [options]="cadenceOptions"
                  [(ngModel)]="rebalanceCadence"
                  (ngModelChange)="onFormChange()"
                  optionLabel="label"
                  optionValue="value"
                  [placeholder]="i18n.t('onboarding.mandate.selectCadence')"
                  styleClass="w-full"
                />
              </div>
            </div>
          }
        </div>
      </p-card>

      <!-- Summary -->
      <p-card [header]="i18n.t('onboarding.mandate.summaryTitle')">
        <div class="summary">
          <div class="summary-row">
            <span class="summary-label">{{ i18n.t('onboarding.mandate.summaryRiskScore') }}</span>
            <span class="summary-value">{{ store.riskProfile()?.score ?? '-' }} / 10</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">{{ i18n.t('onboarding.mandate.summaryGoal') }}</span>
            <span class="summary-value">{{ store.goal()?.objective ?? '-' }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">{{ i18n.t('onboarding.mandate.summaryMode') }}</span>
            <span class="summary-value">{{ store.operatingMode() ?? '-' }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">{{ i18n.t('onboarding.mandate.summaryMandate') }}</span>
            <span class="summary-value">{{ level || '-' }}</span>
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .mandate-step {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    h3 {
      margin: 0;
      font-size: 1.25rem;
      color: var(--nf-text-primary);
    }
    .step-description {
      margin: 0;
      color: var(--nf-text-secondary);
      font-size: 0.9375rem;
    }
    .mandate-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .section-label {
      font-weight: 600;
      font-size: 0.9375rem;
      margin-bottom: 0.5rem;
      display: block;
    }
    .level-options {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .level-option {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .level-option label {
      display: flex;
      flex-direction: column;
      cursor: pointer;
    }
    .level-option label strong {
      font-size: 0.9375rem;
    }
    .level-option label span {
      font-size: 0.8125rem;
      color: var(--nf-text-secondary);
    }
    .discretionary-params {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .field label {
      font-size: 0.875rem;
      font-weight: 500;
    }
    .w-full { width: 100%; }
    .summary {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--nf-bg-secondary, #e9ecef);
    }
    .summary-row:last-child {
      border-bottom: none;
    }
    .summary-label {
      font-size: 0.875rem;
      color: var(--nf-text-secondary);
    }
    .summary-value {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--nf-text-primary);
    }
  `],
})
export class MandateStepComponent {
  readonly i18n = inject(I18nService);
  readonly store = inject(OnboardingStore);
  readonly mandateChange = output<MandateInput>();

  level: 'ADVISORY' | 'DISCRETIONARY' | null = null;
  monthlyTurnoverCapPercent: number | null = 10;
  coolDownDays: number | null = 7;
  rebalanceCadence: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | null = 'QUARTERLY';

  readonly cadenceOptions: CadenceOption[] = [
    { label: this.i18n.t('onboarding.mandate.cadenceMonthly'), value: 'MONTHLY' },
    { label: this.i18n.t('onboarding.mandate.cadenceQuarterly'), value: 'QUARTERLY' },
    { label: this.i18n.t('onboarding.mandate.cadenceSemiAnnual'), value: 'SEMI_ANNUAL' },
  ];

  onFormChange(): void {
    if (!this.level) return;

    if (this.level === 'ADVISORY') {
      this.mandateChange.emit({
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 0,
        coolDownDays: 0,
        rebalanceCadence: 'QUARTERLY',
      });
      return;
    }

    if (
      this.monthlyTurnoverCapPercent != null &&
      this.coolDownDays != null &&
      this.rebalanceCadence
    ) {
      this.mandateChange.emit({
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: this.monthlyTurnoverCapPercent,
        coolDownDays: this.coolDownDays,
        rebalanceCadence: this.rebalanceCadence,
      });
    }
  }
}
