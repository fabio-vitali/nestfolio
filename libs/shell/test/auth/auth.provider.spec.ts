jest.mock('aws-amplify', () => ({
  Amplify: { configure: jest.fn() },
}));

import { APP_INITIALIZER } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from '../../src/auth/auth.config';
import { provideAuth } from '../../src/auth/auth.provider';

describe('provideAuth()', () => {
  beforeEach(() => {
    (Amplify.configure as jest.Mock).mockClear();
  });

  it('configures Amplify with values resolved via inject(AuthConfig)', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => ({
            userPoolId: 'pool-from-factory',
            clientId: 'client-from-factory',
            region: 'us-east-1',
          }),
        },
        provideAuth(),
      ],
    });

    const initializers = TestBed.inject(APP_INITIALIZER);
    const initFns = (Array.isArray(initializers) ? initializers : [initializers])
      .map((fn: () => unknown) => fn());
    await Promise.all(initFns);

    expect(Amplify.configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: {
          userPoolId: 'pool-from-factory',
          userPoolClientId: 'client-from-factory',
        },
      },
    });
  });

  it('reads AuthConfig at APP_INITIALIZER factory-resolution time', () => {
    // The factory captures cfg via inject(AuthConfig) at hydration time.
    // The host (apps/nestfolio-host) guarantees fetchRuntimeConfig has
    // already populated runtimeConfig before bootstrap, so this is safe.
    const factoryCalls: string[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => {
            factoryCalls.push('AuthConfig.useFactory');
            return { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' };
          },
        },
        provideAuth(),
      ],
    });

    TestBed.inject(APP_INITIALIZER);
    expect(factoryCalls).toContain('AuthConfig.useFactory');
  });
});
