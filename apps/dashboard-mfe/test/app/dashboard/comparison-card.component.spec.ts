import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { I18nService } from '@nestfolio/shell/i18n';
import { createMockI18nService } from '@nestfolio/shell/testing';
import { ComparisonCardComponent } from '../../../src/app/dashboard/comparison-card.component';

describe('ComparisonCardComponent', () => {
  let component: ComparisonCardComponent;
  let fixture: ComponentFixture<ComparisonCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonCardComponent, RouterTestingModule],
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparisonCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render summary data when provided', () => {
    component.summary = {
      actualTotalValueCents: 10500000,
      simulatedTotalValueCents: 10800000,
      actualReturnPercent: 5.0,
      simulatedReturnPercent: 8.0,
      returnDifferencePercent: 3.0,
      updatedAt: '2026-03-01T00:00:00Z',
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toBeTruthy();
  });
});
