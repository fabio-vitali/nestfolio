import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '@nestfolio/i18n';
import { RiskConfirmStepComponent } from './risk-confirm-step.component';
import type { RiskAnswer } from '../../stores/onboarding.store';

describe('RiskConfirmStepComponent', () => {
  let component: RiskConfirmStepComponent;
  let fixture: ComponentFixture<RiskConfirmStepComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RiskConfirmStepComponent],
      providers: [{ provide: I18nService, useValue: mockI18n }],
    })
      .overrideComponent(RiskConfirmStepComponent, {
        set: {
          imports: [CommonModule, FormsModule],
          template: '<div>test</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RiskConfirmStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should start with confirmed = false', () => {
    expect(component.confirmed).toBe(false);
  });

  it('should compute riskScore as 0 when no answers provided', () => {
    expect(component.riskScore()).toBe(0);
  });

  it('should compute correct riskScore for all-A answers (lowest risk)', () => {
    // All A = score 1 each, total = 5, normalized = round((5/20)*10) = round(2.5) = 3
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_A' },
      { questionId: 'Q3', answerId: 'Q3_A' },
      { questionId: 'Q4', answerId: 'Q4_A' },
      { questionId: 'Q5', answerId: 'Q5_A' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    expect(component.riskScore()).toBe(3);
  });

  it('should compute correct riskScore for all-D answers (highest risk)', () => {
    // All D = score 4 each, total = 20, normalized = round((20/20)*10) = 10
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_D' },
      { questionId: 'Q2', answerId: 'Q2_D' },
      { questionId: 'Q3', answerId: 'Q3_D' },
      { questionId: 'Q4', answerId: 'Q4_D' },
      { questionId: 'Q5', answerId: 'Q5_D' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    expect(component.riskScore()).toBe(10);
  });

  it('should compute correct riskScore for mixed answers', () => {
    // A=1, B=2, C=3, D=4, A=1 => total=11, normalized = round((11/20)*10) = round(5.5) = 6
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_B' },
      { questionId: 'Q3', answerId: 'Q3_C' },
      { questionId: 'Q4', answerId: 'Q4_D' },
      { questionId: 'Q5', answerId: 'Q5_A' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    expect(component.riskScore()).toBe(6);
  });

  it('should compute correct band for low score (<=2)', () => {
    // Score 0 => band { minEquity: 0, maxEquity: 20 }
    expect(component.riskScore()).toBe(0);
    expect(component.band()).toEqual({ minEquity: 0, maxEquity: 20 });
  });

  it('should compute correct band for score 3 (<=4)', () => {
    // All-A answers => score 3 => band { minEquity: 10, maxEquity: 40 }
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_A' },
      { questionId: 'Q3', answerId: 'Q3_A' },
      { questionId: 'Q4', answerId: 'Q4_A' },
      { questionId: 'Q5', answerId: 'Q5_A' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    expect(component.band()).toEqual({ minEquity: 10, maxEquity: 40 });
  });

  it('should compute correct band for score 6 (<=6)', () => {
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_B' },
      { questionId: 'Q3', answerId: 'Q3_C' },
      { questionId: 'Q4', answerId: 'Q4_D' },
      { questionId: 'Q5', answerId: 'Q5_A' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    // Score = 6
    expect(component.band()).toEqual({ minEquity: 30, maxEquity: 60 });
  });

  it('should compute correct band for high score (>8)', () => {
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_D' },
      { questionId: 'Q2', answerId: 'Q2_D' },
      { questionId: 'Q3', answerId: 'Q3_D' },
      { questionId: 'Q4', answerId: 'Q4_D' },
      { questionId: 'Q5', answerId: 'Q5_D' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    // Score = 10
    expect(component.band()).toEqual({ minEquity: 70, maxEquity: 100 });
  });

  it('should compute gauge-low for score <= 3', () => {
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_A' },
      { questionId: 'Q3', answerId: 'Q3_A' },
      { questionId: 'Q4', answerId: 'Q4_A' },
      { questionId: 'Q5', answerId: 'Q5_A' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    expect(component.gaugeColorClass()).toBe('gauge-low');
  });

  it('should compute gauge-high for score > 7', () => {
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_D' },
      { questionId: 'Q2', answerId: 'Q2_D' },
      { questionId: 'Q3', answerId: 'Q3_D' },
      { questionId: 'Q4', answerId: 'Q4_D' },
      { questionId: 'Q5', answerId: 'Q5_D' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    expect(component.gaugeColorClass()).toBe('gauge-high');
  });

  it('should NOT emit profile when confirmed is false', () => {
    const emitSpy = jest.fn();
    component.profileChange.subscribe(emitSpy);

    component.confirmed = false;
    component.onConfirmChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should emit profile when confirmed is true', () => {
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_C' },
      { questionId: 'Q2', answerId: 'Q2_C' },
      { questionId: 'Q3', answerId: 'Q3_C' },
      { questionId: 'Q4', answerId: 'Q4_C' },
      { questionId: 'Q5', answerId: 'Q5_C' },
    ];
    fixture.componentRef.setInput('riskAnswers', answers);
    fixture.detectChanges();

    const emitSpy = jest.fn();
    component.profileChange.subscribe(emitSpy);

    component.confirmed = true;
    component.onConfirmChange();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const emitted = emitSpy.mock.calls[0][0];
    expect(emitted.score).toBe(component.riskScore());
    expect(emitted.band).toEqual(component.band());
  });
});
