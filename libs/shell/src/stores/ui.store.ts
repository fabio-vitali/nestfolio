import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { ThemeMode, Locale } from '../models';
import { withDevtools } from '../features/with-devtools';

interface UiState {
  theme: ThemeMode;
  locale: Locale;
  loading: boolean;
}

const initialState: UiState = {
  theme: 'light',
  locale: 'it-IT',
  loading: false,
};

export const UiStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    setTheme(theme: ThemeMode): void {
      patchState(store, { theme });
    },
    toggleTheme(): void {
      patchState(store, { theme: store.theme() === 'light' ? 'dark' : 'light' });
    },
    setLocale(locale: Locale): void {
      patchState(store, { locale });
    },
    setLoading(loading: boolean): void {
      patchState(store, { loading });
    },
  })),
  withDevtools('UiStore'),
);
