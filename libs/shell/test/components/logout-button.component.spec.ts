import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { LogoutButtonComponent } from '../../src/components/logout-button.component';
import { AuthStore } from '../../src/stores/auth.store';

const mockSignOut = jest.fn();
jest.mock('aws-amplify/auth', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

describe('LogoutButtonComponent', () => {
  let fixture: ComponentFixture<LogoutButtonComponent>;
  let authStore: InstanceType<typeof AuthStore>;
  let routerNavigateSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockSignOut.mockReset();
    await TestBed.configureTestingModule({
      imports: [LogoutButtonComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LogoutButtonComponent);
    authStore = TestBed.inject(AuthStore);
    const router = TestBed.inject(Router);
    routerNavigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  it('renders the logout button with data-testid="cta-logout"', () => {
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]');
    expect(btn).toBeTruthy();
  });

  it('renders aria-label="Log out"', () => {
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Log out');
  });

  it('renders the pi pi-sign-out icon', () => {
    const icon = fixture.nativeElement.querySelector('.pi.pi-sign-out');
    expect(icon).toBeTruthy();
  });

  it('calls authSignOut, AuthStore.logout, and navigates to /login on click', async () => {
    mockSignOut.mockResolvedValue(undefined);
    const storeLogoutSpy = jest.spyOn(authStore, 'logout');
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]') as HTMLButtonElement;

    btn.click();
    await fixture.whenStable();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(storeLogoutSpy).toHaveBeenCalledTimes(1);
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('still runs AuthStore.logout and navigates when Amplify signOut rejects (fail-safe)', async () => {
    mockSignOut.mockRejectedValue(new Error('network down'));
    const storeLogoutSpy = jest.spyOn(authStore, 'logout');
    const btn = fixture.nativeElement.querySelector('[data-testid="cta-logout"]') as HTMLButtonElement;

    btn.click();
    await fixture.whenStable();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(storeLogoutSpy).toHaveBeenCalledTimes(1);
    expect(routerNavigateSpy).toHaveBeenCalledWith(['/login']);
  });
});
