const { share } = require('@angular-architects/native-federation/config');

// Default singleton: includeSecondaries enabled. Most listed packages
// (Angular family especially) ship subpath exports their consumers
// import as bare specifiers (e.g. @angular/common/http) — those need
// importmap entries, which only the secondary-walker generates.
const singletonOpts = { singleton: true, strictVersion: true, requiredVersion: 'auto', includeSecondaries: true };

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
  // @apollo/client, graphql, aws-appsync-auth-link, and
  // aws-appsync-subscription-link are intentionally NOT shared. We hit a
  // dilemma:
  //   - With includeSecondaries: true, @apollo/client's secondary walker
  //     drags in graphql + aws-appsync-{auth,subscription}-link as
  //     federated chunks, and those packages have glob `./*` exports the
  //     walker can't enumerate (failure: 'graphql/language/printer.js' —
  //     see Plan D iter-3).
  //   - With includeSecondaries: false on @apollo/client only, its OWN
  //     subpaths (@apollo/client/core, /link/error etc.) drop out of the
  //     importmap (failure: '@apollo/client/core' — see Plan D iter-5).
  //
  // Cleanest exit: drop the whole Apollo + GraphQL + appsync-link cluster
  // from share() entirely. libs/shell's GraphqlService (the only consumer
  // of these packages) bundles them statically via esbuild's normal
  // module resolution. Bounded duplication: libs/shell is a sharedMapping
  // (single chunk regardless of how many MFEs consume it).
  'primeicons': singletonOpts,
  'primeng': singletonOpts,
  'rxjs': singletonOpts,
  // `url` is intentionally NOT shared — same reason as the Apollo/graphql
  // cluster directly above. The two consumers, `aws-appsync-auth-link` and
  // `aws-appsync-subscription-link`, both call the legacy Node `url.parse()`
  // (auth-link/index.mjs:351,362,408,548 + subscription-link/index.mjs:3106).
  // The `url@0.11.4` browserify CJS shim, when run through Native Federation's
  // shared-bundle pipeline, ends up with a single `export default _i()` —
  // namespace imports (`import * as Url from "url"`) then resolve to
  // `{ default: <urlModule> }` and `Url.parse` is undefined. Since
  // aws-appsync-* are themselves part of the Apollo cluster carve-out (already
  // bundled statically inside libs/shell's GraphqlService), keeping `url`
  // singleton'd buys nothing except a runtime crash on the first /dashboard
  // navigation. Bounded duplication: libs/shell is a sharedMapping, so the
  // url-shim ships exactly once across all MFEs.
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
