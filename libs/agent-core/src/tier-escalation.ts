import type { ModelTier } from './types';

const ESCALATION_ORDER: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];

export function buildEscalationPath(startTier: ModelTier): ModelTier[] {
  const startIndex = ESCALATION_ORDER.indexOf(startTier);
  if (startIndex === -1) return [startTier];
  return [...ESCALATION_ORDER.slice(startIndex)];
}
