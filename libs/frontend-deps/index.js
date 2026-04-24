const { share } = require('@angular-architects/native-federation/config');

const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto' };

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
  '@primeuix/themes': singletonOpts,
  'aws-amplify': singletonOpts,
  '@apollo/client': singletonOpts,
  'aws-appsync-auth-link': singletonOpts,
  'aws-appsync-subscription-link': singletonOpts,
  'graphql': singletonOpts,
  'primeicons': singletonOpts,
  'primeng': singletonOpts,
  'rxjs': singletonOpts,
  '@ag-ui/client': singletonOpts,
  '@copilotkitnext/angular': singletonOpts,
});

const sharedMappings = ['@nestfolio/ui', '@nestfolio/shell'];

module.exports = { sharedFrontendDeps, sharedMappings };
