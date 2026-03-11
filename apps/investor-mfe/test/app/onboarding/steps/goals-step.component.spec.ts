import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '@nestfolio/i18n';
import { GoalsStepComponent } from '../../../../src/app/onboarding/steps/goals-step.component';

describe('GoalsStepComponent', () => {
  let component: GoalsStepComponent;
  let fixture: ComponentFixture<GoalsStepComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GoalsStepComponent],
      providers: [{ provide: I18nService, useValue: mockI18n }],
    })
      .overrideComponent(GoalsStepComponent, {
        set: {
          imports: [CommonModule, FormsModule],
          template: '<div>test</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GoalsStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should start with null form values', () => {
    expect(component.objective).toBeNull();
    expect(component.targetAmount).toBeNull();
    expect(component.timeHorizonMonths).toBeNull();
  });

  it('should have 5 objective options', () => {
    expect(component.objectiveOptions.length).toBe(5);
  });

  it('should include expected objective values', () => {
    const values = component.objectiveOptions.map((o) => o.value);
    expect(values).toEqual(['RETIREMENT', 'EDUCATION', 'WEALTH_GROWTH', 'INCOME', 'CUSTOM']);
  });

  it('should NOT emit goal when fields are incomplete', () => {
    const emitSpy = jest.fn();
    component.goalChange.subscribe(emitSpy);

    component.objective = 'RETIREMENT';
    component.targetAmount = null;
    component.timeHorizonMonths = null;
    component.onFormChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should NOT emit goal when only objective and amount are set', () => {
    const emitSpy = jest.fn();
    component.goalChange.subscribe(emitSpy);

    component.objective = 'RETIREMENT';
    component.targetAmount = 10000;
    component.timeHorizonMonths = null;
    component.onFormChange();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should emit goal when all fields are filled', () => {
    const emitSpy = jest.fn();
    component.goalChange.subscribe(emitSpy);

    component.objective = 'RETIREMENT';
    component.targetAmount = 50000;
    component.timeHorizonMonths = 120;
    component.onFormChange();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith({
      objective: 'RETIREMENT',
      targetAmountCents: 5000000,
      currency: 'EUR',
      timeHorizonMonths: 120,
    });
  });

  it('should convert targetAmount to cents correctly', () => {
    const emitSpy = jest.fn();
    component.goalChange.subscribe(emitSpy);

    component.objective = 'INCOME';
    component.targetAmount = 999.99;
    component.timeHorizonMonths = 24;
    component.onFormChange();

    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ targetAmountCents: 99999 }),
    );
  });

  it('should update yearsDisplay signal when timeHorizonMonths is set', () => {
    component.objective = 'RETIREMENT';
    component.targetAmount = 50000;
    component.timeHorizonMonths = 36;
    component.onFormChange();

    expect(component.yearsDisplay()).toBe('3.0');
  });

  it('should compute fractional years correctly', () => {
    component.objective = 'EDUCATION';
    component.targetAmount = 1000;
    component.timeHorizonMonths = 18;
    component.onFormChange();

    expect(component.yearsDisplay()).toBe('1.5');
  });
});
