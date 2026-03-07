import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '@nestfolio/i18n';
import { RiskAssessmentStepComponent } from './risk-assessment-step.component';

describe('RiskAssessmentStepComponent', () => {
  let component: RiskAssessmentStepComponent;
  let fixture: ComponentFixture<RiskAssessmentStepComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RiskAssessmentStepComponent],
      providers: [{ provide: I18nService, useValue: mockI18n }],
    })
      .overrideComponent(RiskAssessmentStepComponent, {
        set: {
          imports: [CommonModule, FormsModule],
          template: '<div>test</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RiskAssessmentStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should have 5 questions defined', () => {
    expect(component.questions.length).toBe(5);
  });

  it('should have 4 options per question', () => {
    for (const q of component.questions) {
      expect(q.options.length).toBe(4);
    }
  });

  it('should start with 0 answered count', () => {
    expect(component.answeredCount()).toBe(0);
  });

  it('should start with empty selectedAnswers', () => {
    expect(Object.keys(component.selectedAnswers).length).toBe(0);
  });

  it('should update answeredCount when answers change', () => {
    component.selectedAnswers = { Q1: 'Q1_A', Q2: 'Q2_B' };
    component.onAnswerChange();
    expect(component.answeredCount()).toBe(2);
  });

  it('should emit RiskAnswer[] when onAnswerChange is called', () => {
    const emitSpy = jest.fn();
    component.answersChange.subscribe(emitSpy);

    component.selectedAnswers = { Q1: 'Q1_A', Q3: 'Q3_C' };
    component.onAnswerChange();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const emitted = emitSpy.mock.calls[0][0];
    expect(emitted).toEqual(
      expect.arrayContaining([
        { questionId: 'Q1', answerId: 'Q1_A' },
        { questionId: 'Q3', answerId: 'Q3_C' },
      ]),
    );
    expect(emitted.length).toBe(2);
  });

  it('should compute total score from selected answers', () => {
    // A=1, B=2, C=3, D=4 per question
    component.selectedAnswers = {
      Q1: 'Q1_A', // 1
      Q2: 'Q2_B', // 2
      Q3: 'Q3_C', // 3
      Q4: 'Q4_D', // 4
      Q5: 'Q5_A', // 1
    };
    expect(component.getTotalScore()).toBe(11);
  });

  it('should return 0 total score when no answers are selected', () => {
    expect(component.getTotalScore()).toBe(0);
  });

  it('should track answered count as 5 when all questions answered', () => {
    component.selectedAnswers = {
      Q1: 'Q1_A',
      Q2: 'Q2_A',
      Q3: 'Q3_A',
      Q4: 'Q4_A',
      Q5: 'Q5_A',
    };
    component.onAnswerChange();
    expect(component.answeredCount()).toBe(5);
  });

  it('should have unique question IDs', () => {
    const ids = component.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(5);
  });
});
