import { groupByPhase, PipelineConfig } from '../src/discover-services';

const mockConfigs: PipelineConfig[] = [
  { service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1, production: { regions: ['us-east-1'], parallelDeploy: true }, dependencies: [] },
  { service: 'investor-web', subsystem: 'investor', deploymentPhase: 2, production: { regions: ['us-east-1'], parallelDeploy: false }, dependencies: ['investor-hub'] },
  { service: 'investor-bff', subsystem: 'investor', deploymentPhase: 3, production: { regions: ['us-east-1'], parallelDeploy: true }, dependencies: ['investor-hub'] },
  { service: 'advisory-hub', subsystem: 'advisory', deploymentPhase: 1, production: { regions: ['us-east-1'], parallelDeploy: true }, dependencies: [] },
];

describe('groupByPhase', () => {
  it('groups services by deployment phase', () => {
    const phases = groupByPhase(mockConfigs);
    expect(phases.get(1)!.map(c => c.service)).toEqual(['investor-hub', 'advisory-hub']);
    expect(phases.get(2)!.map(c => c.service)).toEqual(['investor-web']);
    expect(phases.get(3)!.map(c => c.service)).toEqual(['investor-bff']);
  });

  it('returns empty map for empty input', () => {
    const phases = groupByPhase([]);
    expect(phases.size).toBe(0);
  });
});
