import { ComponentFixture } from '@angular/core/testing';
import { AdvisoryCycleStatusComponent } from '../../../src/app/dashboard/advisory-cycle-status.component';
import { I18nService } from '@nestfolio/shell/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shell/testing';

describe('AdvisoryCycleStatusComponent', () => {
  let component: AdvisoryCycleStatusComponent;
  let fixture: ComponentFixture<AdvisoryCycleStatusComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(AdvisoryCycleStatusComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
      overrideTemplate: null,
    });
    component = fixture.componentInstance;
  });

  const el = (testid: string) =>
    fixture.nativeElement.querySelector(`[data-testid=${testid}]`);

  it('renders nothing when idle', () => {
    fixture.detectChanges();
    expect(el('dashboard-advisory-generating')).toBeNull();
    expect(el('dashboard-advisory-failed')).toBeNull();
  });

  it('renders the generating banner when generating', () => {
    component.generating = true;
    fixture.detectChanges();
    expect(el('dashboard-advisory-generating')).not.toBeNull();
    expect(el('dashboard-advisory-failed')).toBeNull();
  });

  it('renders the failed banner when failed (and not generating)', () => {
    component.failed = true;
    fixture.detectChanges();
    expect(el('dashboard-advisory-failed')).not.toBeNull();
    expect(el('dashboard-advisory-generating')).toBeNull();
  });

  it('generating takes precedence over failed', () => {
    component.generating = true;
    component.failed = true;
    fixture.detectChanges();
    expect(el('dashboard-advisory-generating')).not.toBeNull();
    expect(el('dashboard-advisory-failed')).toBeNull();
  });
});
