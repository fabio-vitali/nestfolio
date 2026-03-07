import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LoginComponent } from './login.component';

jest.mock('@nestfolio/auth', () => ({
  authSignIn: jest.fn(),
}));

import { authSignIn } from '@nestfolio/auth';

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
});
