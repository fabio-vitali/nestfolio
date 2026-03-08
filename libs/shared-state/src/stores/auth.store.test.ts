import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth.store';
import { LogoutSignal } from '../logout-signal';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;
  let logoutSignal: LogoutSignal;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AuthStore);
    logoutSignal = TestBed.inject(LogoutSignal);
    store.reset();
  });

  it('should start with unknown status and no user', () => {
    expect(store.status()).toBe('unknown');
    expect(store.user()).toBeNull();
  });

  it('should set authenticated user', () => {
    const user = { userId: 'u1', username: 'test', email: 'test@test.com', tenantId: 't1' };
    store.setAuthenticated(user);
    expect(store.status()).toBe('authenticated');
    expect(store.user()).toEqual(user);
  });

  it('should set unauthenticated', () => {
    store.setAuthenticated({ userId: 'u1', username: 'test', email: 'test@test.com', tenantId: 't1' });
    store.setUnauthenticated();
    expect(store.status()).toBe('unauthenticated');
    expect(store.user()).toBeNull();
  });

  it('should update user partially', () => {
    store.setAuthenticated({ userId: 'u1', username: 'test', email: 'old@test.com', tenantId: 't1' });
    store.updateUser({ email: 'new@test.com' });
    expect(store.user()!.email).toBe('new@test.com');
    expect(store.user()!.userId).toBe('u1');
  });

  it('should reset to initial state', () => {
    store.setAuthenticated({ userId: 'u1', username: 'test', email: 'test@test.com', tenantId: 't1' });
    store.reset();
    expect(store.status()).toBe('unknown');
    expect(store.user()).toBeNull();
  });

  it('should logout: set unauthenticated and emit logout signal', () => {
    const emitSpy = jest.spyOn(logoutSignal, 'emit');
    store.setAuthenticated({ userId: 'u1', username: 'test', email: 'test@test.com', tenantId: 't1' });

    store.logout();

    expect(store.status()).toBe('unauthenticated');
    expect(store.user()).toBeNull();
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });
});
