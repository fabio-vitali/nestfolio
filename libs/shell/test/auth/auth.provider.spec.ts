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

    // Run all APP_INITIALIZER factories.
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

  it('reads AuthConfig at injection time, not at provider-setup time', async () => {
    // Prove the factory is deferred: build providers BEFORE the AuthConfig
    // factory has a value to return, then assert Amplify.configure picks up
    // the value computed at inject() time.
    let regionAtInjectTime = 'unset';
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => ({
            userPoolId: 'pool',
            clientId: 'client',
            region: regionAtInjectTime,
          }),
        },
        provideAuth(),
      ],
    });

    // Mutate the closure variable AFTER providers are configured but BEFORE
    // the APP_INITIALIZER factories run.
    regionAtInjectTime = 'us-east-1';

    const initializers = TestBed.inject(APP_INITIALIZER);
    const initFns = (Array.isArray(initializers) ? initializers : [initializers])
      .map((fn: () => unknown) => fn());
    await Promise.all(initFns);

    // The injected AuthConfig.region must be the post-mutation value.
    const cfg = TestBed.inject(AuthConfig);
    expect(cfg.region).toBe('us-east-1');
  });
});
