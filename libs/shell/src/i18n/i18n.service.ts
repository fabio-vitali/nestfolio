import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import type { Locale } from '../models';
export type { Locale };

@Injectable({ providedIn: 'root' })
export class I18nService {
  private translate = inject(TranslateService);

  get currentLocale(): Locale {
    return (this.translate.currentLang as Locale) || 'it-IT';
  }

  setLocale(locale: Locale): void {
    this.translate.use(locale);
  }

  t(key: string, params?: Record<string, string | number>): string {
    return this.translate.instant(key, params) as string;
  }

  formatCurrency(amount: number, currency = 'EUR'): string {
    return new Intl.NumberFormat(this.currentLocale, {
      style: 'currency',
      currency,
    }).format(amount);
  }

  formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(this.currentLocale, options ?? {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  }

  formatPercent(value: number, decimals = 2): string {
    return new Intl.NumberFormat(this.currentLocale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value / 100);
  }
}
