jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  getCurrentUser: jest.fn(),
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signOut: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
  HttpErrorResponse,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor, _resetInflightSession, _resetRetryFlag } from './auth.interceptor';
import * as authService from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    _resetInflightSession();
    _resetRetryFlag();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    httpTesting.verify();
    jest.restoreAllMocks();
  });

  it('should retry with refreshed token on 401', async () => {
    jest
      .spyOn(authService, 'getAuthSession')
      .mockResolvedValue({ idToken: 'old-token', accessToken: 'old-access' });
    jest
      .spyOn(authService, 'forceRefreshSession')
      .mockResolvedValue({ idToken: 'new-token', accessToken: 'new-access' });

    const promise = new Promise<string>((resolve, reject) => {
      http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe({
        next: resolve,
        error: reject,
      });
    });

    // Wait for the initial session fetch
    await new Promise((r) => setTimeout(r, 0));

    // First request should use old token
    const req1 = httpTesting.expectOne('https://appsync.example.com/graphql');
    expect(req1.request.headers.get('Authorization')).toBe('old-token');

    // Respond with 401
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    // Wait for refresh
    await new Promise((r) => setTimeout(r, 0));

    // Retry request should use new token
    const req2 = httpTesting.expectOne('https://appsync.example.com/graphql');
    expect(req2.request.headers.get('Authorization')).toBe('new-token');
    req2.flush('ok');

    const result = await promise;
    expect(result).toBe('ok');
  });

  it('should redirect to login when refresh fails', async () => {
    jest
      .spyOn(authService, 'getAuthSession')
      .mockResolvedValue({ idToken: 'old-token', accessToken: 'old-access' });
    jest
      .spyOn(authService, 'forceRefreshSession')
      .mockResolvedValue(null);

    let completed = false;
    let errored = false;

    http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe({
      next: () => { completed = true; },
      error: () => { errored = true; },
      complete: () => { completed = true; },
    });

    await new Promise((r) => setTimeout(r, 0));

    const req1 = httpTesting.expectOne('https://appsync.example.com/graphql');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    await new Promise((r) => setTimeout(r, 0));

    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should pass through non-401 errors', async () => {
    jest
      .spyOn(authService, 'getAuthSession')
      .mockResolvedValue({ idToken: 'token', accessToken: 'access' });

    let caughtError: HttpErrorResponse | null = null;

    http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe({
      error: (err) => { caughtError = err; },
    });

    await new Promise((r) => setTimeout(r, 0));

    const req1 = httpTesting.expectOne('https://appsync.example.com/graphql');
    req1.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });

    await new Promise((r) => setTimeout(r, 0));

    expect(caughtError).toBeTruthy();
    expect(caughtError!.status).toBe(500);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
