export const GET_FEATURE_FLAGS = `
  query GetFeatureFlags {
    getFeatureFlags {
      name
      enabled
      reason
    }
  }
`;

export const ON_FEATURE_FLAG_UPDATE = `
  subscription OnFeatureFlagUpdate {
    onFeatureFlagUpdate {
      name
      enabled
      reason
    }
  }
`;
