export const environment = {
  production: false,
  auth: {
    userPoolId: 'us-east-1_PLACEHOLDER',
    clientId: 'PLACEHOLDER_CLIENT_ID',
    region: 'us-east-1',
  },
  appsync: {
    investorBff: {
      endpoint: 'https://placeholder.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
    },
    portfolioBff: {
      endpoint: 'https://placeholder.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
    },
    advisoryBff: {
      endpoint: 'https://placeholder.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
    },
    dashboardBff: {
      endpoint: 'https://placeholder.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
    },
    ledgerBff: {
      endpoint: 'https://placeholder.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
    },
  },
};
