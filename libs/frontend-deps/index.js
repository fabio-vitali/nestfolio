const { share } = require('@angular-architects/native-federation/config');

const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto' };
const singletonWithSecondaries = { ...singletonOpts, includeSecondaries: true };
const singletonNoSecondaries = { ...singletonOpts, includeSecondaries: false };

const sharedFrontendDeps = share({
  '@angular/animations': singletonOpts,
  '@angular/cdk': singletonOpts,
  '@angular/common': singletonOpts,
  '@angular/core': singletonOpts,
  '@angular/forms': singletonOpts,
  '@angular/platform-browser': singletonOpts,
  '@angular/platform-browser-dynamic': singletonOpts,
  '@angular/router': singletonOpts,
  '@angular/service-worker': singletonOpts,
  '@ngrx/signals': singletonOpts,
  '@ngx-translate/core': singletonOpts,
  '@ngx-translate/http-loader': singletonOpts,
  '@primeuix/themes': singletonWithSecondaries,
  // Explicit `includeSecondaries: false`: @primeuix/themes ships a glob `./*`
  // export, which `share()` walks to auto-discover the parent's `./tokens`
  // subpath under aura/, producing the non-existent `aura/tokens` resolution.
  // Suppressing secondary discovery forces a single concrete importmap entry.
  '@primeuix/themes/aura': singletonNoSecondaries,
  'aws-amplify': singletonOpts,
  '@apollo/client': singletonOpts,
  'aws-appsync-auth-link': singletonWithSecondaries,
  'aws-appsync-subscription-link': singletonWithSecondaries,
  'graphql': singletonWithSecondaries,
  'primeicons': singletonOpts,
  'primeng': singletonOpts,
  'rxjs': singletonOpts,
  'url': singletonOpts,
  '@ag-ui/client': singletonOpts,
  '@copilotkitnext/angular': singletonOpts,
});

const sharedMappings = [
  '@nestfolio/ui',
  '@nestfolio/ui/feature-flags',
  '@nestfolio/shell',
  '@nestfolio/shell/auth',
  '@nestfolio/shell/graphql',
  '@nestfolio/shell/i18n',
];

module.exports = { sharedFrontendDeps, sharedMappings };
