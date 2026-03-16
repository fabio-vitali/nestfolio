// Handler for AgentCore Gateway tool: instrument-universe
// Returns the approved instrument universe for portfolio construction
import { logger } from '@nestfolio/event-processor';

const DEFAULT_UNIVERSE = [
  { ticker: 'VTI', name: 'Vanguard Total Stock Market', assetClass: 'EQUITY', region: 'US', expenseRatio: 0.03, riskCategory: 'MEDIUM' },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock', assetClass: 'EQUITY', region: 'INTL', expenseRatio: 0.07, riskCategory: 'MEDIUM_HIGH' },
  { ticker: 'BND', name: 'Vanguard Total Bond Market', assetClass: 'FIXED_INCOME', region: 'US', expenseRatio: 0.03, riskCategory: 'LOW' },
  { ticker: 'BNDX', name: 'Vanguard Total International Bond', assetClass: 'FIXED_INCOME', region: 'INTL', expenseRatio: 0.07, riskCategory: 'LOW' },
  { ticker: 'VNQ', name: 'Vanguard Real Estate', assetClass: 'REAL_ESTATE', region: 'US', expenseRatio: 0.12, riskCategory: 'MEDIUM_HIGH' },
  { ticker: 'VTIP', name: 'Vanguard Short-Term Inflation-Protected', assetClass: 'FIXED_INCOME', region: 'US', expenseRatio: 0.04, riskCategory: 'LOW' },
  { ticker: 'VWO', name: 'Vanguard Emerging Markets', assetClass: 'EQUITY', region: 'EM', expenseRatio: 0.08, riskCategory: 'HIGH' },
  { ticker: 'VGSH', name: 'Vanguard Short-Term Treasury', assetClass: 'FIXED_INCOME', region: 'US', expenseRatio: 0.04, riskCategory: 'VERY_LOW' },
];

export const handler = async (_event: Record<string, unknown>): Promise<unknown> => {
  logger.info('Instrument universe lookup');

  // In production, would load from DynamoDB CONFIG table
  return { instruments: DEFAULT_UNIVERSE };
};
