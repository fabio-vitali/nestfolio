const { share } = require('@angular-architects/native-federation/config');

// Default singleton: includeSecondaries enabled. Most listed packages
// (Angular family especially) ship subpath exports their consumers
// import as bare specifiers (e.g. @angular/common/http) — those need
// importmap entries, which only the secondary-walker generates.
const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto', includeSecondaries: true };

// Variant that suppresses the walker. Use for packages whose secondary
// surface pulls in problematic transitive packages (e.g. @apollo/client
// drags graphql + aws-appsync-{auth,subscription}-link into the share
// surface, and those packages have glob `./*` exports that the walker
// can't enumerate, leading to runtime "Unable to resolve specifier"
// errors for subpaths like graphql/language/printer.js).
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
  // @apollo/client uses singletonNoSecondaries because its secondary surface
  // (peer deps + transitive imports) drags in graphql + aws-appsync-{auth,
  // subscription}-link, all of which have glob exports that the walker
  // can't enumerate (see graphql/language/printer.js failure mode).
  // libs/shell's GraphqlService is the primary consumer; it bundles
  // @apollo/client's transitive imports statically via esbuild.
  '@apollo/client': singletonNoSecondaries,
  // graphql, aws-appsync-auth-link, and aws-appsync-subscription-link are
  // intentionally NOT shared. Same root cause as @primeuix/themes (above).
  // Each consumer (primarily libs/shell's GraphqlService) bundles them
  // statically via esbuild's normal module resolution. Bounded duplication:
  // libs/shell is a sharedMapping (single chunk).
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
