import { ComponentFixture } from '@angular/core/testing';
import { KpiCardsComponent } from '../../../src/app/dashboard/kpi-cards.component';
import { I18nService } from '@nestfolio/shell/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shell/testing';

describe('KpiCardsComponent', () => {
  let component: KpiCardsComponent;
  let fixture: ComponentFixture<KpiCardsComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(KpiCardsComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
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
});
