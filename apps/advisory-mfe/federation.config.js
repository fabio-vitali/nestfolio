const { withNativeFederation, share } = require('@angular-architects/native-federation/config');

const sharedFrontendDeps = share({
  '@angular/animations': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/cdk': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/common': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/forms': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/platform-browser': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/platform-browser-dynamic': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/router': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@angular/service-worker': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngrx/signals': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngx-translate/core': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@ngx-translate/http-loader': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@primeuix/themes': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'aws-amplify': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  '@apollo/client': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'aws-appsync-auth-link': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'aws-appsync-subscription-link': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'graphql': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'primeicons': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'primeng': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
  'rxjs': { singleton: true, strictVersion: true, requiredVersion: 'auto' },
});

module.exports = withNativeFederation({
  name: 'advisory-mfe',
  exposes: {
    './routes': 'apps/advisory-mfe/src/app/remote-routes.ts',
  },
  shared: {
    ...sharedFrontendDeps,
  },
  sharedMappings: ['@nestfolio/ui', '@nestfolio/shell'],
  skip: [],
});
