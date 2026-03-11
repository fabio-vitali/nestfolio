import { ComponentFixture } from '@angular/core/testing';
import { AllocationChartComponent } from '../../../src/app/dashboard/allocation-chart.component';
import { I18nService } from '@nestfolio/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shared-state/testing';

describe('AllocationChartComponent', () => {
  let component: AllocationChartComponent;
  let fixture: ComponentFixture<AllocationChartComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(AllocationChartComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default to empty entries', () => {
    expect(component.allocationEntries).toEqual([]);
  });

  it('should build entries from allocation input', () => {
    component.allocation = { EQUITY: 60, BOND: 30, CASH: 10 };

    expect(component.allocationEntries.length).toBe(3);
    expect(component.allocationEntries[0].label).toBe('EQUITY');
    expect(component.allocationEntries[0].percent).toBe(60);
    expect(component.allocationEntries[0].color).toBe('#3b82f6');
  });

  it('should sort entries descending by percent', () => {
    component.allocation = { BOND: 10, EQUITY: 50, CASH: 40 };

    expect(component.allocationEntries[0].label).toBe('EQUITY');
    expect(component.allocationEntries[1].label).toBe('CASH');
    expect(component.allocationEntries[2].label).toBe('BOND');
  });

  it('should use OTHER color for unknown asset class', () => {
    component.allocation = { CRYPTO: 100 };

    expect(component.allocationEntries[0].color).toBe('#6b7280');
  });
});
