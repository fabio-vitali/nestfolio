import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  setupComponentTest,
  createMockI18nService,
  createMockRouter,
} from '@nestfolio/shell/testing';
import { GoLiveWizardComponent } from '../../../../src/app/settings/go-live/go-live-wizard.component';
import { GoLiveService, InvestorProfile } from '../../../../src/app/services/go-live.service';

// toleranceResponse/experienceLevel are the REAL lowercase strings written by
// investor-bff's computeRiskProfile (risk-profile.service.ts):
//   TOLERANCE_LABELS  = ['hold','cautious','selective','aggressive']  -> idx 0..3
//   EXPERIENCE_LABELS = ['novice','beginner','intermediate','expert'] -> idx 0..3
// 'selective' -> toleranceIdx 2 ; 'intermediate' -> experienceIdx 2.
const mockProfile: InvestorProfile = {
  operatingMode: 'BALANCED',
  executionMode: 'simulation',
  goal: {
    objective: 'Growth',
    targetAmountCents: 100000,
    currency: 'USD',
    timeHorizonMonths: 60,
    targetReturn: 8,
  },
  riskProfile: {
    score: 2,
    band: { minEquity: 40, maxEquity: 70 },
    toleranceResponse: 'selective',
    experienceLevel: 'intermediate',
  },
  mandate: {
    mandateId: 'mandate-1',
    level: 'STANDARD',
    status: 'ACTIVE',
    effectiveDate: '2024-01-01',
  },
};

describe('GoLiveWizardComponent', () => {
  let component: GoLiveWizardComponent;
  let fixture: ComponentFixture<GoLiveWizardComponent>;
  let router: ReturnType<typeof createMockRouter>;
  let goLive: {
    getProfile: jest.Mock;
    updateRiskProfile: jest.Mock;
    updateGoal: jest.Mock;
    updateOperatingMode: jest.Mock;
    confirmGoLive: jest.Mock;
  };

  beforeEach(async () => {
    router = createMockRouter();
    goLive = {
      getProfile: jest.fn().mockResolvedValue(mockProfile),
      updateRiskProfile: jest.fn().mockResolvedValue({ riskProfile: mockProfile.riskProfile }),
      updateGoal: jest.fn().mockResolvedValue(mockProfile.goal),
      updateOperatingMode: jest.fn().mockResolvedValue({ operatingMode: 'BALANCED' }),
      confirmGoLive: jest.fn().mockResolvedValue({ executionMode: 'live' }),
    };

    fixture = await setupComponentTest(GoLiveWizardComponent, {
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
        { provide: Router, useValue: router },
        { provide: GoLiveService, useValue: goLive },
      ],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start at step 0', () => {
    expect(component.activeStep()).toBe(0);
  });

  it('should have 6 steps', () => {
    expect(component.totalSteps).toBe(6);
    expect(component.steps().length).toBe(6);
  });

  it('nextStep should advance activeStep', () => {
    component.nextStep();
    expect(component.activeStep()).toBe(1);
  });

  it('nextStep should not advance beyond last step', () => {
    for (let i = 0; i < 10; i++) component.nextStep();
    expect(component.activeStep()).toBe(5);
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

  it('ngOnInit seeds profile from GoLiveService.getProfile()', async () => {
    await component.ngOnInit();
    expect(goLive.getProfile).toHaveBeenCalled();
    expect(component.profile()).toEqual(mockProfile);
    expect(component.goalObjective()).toBe('Growth');
    expect(component.operatingMode()).toBe('BALANCED');
  });

  it('ngOnInit reverse-maps the stored tolerance/experience strings to indices', async () => {
    await component.ngOnInit();
    // 'selective' -> 2, 'intermediate' -> 2 (derived from the canonical label arrays)
    expect(component.toleranceIdx()).toBe(2);
    expect(component.experienceIdx()).toBe(2);
  });

  it('mandateAccepted starts false', () => {
    expect(component.mandateAccepted()).toBe(false);
  });

  it('confirmGoLive is a no-op when mandateAccepted is false', async () => {
    component.mandateAccepted.set(false);
    await component.confirmGoLive();
    expect(goLive.confirmGoLive).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('confirmGoLive calls the mutation and navigates to dashboard', async () => {
    goLive.confirmGoLive.mockResolvedValue({ executionMode: 'live' });
    component.mandateAccepted.set(true);
    await component.confirmGoLive();
    expect(goLive.confirmGoLive).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('saveRiskProfile passes the seeded tolerance + experience indices', async () => {
    await component.ngOnInit();
    // seeded from 'selective'/'intermediate' -> (2, 2)
    await component.saveRiskProfile();
    expect(goLive.updateRiskProfile).toHaveBeenCalledWith(2, 2);
  });

  it('saveRiskProfile passes edited tolerance + experience indices', async () => {
    component.toleranceIdx.set(3);
    component.experienceIdx.set(1);
    await component.saveRiskProfile();
    expect(goLive.updateRiskProfile).toHaveBeenCalledWith(3, 1);
  });

  it('saveGoal delegates to GoLiveService.updateGoal', async () => {
    component.goalObjective.set('Retirement');
    await component.saveGoal();
    expect(goLive.updateGoal).toHaveBeenCalledWith({ objective: 'Retirement' });
  });

  it('saveOperatingMode delegates to GoLiveService.updateOperatingMode', async () => {
    component.operatingMode.set('AGGRESSIVE');
    await component.saveOperatingMode();
    expect(goLive.updateOperatingMode).toHaveBeenCalledWith('AGGRESSIVE');
  });

  it('goToFund navigates to the deposit route (funding is optional, does not confirm)', () => {
    component.goToFund();
    expect(router.navigate).toHaveBeenCalledWith(['/deposit']);
    expect(goLive.confirmGoLive).not.toHaveBeenCalled();
  });
});
