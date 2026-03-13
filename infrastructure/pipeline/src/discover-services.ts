import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface PipelineConfig {
  service: string;
  subsystem: string;
  deploymentPhase: number;
  production: { regions: string[]; parallelDeploy: boolean };
  dependencies: string[];
}

/**
 * Discovers all pipeline.json files under services/ and returns parsed configs.
 */
export function discoverServices(workspaceRoot: string): PipelineConfig[] {
  const configs: PipelineConfig[] = [];
  const servicesDir = join(workspaceRoot, 'services');

  for (const domain of readdirSync(servicesDir)) {
    const domainPath = join(servicesDir, domain);
    if (!statSync(domainPath).isDirectory()) continue;

    for (const service of readdirSync(domainPath)) {
      const pipelinePath = join(domainPath, service, 'pipeline.json');
      try {
        const raw = readFileSync(pipelinePath, 'utf8');
        const config = JSON.parse(raw) as PipelineConfig;
        configs.push(config);
      } catch {
        // No pipeline.json — skip
      }
    }
  }

  return configs.sort((a, b) => a.deploymentPhase - b.deploymentPhase);
}

/**
 * Groups services by deployment phase.
 */
export function groupByPhase(configs: PipelineConfig[]): Map<number, PipelineConfig[]> {
  const phases = new Map<number, PipelineConfig[]>();
  for (const config of configs) {
    const list = phases.get(config.deploymentPhase) ?? [];
    list.push(config);
    phases.set(config.deploymentPhase, list);
  }
  return phases;
}

/**
 * Resolves the filesystem path for a service.
 */
export function resolveServiceDir(workspaceRoot: string, svc: PipelineConfig): string {
  const servicesDir = join(workspaceRoot, 'services');

  // Try subsystem/service (the standard layout)
  const bySubsystem = join(servicesDir, svc.subsystem, svc.service);
  try {
    if (statSync(bySubsystem).isDirectory()) return bySubsystem;
  } catch { /* not found */ }

  // Scan all domain directories
  for (const domain of readdirSync(servicesDir)) {
    const candidate = join(servicesDir, domain, svc.service);
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch { /* not found */ }
  }

  throw new Error(`Cannot find service directory for ${svc.service}`);
}

/**
 * Dynamically loads the Stack class from a service's service.stack.ts.
 * Convention: the exported class whose name ends with "Stack".
 */
export function loadStackClass(serviceDir: string, serviceName: string): any {
  const modulePath = join(serviceDir, 'src', 'service.stack');
  const stackModule = require(modulePath);

  const StackClass = Object.values(stackModule).find(
    (v: any) => typeof v === 'function' && /Stack$/.test(v.name)
  );

  if (!StackClass) {
    throw new Error(`No class ending in "Stack" found in ${serviceName}/src/service.stack.ts`);
  }

  return StackClass;
}
