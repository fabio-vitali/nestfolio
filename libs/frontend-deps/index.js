const { share } = require('@angular-architects/native-federation/config');

const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto' };
const singletonWithSecondaries = { ...singletonOpts, includeSecondaries: true };

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
  // @primeuix/themes is intentionally NOT shared. It ships a glob `./*` export
  // that maps any subpath (including unused virtual ones like `aura/tokens`)
  // to ./dist/<subpath>/index.mjs. Native Federation's includeSecondaries
  // walker doesn't enumerate glob patterns, so the runtime importmap can never
  // contain entries for `aura/<component>` — and the aura/index.mjs module
  // imports each component at runtime via the federation importmap. Bundling
  // statically inside libs/ui (the only consumer of nestfolio-preset.ts)
  // sidesteps the resolution path entirely; aura's relative `./accordion`
  // imports get inlined by esbuild at build time. Bounded duplication: only
  // libs/ui imports @primeuix/themes, and libs/ui is a sharedMapping.
  'aws-amplify': singletonOpts,
  '@apollo/client': singletonOpts,
  // graphql, aws-appsync-auth-link, and aws-appsync-subscription-link are
  // intentionally NOT shared. Same root cause as @primeuix/themes (above):
  // their federated chunks bare-specifier-import internal subpaths
  // (e.g. graphql/language/printer.js) which Native Federation's
  // includeSecondaries walker doesn't enumerate. Each consumer (primarily
  // libs/shell's GraphqlService) bundles them statically via esbuild's
  // normal module resolution, sidestepping the runtime importmap. Bounded
  // duplication: libs/shell is a sharedMapping (single chunk).
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
