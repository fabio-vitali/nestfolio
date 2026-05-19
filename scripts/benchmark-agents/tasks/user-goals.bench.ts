import { userGoalsConfig } from '../../../services/advisory/investor-profile-ctrl/src/agents/user-goals.config';

export const benchConfig = {
  taskName: 'user-goals' as const,
  service: 'investor-profile-ctrl' as const,
  configFilePath: 'services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts',
  fixturePath: 'benchmarks/fixtures/user-goals.input.json',
  productionConfig: userGoalsConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-6',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
  ],
};
