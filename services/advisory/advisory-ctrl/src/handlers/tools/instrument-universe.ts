// Handler for AgentCore Gateway tool: instrument-universe
// Returns the approved instrument universe for portfolio construction
import { logger } from '@nestfolio/platform-core';

const APPROVED_UNIVERSE = [
  { ticker: 'VTI', name: 'Vanguard Total Stock Market', assetClass: 'EQUITY', region: 'US' },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock', assetClass: 'EQUITY', region: 'INTL' },
  { ticker: 'BND', name: 'Vanguard Total Bond Market', assetClass: 'FIXED_INCOME', region: 'US' },
  { ticker: 'BNDX', name: 'Vanguard Total International Bond', assetClass: 'FIXED_INCOME', region: 'INTL' },
  { ticker: 'VNQ', name: 'Vanguard Real Estate', assetClass: 'REAL_ESTATE', region: 'US' },
  { ticker: 'VTIP', name: 'Vanguard Short-Term Inflation-Protected', assetClass: 'FIXED_INCOME', region: 'US' },
  { ticker: 'VWO', name: 'Vanguard Emerging Markets', assetClass: 'EQUITY', region: 'EM' },
  { ticker: 'VGSH', name: 'Vanguard Short-Term Treasury', assetClass: 'FIXED_INCOME', region: 'US' },
];

export const handler = async (_event: Record<string, unknown>): Promise<unknown> => {
  logger.info('Instrument universe lookup');
  return { instruments: APPROVED_UNIVERSE };
};
