import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LoginComponent } from '../../../src/app/auth/login.component';

jest.mock('@nestfolio/shell/auth', () => ({
  authSignIn: jest.fn(),
}));

import { authSignIn } from '@nestfolio/shell/auth';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [provideRouter([])],
      teardown: { destroyAfterEach: false },
    })
      .overrideComponent(LoginComponent, {
        set: {
          imports: [CommonModule],
          template: '<div></div>',
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show error when email is empty', async () => {
    component.email = '';
    component.password = 'test';
    await component.onLogin();
    expect(component.error()).toBe('Please enter email and password');
  });

  it('should show error when password is empty', async () => {
    component.email = 'test@test.com';
    component.password = '';
    await component.onLogin();
    expect(component.error()).toBe('Please enter email and password');
  });

  it('should call authSignIn on login', async () => {
    (authSignIn as jest.Mock).mockResolvedValue({ isSignedIn: true });
    component.email = 'test@test.com';
    component.password = 'password123';
    await component.onLogin();
    expect(authSignIn).toHaveBeenCalledWith('test@test.com', 'password123');
  });

  it('should handle login error', async () => {
    (authSignIn as jest.Mock).mockRejectedValue(new Error('Invalid credentials'));
    component.email = 'test@test.com';
    component.password = 'wrong';
    await component.onLogin();
    expect(component.error()).toBe('Invalid credentials');
  });

  it('should set loading true during login and false after success', async () => {
    (authSignIn as jest.Mock).mockResolvedValue({ isSignedIn: true });
    component.email = 'test@test.com';
    component.password = 'password123';

    const promise = component.onLogin();
    // Loading should be true while in-flight
    expect(component.loading()).toBe(true);

    await promise;
    expect(component.loading()).toBe(false);
  });

  it('should set loading false after login failure', async () => {
    (authSignIn as jest.Mock).mockRejectedValue(new Error('fail'));
    component.email = 'test@test.com';
    component.password = 'wrong';

    await component.onLogin();

    expect(component.loading()).toBe(false);
  });

  it('should clear previous error before new login attempt', async () => {
    // First attempt fails
    (authSignIn as jest.Mock).mockRejectedValueOnce(new Error('Bad creds'));
    component.email = 'test@test.com';
    component.password = 'wrong';
    await component.onLogin();
    expect(component.error()).toBe('Bad creds');

    // Second attempt - sign in succeeds but nextStep is not sign-in complete
    // (avoids router navigation issue in test environment)
    (authSignIn as jest.Mock).mockResolvedValueOnce({ isSignedIn: false, nextStep: 'DONE' });
    component.password = 'correct';
    await component.onLogin();
    // Error should have been cleared before the call
    expect(component.error()).toBeNull();
  });

  it('should handle non-Error exceptions with generic message', async () => {
    (authSignIn as jest.Mock).mockRejectedValue('string-error');
    component.email = 'test@test.com';
    component.password = 'password';
    await component.onLogin();
    expect(component.error()).toBe('Login failed');
  });
});
