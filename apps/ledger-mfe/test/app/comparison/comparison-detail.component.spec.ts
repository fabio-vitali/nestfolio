import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '@nestfolio/shell/i18n';
import { createMockI18nService } from '@nestfolio/shell/testing';
import { ComparisonDetailComponent } from '../../../src/app/comparison/comparison-detail.component';

describe('ComparisonDetailComponent', () => {
  let component: ComparisonDetailComponent;
  let fixture: ComponentFixture<ComparisonDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonDetailComponent],
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparisonDetailComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should display actual and simulated data', () => {
    component.actual = { totalValueCents: 10500000, cashBalanceCents: 200000, positionCount: 3, totalReturnPercent: 5.0, totalReturnCents: 500000 };
    component.simulated = { totalValueCents: 10800000, cashBalanceCents: 150000, positionCount: 4, totalReturnPercent: 8.0, totalReturnCents: 800000 };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('.stream-metrics');
    expect(cards.length).toBe(2);
  });
});
