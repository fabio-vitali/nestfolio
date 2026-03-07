import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '@nestfolio/i18n';
import { MandateStepComponent } from './mandate-step.component';
import { OnboardingStore } from '../../stores/onboarding.store';

describe('MandateStepComponent', () => {
  let component: MandateStepComponent;
  let fixture: ComponentFixture<MandateStepComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  const mockStore = {
    riskProfile: jest.fn(() => ({ score: 5 })),
    goal: jest.fn(() => ({ objective: 'RETIREMENT' })),
    operatingMode: jest.fn(() => 'BALANCED'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MandateStepComponent],
      providers: [
        { provide: I18nService, useValue: mockI18n },
        { provide: OnboardingStore, useValue: mockStore },
      ],
    })
      .overrideComponent(MandateStepComponent, {
        set: {
          imports: [CommonModule, FormsModule],
          template: '<div>test</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MandateStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should start with no level selected', () => {
    expect(component.level).toBeNull();
  });

  it('should have default discretionary params', () => {
    expect(component.monthlyTurnoverCapPercent).toBe(10);
    expect(component.coolDownDays).toBe(7);
    expect(component.rebalanceCadence).toBe('QUARTERLY');
  });

  it('should have 3 cadence options', () => {
    expect(component.cadenceOptions.length).toBe(3);
    const values = component.cadenceOptions.map((c) => c.value);
    expect(values).toEqual(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL']);
  });

  it('should NOT emit mandate when level is null', () => {
    const emitSpy = jest.fn();
    component.mandateChange.subscribe(emitSpy);

    component.level = null;
    component.onFormChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should emit advisory mandate with zeroed params when ADVISORY is selected', () => {
    const emitSpy = jest.fn();
    component.mandateChange.subscribe(emitSpy);

    component.level = 'ADVISORY';
    component.onFormChange();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith({
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      coolDownDays: 0,
      rebalanceCadence: 'QUARTERLY',
    });
  });

  it('should emit discretionary mandate with custom params', () => {
    const emitSpy = jest.fn();
    component.mandateChange.subscribe(emitSpy);

    component.level = 'DISCRETIONARY';
    component.monthlyTurnoverCapPercent = 15;
    component.coolDownDays = 5;
    component.rebalanceCadence = 'MONTHLY';
    component.onFormChange();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith({
      level: 'DISCRETIONARY',
      monthlyTurnoverCapPercent: 15,
      coolDownDays: 5,
      rebalanceCadence: 'MONTHLY',
    });
  });

  it('should NOT emit discretionary mandate when turnoverCap is null', () => {
    const emitSpy = jest.fn();
    component.mandateChange.subscribe(emitSpy);

    component.level = 'DISCRETIONARY';
    component.monthlyTurnoverCapPercent = null;
    component.coolDownDays = 7;
    component.rebalanceCadence = 'QUARTERLY';
    component.onFormChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should NOT emit discretionary mandate when coolDownDays is null', () => {
    const emitSpy = jest.fn();
    component.mandateChange.subscribe(emitSpy);

    component.level = 'DISCRETIONARY';
    component.monthlyTurnoverCapPercent = 10;
    component.coolDownDays = null;
    component.rebalanceCadence = 'QUARTERLY';
    component.onFormChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should NOT emit discretionary mandate when rebalanceCadence is null', () => {
    const emitSpy = jest.fn();
    component.mandateChange.subscribe(emitSpy);

    component.level = 'DISCRETIONARY';
    component.monthlyTurnoverCapPercent = 10;
    component.coolDownDays = 7;
    component.rebalanceCadence = null;
    component.onFormChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should inject the OnboardingStore', () => {
    expect(component.store).toBe(mockStore);
  });
});
