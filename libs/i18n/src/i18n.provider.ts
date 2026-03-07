import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader, provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { importProvidersFrom } from '@angular/core';
import type { Locale } from './i18n.service';

export function provideI18n(defaultLocale: Locale = 'it-IT'): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...provideTranslateHttpLoader({
      prefix: './assets/i18n/',
      suffix: '.json',
    }),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: defaultLocale,
        loader: {
          provide: TranslateLoader,
          useClass: TranslateHttpLoader,
        },
      }),
    ),
  ]);
}
