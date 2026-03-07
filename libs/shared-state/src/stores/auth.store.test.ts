import { TestBed } from '@angular/core/testing';
import { AuthStore } from './auth.store';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AuthStore);
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
});
