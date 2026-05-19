import { explainabilityConfig } from '../../../services/advisory/advisory-narrative-ctrl/src/agents/explainability.config';

export const benchConfig = {
  taskName: 'explainability' as const,
  service: 'advisory-narrative-ctrl' as const,
  configFilePath: 'services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts',
  fixturePath: 'benchmarks/fixtures/explainability.input.json',
  productionConfig: explainabilityConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-6',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
    'us.meta.llama3-3-70b-instruct-v1:0',
    'us.mistral.pixtral-large-2502-v1:0',
  ],
};
