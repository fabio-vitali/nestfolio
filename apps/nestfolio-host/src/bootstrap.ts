// `aws-appsync-subscription-link` (bundled inside libs/shell's GraphqlService)
// uses Node's `Buffer` API for base64url encoding the WS subprotocol auth
// header. Browsers don't expose `Buffer` globally — polyfill it before any
// subscription handshake runs.
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig, fetchRuntimeConfig } from './app/app.config';

await fetchRuntimeConfig();

// eslint-disable-next-line no-console
bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
