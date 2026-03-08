const mockNavigate = jest.fn().mockResolvedValue(true);

jest.mock('@angular/core', () => ({
  inject: () => ({ navigate: mockNavigate }),
}));

jest.mock('@angular/router', () => ({
  Router: class {},
}));

const mockGetAuthSession = jest.fn();

jest.mock('./auth.service', () => ({
  getAuthSession: (...args: unknown[]) => mockGetAuthSession(...args),
}));

import { authInterceptor, _resetInflightSession } from './auth.interceptor';
import { Observable, firstValueFrom } from 'rxjs';

// Minimal HttpRequest-like object
function makeReq(url: string) {
  return {
    url,
    clone: (opts: { setHeaders: Record<string, string> }) => ({
      url,
      headers: opts.setHeaders,
    }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeNext(response: Record<string, unknown> = { status: 200 }): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (req: any) => {
    return new Observable((sub) => {
      sub.next({ ...response, _req: req });
      sub.complete();
    });
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetInflightSession();
});

describe('authInterceptor', () => {
  it('should pass through requests to /assets/', async () => {
    const req = makeReq('/assets/config.json');
    const next = makeNext();

    const result = await firstValueFrom(authInterceptor(req, next));
    expect(result).toBeDefined();
    expect(mockGetAuthSession).not.toHaveBeenCalled();
  });

  it('should pass through non-appsync requests', async () => {
    const req = makeReq('https://other-api.com/data');
    const next = makeNext();

    const result = await firstValueFrom(authInterceptor(req, next));
    expect(result).toBeDefined();
    expect(mockGetAuthSession).not.toHaveBeenCalled();
  });

  it('should add Authorization header when tokens available', async () => {
    mockGetAuthSession.mockResolvedValue({
      idToken: 'test-id-token',
      accessToken: 'test-access-token',
    });

    const req = makeReq('https://example.appsync-api.com/graphql');
    const next = makeNext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await firstValueFrom(authInterceptor(req, next));
    expect(result._req.headers.Authorization).toBe('test-id-token');
  });

  it('should redirect to /login when no tokens (session expired)', async () => {
    mockGetAuthSession.mockResolvedValue(null);

    const req = makeReq('https://example.appsync-api.com/graphql');
    const next = makeNext();

    await expect(firstValueFrom(authInterceptor(req, next))).rejects.toThrow('Session expired');
    expect(mockNavigate).toHaveBeenCalledWith(['/login']);
  });

  it('should redirect to /login when getAuthSession throws', async () => {
    mockGetAuthSession.mockRejectedValue(new Error('Network error'));

    const req = makeReq('https://example.appsync-api.com/graphql');
    const next = makeNext();

    await expect(firstValueFrom(authInterceptor(req, next))).rejects.toThrow('Session expired');
    expect(mockNavigate).toHaveBeenCalledWith(['/login']);
  });

  it('should dedup concurrent session requests', async () => {
    let resolveSession!: (v: unknown) => void;
    mockGetAuthSession.mockImplementation(
      () => new Promise((resolve) => { resolveSession = resolve; }),
    );

    const req1 = makeReq('https://example.appsync-api.com/graphql');
    const req2 = makeReq('https://example.appsync-api.com/graphql');
    const next = makeNext();

    const p1 = firstValueFrom(authInterceptor(req1, next));
    const p2 = firstValueFrom(authInterceptor(req2, next));

    // Both calls should share the same session promise
    expect(mockGetAuthSession).toHaveBeenCalledTimes(1);

    resolveSession({ idToken: 'shared-token', accessToken: 'acc' });

    const [r1, r2] = await Promise.all([p1, p2]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r1 as any)._req.headers.Authorization).toBe('shared-token');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r2 as any)._req.headers.Authorization).toBe('shared-token');
  });
});
