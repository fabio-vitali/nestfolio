import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { AppComponent } from '../../src/app/app.component';

jest.mock('@nestfolio/shell/auth', () => ({
  getAuthUser: jest.fn().mockResolvedValue(null),
  authGuard: () => true,
}));

describe('AppComponent', () => {
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
