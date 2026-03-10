jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  getCurrentUser: jest.fn(),
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signOut: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import * as authService from './auth.service';

describe('authGuard', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    router = TestBed.inject(Router);
    jest.restoreAllMocks();
  });

  it('should allow access when session is valid', async () => {
    jest.spyOn(authService, 'getAuthSession').mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
    });

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/dashboard' } as any),
    );

    expect(result).toBe(true);
  });

  it('should try refresh when session is null and allow on success', async () => {
    jest.spyOn(authService, 'getAuthSession').mockResolvedValue(null);
    jest.spyOn(authService, 'forceRefreshSession').mockResolvedValue({
      idToken: 'refreshed',
      accessToken: 'refreshed-access',
    });

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/dashboard' } as any),
    );

    expect(result).toBe(true);
  });

  it('should redirect to login with returnUrl when both session and refresh fail', async () => {
    jest.spyOn(authService, 'getAuthSession').mockResolvedValue(null);
    jest.spyOn(authService, 'forceRefreshSession').mockRejectedValue(new Error('expired'));

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/advisory/dec-001' } as any),
    );

    expect(result).toBeInstanceOf(UrlTree);
    const urlTree = result as UrlTree;
    expect(urlTree.toString()).toContain('/login');
    expect(urlTree.queryParams['returnUrl']).toBe('/advisory/dec-001');
  });

  it('should redirect when refresh returns null', async () => {
    jest.spyOn(authService, 'getAuthSession').mockResolvedValue(null);
    jest.spyOn(authService, 'forceRefreshSession').mockResolvedValue(null);

    const result = await TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: '/dashboard' } as any),
    );

    expect(result).toBeInstanceOf(UrlTree);
  });
});
