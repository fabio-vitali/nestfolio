import { TestBed } from '@angular/core/testing';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { I18nService } from '../src/i18n.service';

describe('I18nService', () => {
  let service: I18nService;
  let translateService: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
    });
    service = TestBed.inject(I18nService);
    translateService = TestBed.inject(TranslateService);
  });

  it('should return default locale it-IT when no lang set', () => {
    expect(service.currentLocale).toBe('it-IT');
  });

  it('should set locale via TranslateService', () => {
    service.setLocale('en-GB');
    expect(translateService.currentLang).toBe('en-GB');
  });

  it('should delegate t() to TranslateService.instant()', () => {
    const spy = jest.spyOn(translateService, 'instant').mockReturnValue('Hello');
    const result = service.t('greeting', { name: 'World' });
    expect(spy).toHaveBeenCalledWith('greeting', { name: 'World' });
    expect(result).toBe('Hello');
  });

  it('should format currency', () => {
    const result = service.formatCurrency(1234.5);
    expect(result).toContain('1');
    expect(result).toContain('234');
  });

  it('should format date', () => {
    const result = service.formatDate(new Date(2025, 0, 15));
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should format date from string', () => {
    const result = service.formatDate('2025-01-15');
    expect(result).toBeTruthy();
  });

  it('should format percent', () => {
    const result = service.formatPercent(50);
    expect(result).toContain('50');
  });
});
