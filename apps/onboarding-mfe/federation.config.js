const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  name: 'onboarding-mfe',
  exposes: {
    './routes': 'apps/onboarding-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
