const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'agent-orchestrator',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/event-types$': '<rootDir>/../event-types/src/index.ts',
  },
};
