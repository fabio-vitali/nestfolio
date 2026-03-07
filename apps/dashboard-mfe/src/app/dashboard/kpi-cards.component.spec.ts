import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KpiCardsComponent } from './kpi-cards.component';
import { I18nService } from '@nestfolio/i18n';

describe('KpiCardsComponent', () => {
  let component: KpiCardsComponent;
  let fixture: ComponentFixture<KpiCardsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiCardsComponent],
      providers: [
        { provide: I18nService, useValue: { t: (k: string) => k } },
      ],
    })
      .overrideComponent(KpiCardsComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(KpiCardsComponent);
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
