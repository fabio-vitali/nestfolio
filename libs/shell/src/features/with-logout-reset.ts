import { inject } from '@angular/core';
import { signalStoreFeature, withHooks } from '@ngrx/signals';
import { patchState } from '@ngrx/signals';
import { LogoutOrchestrator } from '../logout-orchestrator';

export function withLogoutReset<State extends object>(resetState: () => Partial<State>) {
  return signalStoreFeature(
    withHooks({
      onInit(store) {
        const orchestrator = inject(LogoutOrchestrator);
        orchestrator.register(() => patchState(store, resetState()));
      },
    }),
  );
}
