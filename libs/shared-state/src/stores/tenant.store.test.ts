import { TestBed } from '@angular/core/testing';
import { TenantStore } from './tenant.store';

describe('TenantStore', () => {
  let store: InstanceType<typeof TenantStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TenantStore);
  });

  it('should start with no tenant', () => {
    expect(store.tenant()).toBeNull();
  });

  it('should set tenant', () => {
    const tenant = { tenantId: 't1', tenantName: 'Acme', plan: 'premium' as const };
    store.setTenant(tenant);
    expect(store.tenant()).toEqual(tenant);
  });

  it('should clear tenant', () => {
    store.setTenant({ tenantId: 't1', tenantName: 'Acme', plan: 'free' });
    store.clearTenant();
    expect(store.tenant()).toBeNull();
  });
});
