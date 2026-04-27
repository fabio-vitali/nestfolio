import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig, fetchRuntimeConfig } from './app/app.config';

await fetchRuntimeConfig();

// eslint-disable-next-line no-console
bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
