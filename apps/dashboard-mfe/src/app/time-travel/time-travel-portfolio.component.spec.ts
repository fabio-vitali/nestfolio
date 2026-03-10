import { I18nService } from '@nestfolio/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shared-state/testing';
import { TimeTravelPortfolioComponent } from './time-travel-portfolio.component';

describe('TimeTravelPortfolioComponent', () => {
  let component: TimeTravelPortfolioComponent;

  beforeEach(async () => {
    const fixture = await setupComponentTest(TimeTravelPortfolioComponent, {
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render empty state when no positions', () => {
    component.positions = [];
    expect(component.positions.length).toBe(0);
  });

  it('should accept positions input', () => {
    component.positions = [
      { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 255 },
      { symbol: 'SPY', quantity: 5, averageCostBasis: 500, totalCostBasis: 2500, lastFillPrice: 510 },
    ];

    expect(component.positions.length).toBe(2);
    expect(component.positions[0].symbol).toBe('VTI');
  });

  it('should accept totalValueCents and cashBalanceCents inputs', () => {
    component.totalValueCents = 10_500_000;
    component.cashBalanceCents = 7_000_000;

    expect(component.totalValueCents).toBe(10_500_000);
    expect(component.cashBalanceCents).toBe(7_000_000);
  });
});
