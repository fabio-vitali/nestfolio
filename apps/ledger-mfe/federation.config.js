const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'ledger-mfe',
  exposes: {
    './routes': 'apps/ledger-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
