import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';
import type { RiskAnswer, RiskProfileInput } from '../../stores/onboarding.store';

/** Score-to-band mapping: determines equity allocation range based on risk score. */
function computeBand(score: number): { minEquity: number; maxEquity: number } {
  if (score <= 2) return { minEquity: 0, maxEquity: 20 };
  if (score <= 4) return { minEquity: 10, maxEquity: 40 };
  if (score <= 6) return { minEquity: 30, maxEquity: 60 };
  if (score <= 8) return { minEquity: 50, maxEquity: 80 };
  return { minEquity: 70, maxEquity: 100 };
}

/** Map answer IDs to their scores. Answer suffix A=1, B=2, C=3, D=4. */
function scoreFromAnswerId(answerId: string): number {
  const suffix = answerId.slice(-1);
  switch (suffix) {
    case 'A': return 1;
    case 'B': return 2;
    case 'C': return 3;
    case 'D': return 4;
    default: return 0;
  }
}

@Component({
  selector: 'app-risk-confirm-step',
  standalone: true,
  imports: [CommonModule, FormsModule, CheckboxModule, CardModule],
  template: `
    <div class="risk-confirm-step">
      <h3>{{ i18n.t('onboarding.riskConfirm.title') }}</h3>
      <p class="step-description">{{ i18n.t('onboarding.riskConfirm.description') }}</p>

      <p-card>
        <div class="score-display">
          <div class="score-value">
            <span class="score-number">{{ riskScore() }}</span>
            <span class="score-max">/ 10</span>
          </div>
          <p class="score-label">{{ i18n.t('onboarding.riskConfirm.riskScore') }}</p>

          <div class="gauge-container">
            <div class="gauge-bar">
              <div class="gauge-fill" [style.width.%]="riskScore() * 10" [class]="gaugeColorClass()"></div>
            </div>
            <div class="gauge-labels">
              <span>{{ i18n.t('onboarding.riskConfirm.low') }}</span>
              <span>{{ i18n.t('onboarding.riskConfirm.high') }}</span>
            </div>
          </div>

          <div class="band-info">
            <div class="band-item">
              <span class="band-label">{{ i18n.t('onboarding.riskConfirm.minEquity') }}</span>
              <span class="band-value">{{ band().minEquity }}%</span>
            </div>
            <div class="band-item">
              <span class="band-label">{{ i18n.t('onboarding.riskConfirm.maxEquity') }}</span>
              <span class="band-value">{{ band().maxEquity }}%</span>
            </div>
          </div>
        </div>
      </p-card>

      <div class="confirm-section">
        <p-checkbox
          [(ngModel)]="confirmed"
          (ngModelChange)="onConfirmChange()"
          [binary]="true"
          inputId="confirmRisk"
        />
        <label for="confirmRisk">{{ i18n.t('onboarding.riskConfirm.confirmLabel') }}</label>
      </div>
    </div>
  `,
  styles: [`
    .risk-confirm-step {
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
    .score-display {
      text-align: center;
      padding: 1rem 0;
    }
    .score-value {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 0.25rem;
    }
    .score-number {
      font-size: 3rem;
      font-weight: 700;
      color: var(--p-primary-color);
    }
    .score-max {
      font-size: 1.25rem;
      color: var(--nf-text-secondary);
    }
    .score-label {
      margin: 0.25rem 0 1.5rem;
      color: var(--nf-text-secondary);
      font-size: 0.9375rem;
    }
    .gauge-container {
      max-width: 400px;
      margin: 0 auto 1.5rem;
    }
    .gauge-bar {
      height: 12px;
      background: var(--nf-bg-secondary, #e9ecef);
      border-radius: 6px;
      overflow: hidden;
    }
    .gauge-fill {
      height: 100%;
      border-radius: 6px;
      transition: width 0.5s ease;
    }
    .gauge-fill.gauge-low { background: #22c55e; }
    .gauge-fill.gauge-medium { background: #f59e0b; }
    .gauge-fill.gauge-high { background: #ef4444; }
    .gauge-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 0.25rem;
      font-size: 0.75rem;
      color: var(--nf-text-secondary);
    }
    .band-info {
      display: flex;
      justify-content: center;
      gap: 2rem;
    }
    .band-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }
    .band-label {
      font-size: 0.8125rem;
      color: var(--nf-text-secondary);
    }
    .band-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--nf-text-primary);
    }
    .confirm-section {
      display: flex;
      justify-content: center;
      padding: 0.5rem 0;
    }
  `],
})
export class RiskConfirmStepComponent {
  readonly i18n = inject(I18nService);
  readonly profileChange = output<RiskProfileInput>();

  readonly riskAnswers = input<RiskAnswer[]>([]);

  confirmed = false;

  readonly riskScore = computed(() => {
    const answers = this.riskAnswers();
    if (answers.length === 0) return 0;
    const total = answers.reduce((sum, a) => sum + scoreFromAnswerId(a.answerId), 0);
    return Math.round((total / 20) * 10);
  });

  readonly band = computed(() => computeBand(this.riskScore()));

  readonly gaugeColorClass = computed(() => {
    const score = this.riskScore();
    if (score <= 3) return 'gauge-low';
    if (score <= 7) return 'gauge-medium';
    return 'gauge-high';
  });

  onConfirmChange(): void {
    if (this.confirmed) {
      this.profileChange.emit({
        score: this.riskScore(),
        band: this.band(),
      });
    }
  }
}
