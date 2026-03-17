import { readFileSync } from 'fs';
import { join } from 'path';

const cache = new Map<string, string>();

export function loadPrompt(agentType: string): string {
  const cached = cache.get(agentType);
  if (cached) return cached;
  const filePath = join(__dirname, `${agentType}.txt`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(agentType, content);
  return content;
}
