import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ConfirmComponent } from '../../../src/app/auth/confirm.component';
import { AuthStore } from '@nestfolio/shared-state';

jest.mock('@nestfolio/auth', () => ({
  authConfirmSignUp: jest.fn(),
}));

import { authConfirmSignUp } from '@nestfolio/auth';

describe('ConfirmComponent', () => {
  let fixture: ComponentFixture<ConfirmComponent>;
  let component: ConfirmComponent;
  let authStore: InstanceType<typeof AuthStore>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [provideRouter([])],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      teardown: { destroyAfterEach: false },
    })
      .overrideComponent(ConfirmComponent, {
        set: {
          imports: [CommonModule, FormsModule],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    authStore = TestBed.inject(AuthStore);
    authStore.reset();
    fixture = TestBed.createComponent(ConfirmComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show error when fields are empty', async () => {
    await component.onConfirm();
    expect(component.error()).toBe('Please enter email and confirmation code');
  });

  it('should call authConfirmSignUp', async () => {
    (authConfirmSignUp as jest.Mock).mockResolvedValue({ isSignUpComplete: true });
    component.email = 'test@test.com';
    component.code = '123456';
    await component.onConfirm();
    expect(authConfirmSignUp).toHaveBeenCalledWith('test@test.com', '123456');
    expect(component.success()).toBe(true);
  });

  it('should handle confirmation error', async () => {
    (authConfirmSignUp as jest.Mock).mockRejectedValue(new Error('Invalid code'));
    component.email = 'test@test.com';
    component.code = 'wrong';
    await component.onConfirm();
    expect(component.error()).toBe('Invalid code');
  });

  it('should read email from AuthStore pendingEmail and clear after confirm', async () => {
    authStore.setPendingEmail('stored@test.com');
    const f2 = TestBed.createComponent(ConfirmComponent);
    const c2 = f2.componentInstance;
    c2.ngOnInit();
    expect(c2.email).toBe('stored@test.com');
    expect(c2.emailFromStore).toBe('stored@test.com');

    // Confirm clears pendingEmail
    (authConfirmSignUp as jest.Mock).mockResolvedValue({ isSignUpComplete: true });
    c2.code = '123456';
    await c2.onConfirm();
    expect(authStore.pendingEmail()).toBeNull();
  });
});
