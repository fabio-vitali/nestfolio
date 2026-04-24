const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'investor-mfe',
  exposes: {
    './routes': 'apps/investor-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
