import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { TenantContext } from '../models';
import { withDevtools } from '../features/with-devtools';

interface TenantState {
  tenant: TenantContext | null;
}

const initialState: TenantState = {
  tenant: null,
};

export const TenantStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    setTenant(tenant: TenantContext): void {
      patchState(store, { tenant });
    },
    clearTenant(): void {
      patchState(store, { tenant: null });
    },
  })),
  withDevtools('TenantStore'),
);
