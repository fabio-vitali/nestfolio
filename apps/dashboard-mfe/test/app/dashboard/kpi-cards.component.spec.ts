import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { KpiCardsComponent } from '../../../src/app/dashboard/kpi-cards.component';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { setupComponentTest, createMockI18nService, createMockRouter } from '@nestfolio/shell/testing';

describe('KpiCardsComponent', () => {
  let component: KpiCardsComponent;
  let fixture: ComponentFixture<KpiCardsComponent>;
  let router: ReturnType<typeof createMockRouter>;
  let flagsStore: { isEnabled: jest.Mock; flags: jest.Mock };

  beforeEach(async () => {
    router = createMockRouter();
    flagsStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      flags: jest.fn().mockReturnValue({}),
    };
    fixture = await setupComponentTest(KpiCardsComponent, {
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
        { provide: Router, useValue: router },
        { provide: FeatureFlagsStore, useValue: flagsStore },
      ],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have null defaults', () => {
    expect(component.portfolioSummary).toBeNull();
    expect(component.totalPnl).toBe(0);
    expect(component.advisoryStatus).toBeNull();
  });

  it('should accept portfolio summary input', () => {
    component.portfolioSummary = {
      totalValueCents: 500000,
      cashBalanceCents: 100000,
      positionCount: 3,
      driftPercent: 1.5,
      updatedAt: '2026-03-01T00:00:00Z',
    };
    expect(component.portfolioSummary.totalValueCents).toBe(500000);
  });

  it('depositDisabled is false when the initiateDeposit flag is enabled', () => {
    flagsStore.isEnabled.mockReturnValue(true);
    expect(component.depositDisabled()).toBe(false);
  });

  it('depositDisabled is true when the initiateDeposit flag is disabled', () => {
    flagsStore.isEnabled.mockImplementation((name: string) => name !== 'initiateDeposit');
    expect(component.depositDisabled()).toBe(true);
  });

  it('goDeposit navigates to /investor/deposit', () => {
    component.goDeposit();
    expect(router.navigate).toHaveBeenCalledWith(['/investor/deposit']);
  });
});
