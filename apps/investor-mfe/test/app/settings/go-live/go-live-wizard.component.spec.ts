import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { I18nService } from '@nestfolio/shell/i18n';
import { GoLiveWizardComponent } from '../../../../src/app/settings/go-live/go-live-wizard.component';

const MockI18nService = {
  t: (key: string) => key,
};

describe('GoLiveWizardComponent', () => {
  let component: GoLiveWizardComponent;
  let fixture: ComponentFixture<GoLiveWizardComponent>;
  let router: { navigate: jest.Mock };

  beforeEach(async () => {
    router = { navigate: jest.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [GoLiveWizardComponent],
      providers: [
        { provide: I18nService, useValue: MockI18nService },
        { provide: Router, useValue: router },
      ],
    })
      .overrideComponent(GoLiveWizardComponent, {
        set: {
          template: `<div data-testid="wizard">step {{ activeStep() }}</div>`,
          imports: [],
          styles: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GoLiveWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start at step 0', () => {
    expect(component.activeStep()).toBe(0);
  });

  it('should have 5 steps', () => {
    expect(component.totalSteps).toBe(5);
    expect(component.steps().length).toBe(5);
  });

  it('nextStep should advance activeStep', () => {
    component.nextStep();
    expect(component.activeStep()).toBe(1);
  });

  it('nextStep should not advance beyond last step', () => {
    for (let i = 0; i < 10; i++) component.nextStep();
    expect(component.activeStep()).toBe(4);
  });

  it('prevStep should go back', () => {
    component.nextStep();
    component.nextStep();
    component.prevStep();
    expect(component.activeStep()).toBe(1);
  });

  it('prevStep should not go below 0', () => {
    component.prevStep();
    expect(component.activeStep()).toBe(0);
  });

  it('confirming should start false', () => {
    expect(component.confirming()).toBe(false);
  });

  it('confirmGoLive should navigate to /onboarding with go-live queryParam', async () => {
    await component.confirmGoLive();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/onboarding'],
      { queryParams: { flowType: 'go-live' } },
    );
  });
});
