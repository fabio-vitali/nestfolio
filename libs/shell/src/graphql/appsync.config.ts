import { InjectionToken } from '@angular/core';

export interface AppSyncConfig {
  endpoint: string;
  region: string;
}

export const APPSYNC_CONFIG = new InjectionToken<AppSyncConfig>('APPSYNC_CONFIG');
