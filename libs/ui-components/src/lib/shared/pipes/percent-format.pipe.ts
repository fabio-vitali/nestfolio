import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'percentFormat', standalone: true })
export class PercentFormatPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 2, locale = 'it-IT'): string {
    if (value == null) return '-';
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
}
