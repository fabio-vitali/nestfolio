import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { AppComponent } from '../../src/app/app.component';
import { AuthStore } from '@nestfolio/shell';

jest.mock('@nestfolio/shell/auth', () => ({
  getAuthUser: jest.fn().mockResolvedValue(null),
  authGuard: () => true,
  authSignOut: jest.fn().mockResolvedValue(undefined),
}));

describe('AppComponent (lightweight)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [provideRouter([])],
      teardown: { destroyAfterEach: false },
    })
      .overrideComponent(AppComponent, {
        set: {
          imports: [CommonModule, RouterOutlet],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should have authStore injected', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.authStore).toBeDefined();
  });

  it('should not have ngOnInit (auth moved to APP_INITIALIZER)', () => {
    const fixture = TestBed.createComponent(AppComponent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((fixture.componentInstance as any).ngOnInit).toBeUndefined();
  });
});

describe('AppComponent logout gating', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [provideRouter([])],
      teardown: { destroyAfterEach: false },
    }).compileComponents();
  });

  it('renders cta-logout when AuthStore.status() === "authenticated"', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'u-1',
      username: 'tester',
      email: 't@example.com',
      tenantId: 't-1',
    } as never);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]');
    expect(btn).toBeTruthy();
  });

  it('does NOT render cta-logout when AuthStore.status() !== "authenticated"', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const authStore = TestBed.inject(AuthStore);
    authStore.setUnauthenticated();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]');
    expect(btn).toBeFalsy();
  });
});
