import { EnvironmentProviders } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { NestfolioPreset } from './nestfolio-preset';

export type UiTheme = 'light' | 'dark';

export function provideNestfolioTheme(theme: UiTheme = 'light'): EnvironmentProviders {
  return providePrimeNG({
    theme: {
      preset: NestfolioPreset,
      options: {
        darkModeSelector: theme === 'dark' ? '.dark' : 'none',
      },
    },
    ripple: true,
  });
}
