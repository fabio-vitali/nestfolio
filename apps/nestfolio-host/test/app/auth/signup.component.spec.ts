import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SignupComponent } from '../../../src/app/auth/signup.component';

jest.mock('@nestfolio/shell/auth', () => ({
  authSignUp: jest.fn(),
}));

import { authSignUp } from '@nestfolio/shell/auth';

describe('SignupComponent', () => {
  let fixture: ComponentFixture<SignupComponent>;
  let component: SignupComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [provideRouter([])],
      teardown: { destroyAfterEach: false },
    })
      .overrideComponent(SignupComponent, {
        set: {
          imports: [CommonModule],
          template: '<div></div>',
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(SignupComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show error when fields are empty', async () => {
    await component.onSignup();
    expect(component.error()).toBe('Please fill all fields');
  });

  it('should call authSignUp with correct params', async () => {
    (authSignUp as jest.Mock).mockResolvedValue({ isSignUpComplete: false });
    component.name = 'Test User';
    component.email = 'test@test.com';
    component.password = 'Password123!';
    component.age = 30;
    await component.onSignup();
    expect(authSignUp).toHaveBeenCalledWith({
      username: 'test@test.com',
      password: 'Password123!',
      email: 'test@test.com',
      name: 'Test User',
      age: '30',
    });
  });

  it('should handle signup error', async () => {
    (authSignUp as jest.Mock).mockRejectedValue(new Error('Email already exists'));
    component.name = 'Test';
    component.email = 'test@test.com';
    component.password = 'pass';
    component.age = 25;
    await component.onSignup();
    expect(component.error()).toBe('Email already exists');
  });
});
