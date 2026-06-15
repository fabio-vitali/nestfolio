import { ComponentFixture } from '@angular/core/testing';
import { I18nService } from '@nestfolio/shell/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shell/testing';
import { ExecutionModeBadgeComponent } from '../../../src/app/dashboard/execution-mode-badge.component';

describe('ExecutionModeBadgeComponent', () => {
  let component: ExecutionModeBadgeComponent;
  let fixture: ComponentFixture<ExecutionModeBadgeComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(ExecutionModeBadgeComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default executionMode to null', () => {
    expect(component.executionMode).toBeNull();
  });

  it('isLive should be false when executionMode is null', () => {
    component.executionMode = null;
    expect(component.isLive).toBe(false);
  });

  it('isLive should be false when executionMode is simulation', () => {
    component.executionMode = 'simulation';
    expect(component.isLive).toBe(false);
  });

  it('isLive should be true when executionMode is live', () => {
    component.executionMode = 'live';
    expect(component.isLive).toBe(true);
  });

  it('isLive should be false for any other string', () => {
    component.executionMode = 'AUTO';
    expect(component.isLive).toBe(false);
  });

});

describe('ExecutionModeBadgeComponent (real template — testid-state)', () => {
  let component: ExecutionModeBadgeComponent;
  let fixture: ComponentFixture<ExecutionModeBadgeComponent>;

  beforeEach(async () => {
    fixture = await setupComponentTest(ExecutionModeBadgeComponent, {
      providers: [{ provide: I18nService, useValue: createMockI18nService() }],
      overrideTemplate: null,
    });
    component = fixture.componentInstance;
  });

  it('data-testid-state reflects execution-mode-live when isLive is true', () => {
    component.executionMode = 'live';
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('[data-testid="execution-mode-badge"]');
    expect(span?.getAttribute('data-testid-state')).toBe('execution-mode-live');
  });

  it('data-testid-state reflects execution-mode-sim when not live', () => {
    component.executionMode = 'simulation';
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('[data-testid="execution-mode-badge"]');
    expect(span?.getAttribute('data-testid-state')).toBe('execution-mode-sim');
  });
});
