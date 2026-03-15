jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { UserRegisteredPipe } from '../../src/pipes/user-registered.pipe';

describe('UserRegisteredPipe', () => {
  const mockCreateProfile = jest.fn();

  const mockRepository = { createProfile: mockCreateProfile } as any;

  let pipe: UserRegisteredPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new UserRegisteredPipe(mockRepository);
  });

  it('should create an investor profile for a new USER_REGISTERED event', async () => {
    mockCreateProfile.mockResolvedValue(true);

    const uow: UnitOfWork<BusEvent<{ userId: string; tenantId: string; email: string }>> = {
      event: {
        id: 'evt-1',
        type: 'USER_REGISTERED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { userId: 'u1', tenantId: 't1', email: 'test@example.com' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockCreateProfile).toHaveBeenCalledWith('t1', 'u1', 'test@example.com', 'evt-1');
  });

  it('should skip duplicate events when createProfile returns false', async () => {
    mockCreateProfile.mockResolvedValue(false);

    const uow: UnitOfWork<BusEvent<{ userId: string; tenantId: string; email: string }>> = {
      event: {
        id: 'evt-dup',
        type: 'USER_REGISTERED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { userId: 'u1', tenantId: 't1', email: 'test@example.com' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockCreateProfile).toHaveBeenCalledWith('t1', 'u1', 'test@example.com', 'evt-dup');
    // Should not throw — just returns early
  });
});
