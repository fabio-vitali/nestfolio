import { Component, inject, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RadioButtonModule } from 'primeng/radiobutton';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/i18n';
import type { RiskAnswer } from '../../stores/onboarding.store';

interface Question {
  id: string;
  textKey: string;
  options: { id: string; labelKey: string; score: number }[];
}

const QUESTIONS: Question[] = [
  {
    id: 'Q1',
    textKey: 'onboarding.risk.q1.text',
    options: [
      { id: 'Q1_A', labelKey: 'onboarding.risk.q1.a', score: 1 },
      { id: 'Q1_B', labelKey: 'onboarding.risk.q1.b', score: 2 },
      { id: 'Q1_C', labelKey: 'onboarding.risk.q1.c', score: 3 },
      { id: 'Q1_D', labelKey: 'onboarding.risk.q1.d', score: 4 },
    ],
  },
  {
    id: 'Q2',
    textKey: 'onboarding.risk.q2.text',
    options: [
      { id: 'Q2_A', labelKey: 'onboarding.risk.q2.a', score: 1 },
      { id: 'Q2_B', labelKey: 'onboarding.risk.q2.b', score: 2 },
      { id: 'Q2_C', labelKey: 'onboarding.risk.q2.c', score: 3 },
      { id: 'Q2_D', labelKey: 'onboarding.risk.q2.d', score: 4 },
    ],
  },
  {
    id: 'Q3',
    textKey: 'onboarding.risk.q3.text',
    options: [
      { id: 'Q3_A', labelKey: 'onboarding.risk.q3.a', score: 1 },
      { id: 'Q3_B', labelKey: 'onboarding.risk.q3.b', score: 2 },
      { id: 'Q3_C', labelKey: 'onboarding.risk.q3.c', score: 3 },
      { id: 'Q3_D', labelKey: 'onboarding.risk.q3.d', score: 4 },
    ],
  },
  {
    id: 'Q4',
    textKey: 'onboarding.risk.q4.text',
    options: [
      { id: 'Q4_A', labelKey: 'onboarding.risk.q4.a', score: 1 },
      { id: 'Q4_B', labelKey: 'onboarding.risk.q4.b', score: 2 },
      { id: 'Q4_C', labelKey: 'onboarding.risk.q4.c', score: 3 },
      { id: 'Q4_D', labelKey: 'onboarding.risk.q4.d', score: 4 },
    ],
  },
  {
    id: 'Q5',
    textKey: 'onboarding.risk.q5.text',
    options: [
      { id: 'Q5_A', labelKey: 'onboarding.risk.q5.a', score: 1 },
      { id: 'Q5_B', labelKey: 'onboarding.risk.q5.b', score: 2 },
      { id: 'Q5_C', labelKey: 'onboarding.risk.q5.c', score: 3 },
      { id: 'Q5_D', labelKey: 'onboarding.risk.q5.d', score: 4 },
    ],
  },
];

@Component({
  selector: 'app-risk-assessment-step',
  standalone: true,
  imports: [CommonModule, FormsModule, RadioButtonModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="risk-assessment">
      <h3>{{ i18n.t('onboarding.risk.title') }}</h3>
      <p class="step-description">{{ i18n.t('onboarding.risk.description') }}</p>

      @for (question of questions; track question.id; let idx = $index) {
        <p-card styleClass="question-card">
          <div class="question">
            <p class="question-text">{{ idx + 1 }}. {{ i18n.t(question.textKey) }}</p>
            <div class="options">
              @for (option of question.options; track option.id) {
                <div class="option">
                  <p-radioButton
                    [name]="question.id"
                    [value]="option.id"
                    [(ngModel)]="selectedAnswers[question.id]"
                    (ngModelChange)="onAnswerChange()"
                    [inputId]="option.id"
                  />
                  <label [for]="option.id">{{ i18n.t(option.labelKey) }}</label>
                </div>
              }
            </div>
          </div>
        </p-card>
      }

      <p class="progress-text">
        {{ i18n.t('onboarding.risk.progress', { answered: answeredCount().toString(), total: '5' }) }}
      </p>
    </div>
  `,
  styles: [`
    .risk-assessment {
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
    :host ::ng-deep .question-card .p-card-body {
      padding: 1rem;
    }
    .question-text {
      margin: 0 0 0.75rem;
      font-weight: 500;
      font-size: 0.9375rem;
    }
    .options {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .option label {
      cursor: pointer;
      font-size: 0.875rem;
    }
    .progress-text {
      text-align: center;
      color: var(--nf-text-secondary);
      font-size: 0.875rem;
      margin: 0;
    }
  `],
})
export class RiskAssessmentStepComponent {
  readonly i18n = inject(I18nService);
  readonly answersChange = output<RiskAnswer[]>();

  readonly questions = QUESTIONS;
  selectedAnswers: Record<string, string> = {};
  answeredCount = signal(0);

  onAnswerChange(): void {
    const count = Object.keys(this.selectedAnswers).length;
    this.answeredCount.set(count);

    const answers: RiskAnswer[] = Object.entries(this.selectedAnswers).map(
      ([questionId, answerId]) => ({ questionId, answerId }),
    );
    this.answersChange.emit(answers);
  }

  /** Compute total score from selected answers. Each answer maps to 1-4 points. */
  getTotalScore(): number {
    let total = 0;
    for (const question of QUESTIONS) {
      const selected = this.selectedAnswers[question.id];
      if (selected) {
        const option = question.options.find((o) => o.id === selected);
        if (option) total += option.score;
      }
    }
    return total;
  }
}
