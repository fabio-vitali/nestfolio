import { ComponentFixture } from '@angular/core/testing';
import { PositionsTableComponent } from '../../../src/app/dashboard/positions-table.component';
import { I18nService } from '@nestfolio/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shared-state/testing';

describe('PositionsTableComponent', () => {
  let component: PositionsTableComponent;
  let fixture: ComponentFixture<PositionsTableComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(PositionsTableComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default to empty positions', () => {
    expect(component.positions).toEqual([]);
  });

  it('should accept positions input', () => {
    component.positions = [
      {
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        quantity: 10,
        avgCostBasisCents: 15000,
        currentPriceCents: 17500,
        marketValueCents: 175000,
        weightPercent: 40,
        unrealizedPnlCents: 25000,
        lastUpdatedAt: '2026-03-01T00:00:00Z',
      },
    ];
    expect(component.positions.length).toBe(1);
  });
});
