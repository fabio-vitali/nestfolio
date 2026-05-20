import { pickOnDemandPrice, type PricingRecord } from './usagetype-picker';

const sonnetRecords: PricingRecord[] = [
  // Anthropic in AmazonBedrockFoundationModels — us.* uses _Global, base no _Global
  { usagetype: 'USE1-MP:USE1_InputTokenCount_Global-Units', pricePerUnit: 3.0 },
  { usagetype: 'USE1-MP:USE1_OutputTokenCount_Global-Units', pricePerUnit: 15.0 },
  { usagetype: 'USE1-MP:USE1_InputTokenCount-Units', pricePerUnit: 3.3 },
  { usagetype: 'USE1-MP:USE1_OutputTokenCount-Units', pricePerUnit: 16.5 },
  { usagetype: 'USE1-MP:USE1_InputTokenCount_Global_Batch-Units', pricePerUnit: 1.5 },
  { usagetype: 'USE1-MP:USE1_CacheReadInputTokenCount-Units', pricePerUnit: 0.33 },
  { usagetype: 'USE1-MP:USE1_CacheWrite1hInputTokenCount_Global-Units', pricePerUnit: 6.0 },
  { usagetype: 'USE1-MP:USE1_Reserved_1Month_InputTPM_Geo-Units', pricePerUnit: 0.198 },
];

const novaRecords: PricingRecord[] = [
  // Amazon Nova in AmazonBedrock — flat naming, no _Global distinction
  { usagetype: 'USE1-NovaPro-input-tokens', pricePerUnit: 0.0008 },
  { usagetype: 'USE1-NovaPro-output-tokens', pricePerUnit: 0.0032 },
  { usagetype: 'USE1-NovaPro-input-tokens-priority', pricePerUnit: 0.0014 },
  { usagetype: 'USE1-NovaPro-output-tokens-flex', pricePerUnit: 0.0016 },
  { usagetype: 'USE1-NovaPro-cache-read-input-token-count', pricePerUnit: 0.0002 },
];

describe('pickOnDemandPrice', () => {
  describe('AmazonBedrockFoundationModels branch (Anthropic)', () => {
    it('us.* modelId picks _Global-Units input + output', () => {
      const r = pickOnDemandPrice(
        sonnetRecords,
        'us.anthropic.claude-sonnet-4-6',
        'AmazonBedrockFoundationModels',
      );
      expect(r.inputUSDPerMTok).toBeCloseTo(3.0);
      expect(r.outputUSDPerMTok).toBeCloseTo(15.0);
      expect(r.inputUsagetype).toMatch(/InputTokenCount_Global/);
    });

    it('base modelId picks non-_Global Units input + output', () => {
      const r = pickOnDemandPrice(
        sonnetRecords,
        'anthropic.claude-sonnet-4-6',
        'AmazonBedrockFoundationModels',
      );
      expect(r.inputUSDPerMTok).toBeCloseTo(3.3);
      expect(r.outputUSDPerMTok).toBeCloseTo(16.5);
    });

    it('excludes Batch / Cache / Reserved variants', () => {
      const r = pickOnDemandPrice(
        sonnetRecords,
        'us.anthropic.claude-sonnet-4-6',
        'AmazonBedrockFoundationModels',
      );
      expect(r.inputUsagetype).not.toMatch(/Batch|Cache|Reserved/);
    });

    it('throws when input or output record missing', () => {
      const partial: PricingRecord[] = [sonnetRecords[0]]; // only input, no output
      expect(() =>
        pickOnDemandPrice(partial, 'us.anthropic.claude-sonnet-4-6', 'AmazonBedrockFoundationModels'),
      ).toThrow(/missing on-demand output/);
    });
  });

  describe('AmazonBedrock branch (Nova / Llama / Mistral)', () => {
    it('picks bare -input-tokens / -output-tokens, excludes -priority/-flex/-batch/-cache-', () => {
      const r = pickOnDemandPrice(novaRecords, 'us.amazon.nova-pro-v1:0', 'AmazonBedrock');
      expect(r.inputUSDPerMTok).toBeCloseTo(0.0008 * 1000); // unit: 1K → 1M
      expect(r.outputUSDPerMTok).toBeCloseTo(0.0032 * 1000);
      expect(r.inputUsagetype).not.toMatch(/priority|flex|batch|cache-/);
    });
  });
});
