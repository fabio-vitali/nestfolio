import { Injectable } from '@angular/core';
import { getRuntimeConfig, RuntimeConfig } from './app.config';

/**
 * Injectable service that provides access to the runtime configuration.
 * The config is loaded at bootstrap via APP_INITIALIZER (loadRuntimeConfig),
 * so it is guaranteed to be available by the time any component or service injects this.
 *
 * Values always come from /assets/config.json — produced by
 * `pnpm nx run nestfolio-host:config --prefix=<prefix>`. No environment.ts
 * fallback exists; if the producer hasn't run, bootstrap fails hard.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  get config(): RuntimeConfig {
    return getRuntimeConfig();
  }

  get auth(): RuntimeConfig['auth'] {
    return this.config.auth;
  }

  get appsync(): RuntimeConfig['appsync'] {
    return this.config.appsync;
  }

  get copilotApiUrl(): string {
    return this.config.copilotApiUrl;
  }
}
