import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivityFeedComponent } from '../../../src/app/dashboard/activity-feed.component';
import { I18nService } from '@nestfolio/shell/i18n';

describe('ActivityFeedComponent', () => {
  let component: ActivityFeedComponent;
  let fixture: ComponentFixture<ActivityFeedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActivityFeedComponent],
      providers: [
        { provide: I18nService, useValue: { t: (k: string) => k } },
      ],
    })
      .overrideComponent(ActivityFeedComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ActivityFeedComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default to empty activities', () => {
    expect(component.activities).toEqual([]);
  });

  it('should return correct icon for ORDER_FILLED', () => {
    expect(component.getIconClass('ORDER_FILLED')).toBe('pi pi-check-circle');
  });

  it('should return correct icon for DECISION_APPROVED', () => {
    expect(component.getIconClass('DECISION_APPROVED')).toBe('pi pi-thumbs-up');
  });

  it('should return correct icon for DECISION_BLOCKED', () => {
    expect(component.getIconClass('DECISION_BLOCKED')).toBe('pi pi-ban');
  });

  it('should return correct icon for DEPOSIT_DETECTED', () => {
    expect(component.getIconClass('DEPOSIT_DETECTED')).toBe('pi pi-arrow-down');
  });

  it('should return default icon for unknown type', () => {
    expect(component.getIconClass('UNKNOWN_TYPE')).toBe('pi pi-circle');
  });
});
