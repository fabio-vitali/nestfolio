import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Stepper, StepList, Step, StepPanels, StepPanel } from 'primeng/stepper';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { I18nService } from '@nestfolio/i18n';
import {
  OnboardingStore,
  type RiskAnswer,
  type GoalInput,
  type RiskProfileInput,
  type OperatingMode,
  type MandateInput,
} from '../stores/onboarding.store';
import { OnboardingService } from '../services/onboarding.service';
import { WelcomeStepComponent } from './steps/welcome-step.component';
import { RiskAssessmentStepComponent } from './steps/risk-assessment-step.component';
import { GoalsStepComponent } from './steps/goals-step.component';
import { RiskConfirmStepComponent } from './steps/risk-confirm-step.component';
import { OperatingModeStepComponent } from './steps/operating-mode-step.component';
import { MandateStepComponent } from './steps/mandate-step.component';

@Component({
  selector: 'app-onboarding-container',
  standalone: true,
  imports: [
    CommonModule,
    Stepper,
    StepList,
    Step,
    StepPanels,
    StepPanel,
    ButtonModule,
    MessageModule,
    WelcomeStepComponent,
    RiskAssessmentStepComponent,
    GoalsStepComponent,
    RiskConfirmStepComponent,
    OperatingModeStepComponent,
    MandateStepComponent,
  ],
  template: `
    <div class="onboarding-container">
      <div class="onboarding-header">
        <h1>{{ i18n.t('onboarding.title') }}</h1>
        <div class="progress-bar">
          <div class="progress-fill" [style.width.%]="store.progress()"></div>
        </div>
      </div>

      @if (store.error()) {
        <p-message severity="error" [text]="store.error()!" styleClass="w-full" />
      }

      <p-stepper
        [value]="store.currentStep()"
        (valueChange)="store.goToStep($event ?? 0)"
        [linear]="true"
        styleClass="onboarding-stepper"
      >
        <p-step-list>
          <p-step [value]="0">{{ i18n.t('onboarding.steps.welcome') }}</p-step>
          <p-step [value]="1">{{ i18n.t('onboarding.steps.riskAssessment') }}</p-step>
          <p-step [value]="2">{{ i18n.t('onboarding.steps.goals') }}</p-step>
          <p-step [value]="3">{{ i18n.t('onboarding.steps.riskConfirm') }}</p-step>
          <p-step [value]="4">{{ i18n.t('onboarding.steps.operatingMode') }}</p-step>
          <p-step [value]="5">{{ i18n.t('onboarding.steps.mandate') }}</p-step>
        </p-step-list>
        <p-step-panels>
          <!-- Step 0: Welcome -->
          <p-step-panel [value]="0">
            <ng-template #content let-activateCallback="activateCallback">
              <app-welcome-step />
              <div class="step-actions">
                <span></span>
                <p-button
                  [label]="i18n.t('onboarding.getStarted')"
                  (onClick)="onNext(activateCallback)"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                />
              </div>
            </ng-template>
          </p-step-panel>

          <!-- Step 1: Risk Assessment -->
          <p-step-panel [value]="1">
            <ng-template #content let-activateCallback="activateCallback">
              <app-risk-assessment-step (answersChange)="onRiskAnswersChange($event)" />
              <div class="step-actions">
                <p-button
                  [label]="i18n.t('onboarding.back')"
                  (onClick)="onBack(activateCallback)"
                  [outlined]="true"
                  icon="pi pi-arrow-left"
                />
                <p-button
                  [label]="i18n.t('onboarding.next')"
                  (onClick)="onNext(activateCallback)"
                  [loading]="store.loading()"
                  [disabled]="store.riskAnswers().length < 5"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                />
              </div>
            </ng-template>
          </p-step-panel>

          <!-- Step 2: Goals -->
          <p-step-panel [value]="2">
            <ng-template #content let-activateCallback="activateCallback">
              <app-goals-step (goalChange)="onGoalChange($event)" />
              <div class="step-actions">
                <p-button
                  [label]="i18n.t('onboarding.back')"
                  (onClick)="onBack(activateCallback)"
                  [outlined]="true"
                  icon="pi pi-arrow-left"
                />
                <p-button
                  [label]="i18n.t('onboarding.next')"
                  (onClick)="onNext(activateCallback)"
                  [loading]="store.loading()"
                  [disabled]="!store.goal()"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                />
              </div>
            </ng-template>
          </p-step-panel>

          <!-- Step 3: Risk Confirmation -->
          <p-step-panel [value]="3">
            <ng-template #content let-activateCallback="activateCallback">
              <app-risk-confirm-step
                [riskAnswers]="store.riskAnswers()"
                (profileChange)="onRiskProfileChange($event)"
              />
              <div class="step-actions">
                <p-button
                  [label]="i18n.t('onboarding.back')"
                  (onClick)="onBack(activateCallback)"
                  [outlined]="true"
                  icon="pi pi-arrow-left"
                />
                <p-button
                  [label]="i18n.t('onboarding.next')"
                  (onClick)="onNext(activateCallback)"
                  [loading]="store.loading()"
                  [disabled]="!store.riskProfile()"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                />
              </div>
            </ng-template>
          </p-step-panel>

          <!-- Step 4: Operating Mode -->
          <p-step-panel [value]="4">
            <ng-template #content let-activateCallback="activateCallback">
              <app-operating-mode-step (modeChange)="onModeChange($event)" />
              <div class="step-actions">
                <p-button
                  [label]="i18n.t('onboarding.back')"
                  (onClick)="onBack(activateCallback)"
                  [outlined]="true"
                  icon="pi pi-arrow-left"
                />
                <p-button
                  [label]="i18n.t('onboarding.next')"
                  (onClick)="onNext(activateCallback)"
                  [loading]="store.loading()"
                  [disabled]="!store.operatingMode()"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                />
              </div>
            </ng-template>
          </p-step-panel>

          <!-- Step 5: Mandate -->
          <p-step-panel [value]="5">
            <ng-template #content let-activateCallback="activateCallback">
              <app-mandate-step (mandateChange)="onMandateChange($event)" />
              <div class="step-actions">
                <p-button
                  [label]="i18n.t('onboarding.back')"
                  (onClick)="onBack(activateCallback)"
                  [outlined]="true"
                  icon="pi pi-arrow-left"
                />
                <p-button
                  [label]="i18n.t('onboarding.complete')"
                  (onClick)="onComplete()"
                  [loading]="store.loading()"
                  [disabled]="!store.mandate()"
                  icon="pi pi-check"
                  iconPos="right"
                  severity="success"
                />
              </div>
            </ng-template>
          </p-step-panel>
        </p-step-panels>
      </p-stepper>
    </div>
  `,
  styles: [
    `
      .onboarding-container {
        max-width: 720px;
        margin: 0 auto;
        padding: 1.5rem 1rem;
        min-height: 100vh;
      }
      .onboarding-header {
        text-align: center;
        margin-bottom: 1.5rem;
      }
      .onboarding-header h1 {
        font-size: 1.5rem;
        margin: 0 0 1rem;
        color: var(--nf-text-primary);
      }
      .progress-bar {
        height: 6px;
        background: var(--nf-bg-secondary, #e9ecef);
        border-radius: 3px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: var(--p-primary-color);
        border-radius: 3px;
        transition: width 0.3s ease;
      }
      :host ::ng-deep .onboarding-stepper .p-step {
        flex: 1;
      }
      .step-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid var(--nf-bg-secondary, #e9ecef);
      }
      .w-full {
        width: 100%;
      }

      @media (max-width: 576px) {
        .onboarding-container {
          padding: 1rem 0.75rem;
        }
        :host ::ng-deep .p-step .p-step-title {
          display: none;
        }
      }
    `,
  ],
})
export class OnboardingContainerComponent {
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  readonly i18n = inject(I18nService);
  readonly store = inject(OnboardingStore);

  onRiskAnswersChange(answers: RiskAnswer[]): void {
    this.store.setRiskAnswers(answers);
  }

  onGoalChange(goal: GoalInput): void {
    this.store.setGoal(goal);
  }

  onRiskProfileChange(profile: RiskProfileInput): void {
    this.store.setRiskProfile(profile);
  }

  onModeChange(mode: OperatingMode): void {
    this.store.setOperatingMode(mode);
  }

  onMandateChange(mandate: MandateInput): void {
    this.store.setMandate(mandate);
  }

  async onNext(activateCallback: (index: number) => void): Promise<void> {
    const step = this.store.currentStep();
    this.store.setLoading(true);
    this.store.setError(null);

    try {
      switch (step) {
        case 0:
          // Welcome step — no backend call
          break;
        case 1: {
          // Save risk answers
          const answers = this.store.riskAnswers();
          for (const answer of answers) {
            await this.onboardingService.recordOnboardingAnswer({
              step: answer.questionId,
              payload: { answerId: answer.answerId },
            });
          }
          break;
        }
        case 2: {
          // Save goal
          const goal = this.store.goal();
          if (goal) {
            await this.onboardingService.setGoal(goal);
          }
          break;
        }
        case 3: {
          // Save risk profile
          const profile = this.store.riskProfile();
          if (profile) {
            await this.onboardingService.setRiskProfile(profile);
          }
          break;
        }
        case 4: {
          // Save operating mode
          const mode = this.store.operatingMode();
          if (mode) {
            await this.onboardingService.selectOperatingMode(mode);
          }
          break;
        }
      }

      this.store.nextStep();
      activateCallback(step + 1);
    } catch (e: unknown) {
      this.store.setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      this.store.setLoading(false);
    }
  }

  onBack(activateCallback: (index: number) => void): void {
    const step = this.store.currentStep();
    this.store.prevStep();
    activateCallback(step - 1);
  }

  async onComplete(): Promise<void> {
    this.store.setLoading(true);
    this.store.setError(null);

    try {
      const mandate = this.store.mandate();
      if (mandate) {
        await this.onboardingService.grantMandate(mandate);
      }
      this.store.reset();
      await this.router.navigate(['/dashboard']);
    } catch (e: unknown) {
      this.store.setError(e instanceof Error ? e.message : 'Failed to complete onboarding');
    } finally {
      this.store.setLoading(false);
    }
  }
}
