import { effect } from '@angular/core';
import { signalStoreFeature, withHooks, getState } from '@ngrx/signals';

export function withDevtools(name: string) {
  return signalStoreFeature(
    withHooks({
      onInit(store) {
        if (typeof window === 'undefined') return;
        const devtools = (window as any).__REDUX_DEVTOOLS_EXTENSION__;
        if (!devtools) return;

        const instance = devtools.connect({ name: `[Nestfolio] ${name}` });
        instance.init(getState(store));

        effect(() => {
          const state = getState(store);
          instance.send({ type: `[${name}] state update` }, state);
        });
      },
    }),
  );
}
