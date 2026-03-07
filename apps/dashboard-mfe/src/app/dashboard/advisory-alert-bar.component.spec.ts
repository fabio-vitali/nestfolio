import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdvisoryAlertBarComponent } from './advisory-alert-bar.component';
import { I18nService } from '@nestfolio/i18n';

describe('AdvisoryAlertBarComponent', () => {
  let component: AdvisoryAlertBarComponent;
  let fixture: ComponentFixture<AdvisoryAlertBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdvisoryAlertBarComponent],
      providers: [
        { provide: I18nService, useValue: { t: (k: string) => k } },
      ],
    })
      .overrideComponent(AdvisoryAlertBarComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AdvisoryAlertBarComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default to null advisory status', () => {
    expect(component.advisoryStatus).toBeNull();
  });

  it('should accept advisory status input', () => {
    component.advisoryStatus = {
      pendingDecisionsCount: 2,
      lastRecommendationAt: '2026-03-01T00:00:00Z',
      lastDecisionStatus: 'APPROVED',
      updatedAt: '2026-03-01T00:00:00Z',
    };
    expect(component.advisoryStatus.pendingDecisionsCount).toBe(2);
  });
});
