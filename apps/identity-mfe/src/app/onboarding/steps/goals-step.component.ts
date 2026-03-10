import { Component, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';
import type { GoalInput } from '../../stores/onboarding.store';

interface ObjectiveOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-goals-step',
  standalone: true,
  imports: [CommonModule, FormsModule, InputNumberModule, SelectModule, CardModule],
  template: `
    <div class="goals-step">
      <h3>{{ i18n.t('onboarding.goals.title') }}</h3>
      <p class="step-description">{{ i18n.t('onboarding.goals.description') }}</p>

      <p-card>
        <div class="goals-form">
          <div class="field">
            <label for="objective">{{ i18n.t('onboarding.goals.objective') }}</label>
            <p-select
              id="objective"
              [options]="objectiveOptions"
              [(ngModel)]="objective"
              (ngModelChange)="onFormChange()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="i18n.t('onboarding.goals.selectObjective')"
              styleClass="w-full"
            />
          </div>

          <div class="field">
            <label for="targetAmount">{{ i18n.t('onboarding.goals.targetAmount') }}</label>
            <p-inputNumber
              id="targetAmount"
              [(ngModel)]="targetAmount"
              (ngModelChange)="onFormChange()"
              mode="currency"
              currency="EUR"
              [locale]="i18n.currentLocale"
              [min]="0"
              styleClass="w-full"
              inputStyleClass="w-full"
            />
          </div>

          <div class="field">
            <label for="timeHorizon">{{ i18n.t('onboarding.goals.timeHorizon') }}</label>
            <p-inputNumber
              id="timeHorizon"
              [(ngModel)]="timeHorizonMonths"
              (ngModelChange)="onFormChange()"
              [min]="1"
              [max]="600"
              suffix=" months"
              styleClass="w-full"
              inputStyleClass="w-full"
            />
            @if (timeHorizonMonths) {
              <small class="horizon-hint">
                {{ i18n.t('onboarding.goals.yearsLabel', { years: yearsDisplay() }) }}
              </small>
            }
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .goals-step {
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
    .goals-form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
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
    .horizon-hint {
      color: var(--nf-text-secondary);
      font-size: 0.8125rem;
      margin-top: 0.25rem;
    }
  `],
})
export class GoalsStepComponent {
  readonly i18n = inject(I18nService);
  readonly goalChange = output<GoalInput>();

  objective: string | null = null;
  targetAmount: number | null = null;
  timeHorizonMonths: number | null = null;

  readonly objectiveOptions: ObjectiveOption[] = [
    { label: this.i18n.t('onboarding.goals.objectives.retirement'), value: 'RETIREMENT' },
    { label: this.i18n.t('onboarding.goals.objectives.education'), value: 'EDUCATION' },
    { label: this.i18n.t('onboarding.goals.objectives.wealthGrowth'), value: 'WEALTH_GROWTH' },
    { label: this.i18n.t('onboarding.goals.objectives.income'), value: 'INCOME' },
    { label: this.i18n.t('onboarding.goals.objectives.custom'), value: 'CUSTOM' },
  ];

  yearsDisplay = signal('');

  onFormChange(): void {
    if (this.timeHorizonMonths) {
      const years = (this.timeHorizonMonths / 12).toFixed(1);
      this.yearsDisplay.set(years);
    }

    if (this.objective && this.targetAmount != null && this.timeHorizonMonths) {
      this.goalChange.emit({
        objective: this.objective,
        targetAmountCents: Math.round(this.targetAmount * 100),
        currency: 'EUR',
        timeHorizonMonths: this.timeHorizonMonths,
      });
    }
  }
}
