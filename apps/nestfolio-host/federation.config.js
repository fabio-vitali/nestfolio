const { withNativeFederation } = require('@angular-architects/native-federation/config');
const { sharedFrontendDeps, sharedMappings } = require('@nestfolio/frontend-deps');

module.exports = withNativeFederation({
  shared: { ...sharedFrontendDeps },
  sharedMappings,
  skip: [],
});
