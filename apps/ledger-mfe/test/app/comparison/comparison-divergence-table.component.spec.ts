import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '@nestfolio/shell/i18n';
import { createMockI18nService } from '@nestfolio/shell/testing';
import { ComparisonDivergenceTableComponent } from '../../../src/app/comparison/comparison-divergence-table.component';

describe('ComparisonDivergenceTableComponent', () => {
  let component: ComparisonDivergenceTableComponent;
  let fixture: ComponentFixture<ComparisonDivergenceTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonDivergenceTableComponent],
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparisonDivergenceTableComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should display position differences', () => {
    component.divergence = {
      returnDifferencePercent: 3.0,
      returnDifferenceCents: 300000,
      positionDifferences: [
        { symbol: 'AAPL', actualQuantity: 10, simulatedQuantity: 15, quantityDifference: 5, actualValueCents: 175000, simulatedValueCents: 262500 },
        { symbol: 'MSFT', actualQuantity: 5, simulatedQuantity: 5, quantityDifference: 0, actualValueCents: 150000, simulatedValueCents: 150000 },
      ],
      missedDecisions: 1,
      totalDecisions: 5,
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('AAPL');
    expect(el.textContent).toContain('MSFT');
  });
});
