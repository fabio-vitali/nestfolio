import { InjectionToken } from '@angular/core';

/**
 * BFF domain literal for the active route — one of 'investor' | 'advisory' |
 * 'dashboard' | 'ledger'. Wired by provideMfeGraphql(domain) in route providers.
 */
export const MFE_DOMAIN = new InjectionToken<string>('MFE_DOMAIN');
