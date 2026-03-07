import * as fs from 'fs';
import * as path from 'path';

import { AgentType } from '../model-config';

const templateCache = new Map<AgentType, string>();

/**
 * Loads the system prompt template for a given agent type.
 * Templates are read from .txt files co-located in the prompt-templates directory.
 * Results are cached after first load.
 *
 * @throws if the template file does not exist
 */
export function loadPromptTemplate(agentType: AgentType): string {
  const cached = templateCache.get(agentType);
  if (cached) {
    return cached;
  }

  const templatePath = path.join(__dirname, `${agentType}.txt`);

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Prompt template not found for agent type "${agentType}" at ${templatePath}`,
    );
  }

  const template = fs.readFileSync(templatePath, 'utf-8').trim();
  templateCache.set(agentType, template);
  return template;
}

/**
 * Clears the template cache. Useful for testing.
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}
