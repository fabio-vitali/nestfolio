const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'test-support',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  moduleNameMapper: {
    '^@nestfolio/test-contracts$': '<rootDir>/../test-contracts/src/index.ts',
    '^@nestfolio/investor-adpt/domain$': '<rootDir>/../../services/investor/investor-adpt/src/domain/index.ts',
    '^@nestfolio/investor-bff/contracts$': '<rootDir>/../../services/investor/investor-bff/src/domain/contracts.ts',
    '^@nestfolio/decision-workflow-ctrl/contracts$': '<rootDir>/../../services/advisory/decision-workflow-ctrl/src/domain/contracts.ts',
    // transitive: test-contracts → investor-adpt/domain → events.ts → event-types
    '^@nestfolio/event-types$': '<rootDir>/../event-types/src/index.ts',
  },
};
