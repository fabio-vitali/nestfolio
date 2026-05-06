import { formatStructuredOutputPrompt } from '@nestfolio/agent-orchestrator';

const marketResearchSchemaShape = `{
  "signals": [
    {
      "type": "TECHNICAL",
      "ticker": "SPY",
      "sentiment": "BULLISH",
      "confidence": 0.78,
      "source": "RSI 55 + 50DMA above 200DMA"
    },
    {
      "type": "MACRO",
      "ticker": "TLT",
      "sentiment": "BEARISH",
      "confidence": 0.65,
      "source": "Fed terminal-rate guidance + 10Y yield breakout"
    }
  ],
  "tickersMentioned": ["SPY", "TLT", "QQQ"],
  "marketOutlook": "Equities show resilient breadth with technicals constructive; long-duration bonds remain pressured by hawkish rate path. Tilt slightly risk-on with diversification across sectors.",
  "confidenceScore": 0.74
}`;

export const marketResearchPrompt = formatStructuredOutputPrompt({
  role: 'market research analyst',
  task: 'Given the current market context and upstream decision outputs, analyze market conditions relevant to the investment decision. Use the knowledge-base context (news, sentiment, macro) and any deterministic tool data provided in the Input.',
  schemaShape: marketResearchSchemaShape,
  rules: [
    'signals MUST be a non-empty array. Every entry MUST include type (e.g. TECHNICAL, FUNDAMENTAL, MACRO, NEWS, SENTIMENT), ticker (string), sentiment (BULLISH | BEARISH | NEUTRAL), confidence (number in [0, 1]), and source (string explaining the basis for the signal).',
    'tickersMentioned MUST be an array of unique tickers referenced in the signals or marketOutlook; MUST be present even if empty when no tickers are referenced.',
    'marketOutlook MUST be a non-empty narrative string summarising the overall market view in 1-3 sentences.',
    'confidenceScore MUST be a number in [0, 1] reflecting the model\'s aggregate confidence in this analysis.',
    'Do NOT fabricate tickers or signals; if the upstream context is sparse, emit a smaller signals array with high source-quality entries rather than inventing data.',
  ],
});
