import type { ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';

interface MarketAnalysisOutput {
  signals: Array<{ type: string; ticker: string; sentiment: string; confidence: number; source: string }>;
  tickersMentioned: string[];
  marketOutlook: string;
  confidenceScore: number;
}

function ok(): ValidationResult { return { valid: true, errors: [] }; }
function fail(errors: string[]): ValidationResult { return { valid: false, errors }; }

export const marketResearchValidationRule: ValidationRule<MarketAnalysisOutput> = {
  validate(output: MarketAnalysisOutput): ValidationResult {
    const errors: string[] = [];

    if (output.signals.length < 1) {
      errors.push('At least 1 signal is required');
    }

    const tickers = output.signals.map((s) => s.ticker);
    const uniqueTickers = new Set(tickers);
    if (uniqueTickers.size !== tickers.length) {
      errors.push('Duplicate tickers found in signals');
    }

    if (output.marketOutlook.length < 20) {
      errors.push(`marketOutlook length ${output.marketOutlook.length} must be >= 20 characters`);
    }

    const signalTickers = new Set(tickers);
    for (const ticker of signalTickers) {
      if (!output.tickersMentioned.includes(ticker)) {
        errors.push(`tickersMentioned is missing signal ticker '${ticker}'`);
      }
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};
