import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { I18nService } from '@nestfolio/i18n';
import { OperatingModeStepComponent } from './operating-mode-step.component';

describe('OperatingModeStepComponent', () => {
  let component: OperatingModeStepComponent;
  let fixture: ComponentFixture<OperatingModeStepComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OperatingModeStepComponent],
      providers: [{ provide: I18nService, useValue: mockI18n }],
    })
      .overrideComponent(OperatingModeStepComponent, {
        set: {
          imports: [CommonModule],
          template: '<div>test</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OperatingModeStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should have 3 mode options', () => {
    expect(component.modes.length).toBe(3);
  });

  it('should include CONSERVATIVE, BALANCED, and AGGRESSIVE modes', () => {
    const values = component.modes.map((m) => m.value);
    expect(values).toEqual(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']);
  });

  it('should start with no mode selected', () => {
    expect(component.selectedMode()).toBeNull();
  });

  it('should update selectedMode when selectMode is called', () => {
    component.selectMode('BALANCED');
    expect(component.selectedMode()).toBe('BALANCED');
  });

  it('should emit mode on selection', () => {
    const emitSpy = jest.fn();
    component.modeChange.subscribe(emitSpy);

    component.selectMode('AGGRESSIVE');

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('AGGRESSIVE');
  });

  it('should allow changing selection', () => {
    const emitSpy = jest.fn();
    component.modeChange.subscribe(emitSpy);

    component.selectMode('CONSERVATIVE');
    component.selectMode('BALANCED');

    expect(component.selectedMode()).toBe('BALANCED');
    expect(emitSpy).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenLastCalledWith('BALANCED');
  });

  it('should have title and description keys for each mode', () => {
    for (const mode of component.modes) {
      expect(mode.titleKey).toBeTruthy();
      expect(mode.descriptionKey).toBeTruthy();
      expect(mode.icon).toBeTruthy();
    }
  });
});
