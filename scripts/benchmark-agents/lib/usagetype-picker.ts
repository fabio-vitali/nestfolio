/* usagetype-picker.ts — pick on-demand token-price records from a
 * pricing API response. Vendor-aware via serviceCode:
 *
 *   AmazonBedrockFoundationModels:
 *     - us.* IDs → usagetype matches *_InputTokenCount_Global-Units
 *     - base IDs → usagetype matches *_InputTokenCount-Units (no _Global)
 *     - exclude Batch / Cache / Reserved_ / LongContext / CrossGeo
 *
 *   AmazonBedrock:
 *     - any ID → usagetype matches *-input-tokens or *-output-tokens exactly
 *     - exclude -priority / -flex / -batch / -cache-
 *
 * Prices in this module are normalized to USD per *million* tokens.
 *   AmazonBedrockFoundationModels publishes per-token-Count "Units" (already MTok-scaled).
 *   AmazonBedrock publishes per "1K tokens" — multiply by 1000.
 */

export interface PricingRecord {
  readonly usagetype: string;
  readonly pricePerUnit: number;
}

export interface OnDemandPrices {
  readonly inputUSDPerMTok: number;
  readonly outputUSDPerMTok: number;
  readonly inputUsagetype: string;
  readonly outputUsagetype: string;
}

type ServiceCode = 'AmazonBedrock' | 'AmazonBedrockFoundationModels';

function isUsStar(modelId: string): boolean {
  return modelId.startsWith('us.');
}

function pickFoundationModels(
  records: readonly PricingRecord[],
  isUs: boolean,
  kind: 'Input' | 'Output',
): PricingRecord | undefined {
  const exclude = /Batch|Cache|Reserved_|LongContext|CrossGeo/;
  return records.find((r) => {
    if (exclude.test(r.usagetype)) return false;
    const hasGlobal = /_Global-Units$/.test(r.usagetype);
    if (isUs && !hasGlobal) return false;
    if (!isUs && hasGlobal) return false;
    return new RegExp(`_${kind}TokenCount(_Global)?-Units$`).test(r.usagetype);
  });
}

function pickBedrock(
  records: readonly PricingRecord[],
  kind: 'input' | 'output',
): PricingRecord | undefined {
  const exclude = /-priority|-flex|-batch|-cache-/;
  return records.find((r) => {
    if (exclude.test(r.usagetype)) return false;
    return new RegExp(`-${kind}-tokens$`).test(r.usagetype);
  });
}

export function pickOnDemandPrice(
  records: readonly PricingRecord[],
  modelId: string,
  serviceCode: ServiceCode,
): OnDemandPrices {
  if (serviceCode === 'AmazonBedrockFoundationModels') {
    const isUs = isUsStar(modelId);
    const inputRec = pickFoundationModels(records, isUs, 'Input');
    const outputRec = pickFoundationModels(records, isUs, 'Output');
    if (!inputRec) throw new Error(`usagetype-picker: missing on-demand input record for ${modelId}`);
    if (!outputRec) throw new Error(`usagetype-picker: missing on-demand output record for ${modelId}`);
    // AmazonBedrockFoundationModels publishes prices already in per-MTok units.
    return {
      inputUSDPerMTok: inputRec.pricePerUnit,
      outputUSDPerMTok: outputRec.pricePerUnit,
      inputUsagetype: inputRec.usagetype,
      outputUsagetype: outputRec.usagetype,
    };
  }
  // AmazonBedrock
  const inputRec = pickBedrock(records, 'input');
  const outputRec = pickBedrock(records, 'output');
  if (!inputRec) throw new Error(`usagetype-picker: missing on-demand input record for ${modelId}`);
  if (!outputRec) throw new Error(`usagetype-picker: missing on-demand output record for ${modelId}`);
  // AmazonBedrock publishes per-1K tokens; convert to per-MTok.
  return {
    inputUSDPerMTok: inputRec.pricePerUnit * 1000,
    outputUSDPerMTok: outputRec.pricePerUnit * 1000,
    inputUsagetype: inputRec.usagetype,
    outputUsagetype: outputRec.usagetype,
  };
}
