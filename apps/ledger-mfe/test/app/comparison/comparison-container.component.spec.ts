import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { I18nService } from '@nestfolio/i18n';
import { createMockI18nService } from '@nestfolio/shared-state/testing';
import { ComparisonContainerComponent } from '../../../src/app/comparison/comparison-container.component';
import { ComparisonService } from '../../../src/app/services/comparison.service';

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ComparisonContainerComponent', () => {
  let component: ComparisonContainerComponent;
  let fixture: ComponentFixture<ComparisonContainerComponent>;
  let comparisonService: jest.Mocked<ComparisonService>;

  beforeEach(async () => {
    comparisonService = {
      getSimulationComparison: jest.fn(),
    } as jest.Mocked<ComparisonService>;

    await TestBed.configureTestingModule({
      imports: [ComparisonContainerComponent, RouterTestingModule],
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
        { provide: ComparisonService, useValue: comparisonService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparisonContainerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    comparisonService.getSimulationComparison.mockResolvedValue({
      actual: { totalValueCents: 10500000, cashBalanceCents: 200000, positionCount: 3, totalReturnPercent: 5.0, totalReturnCents: 500000 },
      simulated: { totalValueCents: 10800000, cashBalanceCents: 150000, positionCount: 4, totalReturnPercent: 8.0, totalReturnCents: 800000 },
      divergence: { returnDifferencePercent: 3.0, returnDifferenceCents: 300000, positionDifferences: [], missedDecisions: 1, totalDecisions: 5 },
    });
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should load comparison data on init', async () => {
    comparisonService.getSimulationComparison.mockResolvedValue({
      actual: { totalValueCents: 10500000, cashBalanceCents: 200000, positionCount: 3, totalReturnPercent: 5.0, totalReturnCents: 500000 },
      simulated: { totalValueCents: 10800000, cashBalanceCents: 150000, positionCount: 4, totalReturnPercent: 8.0, totalReturnCents: 800000 },
      divergence: { returnDifferencePercent: 3.0, returnDifferenceCents: 300000, positionDifferences: [], missedDecisions: 1, totalDecisions: 5 },
    });

    component.ngOnInit();
    await flushPromises();

    expect(component.comparison()).toBeTruthy();
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
  });

  it('should set error on failure', async () => {
    comparisonService.getSimulationComparison.mockRejectedValue(new Error('Network error'));

    component.ngOnInit();
    await flushPromises();

    expect(component.error()).toBeTruthy();
    expect(component.comparison()).toBeNull();
  });
});
