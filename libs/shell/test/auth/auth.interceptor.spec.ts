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
import { authInterceptor } from '../src/auth.interceptor';
import { AuthInterceptorState } from '../src/auth-interceptor-state.service';
import * as authService from '../src/auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let router: Router;
  let interceptorState: AuthInterceptorState;

  beforeEach(() => {
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
    interceptorState = TestBed.inject(AuthInterceptorState);
    interceptorState.reset();
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

    await new Promise((r) => setTimeout(r, 0));

    const req1 = httpTesting.expectOne('https://appsync.example.com/graphql');
    expect(req1.request.headers.get('Authorization')).toBe('old-token');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    await new Promise((r) => setTimeout(r, 0));

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

    http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe({
      next: () => {},
      error: () => {},
      complete: () => {},
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

  it('should pass through requests to /assets/', () => {
    const spy = jest.spyOn(authService, 'getAuthSession');

    http.get('/assets/config.json', { responseType: 'text' }).subscribe();

    const req = httpTesting.expectOne('/assets/config.json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    req.flush('{}');
  });

  it('should pass through non-appsync requests', () => {
    const spy = jest.spyOn(authService, 'getAuthSession');

    http.get('https://other-api.com/data', { responseType: 'text' }).subscribe();

    const req = httpTesting.expectOne('https://other-api.com/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    req.flush('ok');
  });

  it('should add Authorization header when tokens available', async () => {
    jest
      .spyOn(authService, 'getAuthSession')
      .mockResolvedValue({ idToken: 'my-id-token', accessToken: 'my-access' });

    http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe();

    await new Promise((r) => setTimeout(r, 0));

    const req = httpTesting.expectOne('https://appsync.example.com/graphql');
    expect(req.request.headers.get('Authorization')).toBe('my-id-token');
    req.flush('ok');
  });

  it('should dedup concurrent session requests', async () => {
    const spy = jest
      .spyOn(authService, 'getAuthSession')
      .mockResolvedValue({ idToken: 'shared-token', accessToken: 'acc' });

    http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe();
    http.get('https://appsync.example.com/graphql', { responseType: 'text' }).subscribe();

    expect(spy).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 0));

    const reqs = httpTesting.match('https://appsync.example.com/graphql');
    expect(reqs.length).toBe(2);
    expect(reqs[0].request.headers.get('Authorization')).toBe('shared-token');
    expect(reqs[1].request.headers.get('Authorization')).toBe('shared-token');
    reqs[0].flush('ok');
    reqs[1].flush('ok');
  });

  it('should use injectable AuthInterceptorState', () => {
    expect(interceptorState).toBeDefined();
    expect(interceptorState.startRetry()).toBe(true);
    expect(interceptorState.startRetry()).toBe(false);
    interceptorState.endRetry();
    expect(interceptorState.startRetry()).toBe(true);
    interceptorState.reset();
  });
});
