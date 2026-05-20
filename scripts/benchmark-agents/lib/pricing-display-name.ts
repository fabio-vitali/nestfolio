/* pricing-display-name.ts — Bedrock modelId → AWS Pricing API identity
 * (serviceCode + the attribute/value pair that filters its records).
 *
 * Two service codes carry on-demand records for us:
 *   - AmazonBedrockFoundationModels: Anthropic, Cohere, Jamba, etc.
 *     (identity in `servicename` as "<Display> (Amazon Bedrock Edition)")
 *   - AmazonBedrock: Nova, Llama, Mistral, DeepSeek, Qwen, etc.
 *     (identity in `model` as "<Display>")
 *
 * The display-string for each vendor is derived by rule, not by per-model table.
 * New vendor prefixes that don't match any rule throw at refresh time.
 */

export interface PricingIdentity {
  readonly serviceCode: 'AmazonBedrock' | 'AmazonBedrockFoundationModels';
  readonly identityField: 'model' | 'servicename';
  readonly identityValue: string;
}

function stripRegion(modelId: string): string {
  return modelId.replace(/^(us|eu|apac|global)\./, '');
}

function anthropic(modelId: string): PricingIdentity {
  // anthropic.claude-sonnet-4-6 → "Claude Sonnet 4.6"
  // anthropic.claude-haiku-4-5-20251001 → "Claude Haiku 4.5"
  // anthropic.claude-opus-4-7 → "Claude Opus 4.7"
  const stripped = stripRegion(modelId);
  const m = /^anthropic\.claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(stripped);
  if (!m) throw new Error(`pricing-display-name: cannot parse Anthropic modelId: ${modelId}`);
  const family = m[1][0].toUpperCase() + m[1].slice(1); // Opus / Sonnet / Haiku
  const display = `Claude ${family} ${m[2]}.${m[3]} (Amazon Bedrock Edition)`;
  return {
    serviceCode: 'AmazonBedrockFoundationModels',
    identityField: 'servicename',
    identityValue: display,
  };
}

function nova(modelId: string): PricingIdentity {
  // us.amazon.nova-pro-v1:0 → "Nova Pro"
  const stripped = stripRegion(modelId);
  const m = /^amazon\.nova-(\w+)-/.exec(stripped);
  if (!m) throw new Error(`pricing-display-name: cannot parse Nova modelId: ${modelId}`);
  const variant = m[1][0].toUpperCase() + m[1].slice(1);
  return { serviceCode: 'AmazonBedrock', identityField: 'model', identityValue: `Nova ${variant}` };
}

function llama(modelId: string): PricingIdentity {
  // meta.llama3-3-70b-instruct-v1:0 → "Llama 3.3 70B"
  // meta.llama4-maverick-17b-instruct-v1:0 → "Llama 4 Maverick 17B"
  // meta.llama4-scout-17b-instruct-v1:0 → "Llama 4 Scout 17B"
  const stripped = stripRegion(modelId);
  const versioned = /^meta\.llama(\d+)-(\d+)-(\d+b)-/.exec(stripped);
  if (versioned) {
    const display = `Llama ${versioned[1]}.${versioned[2]} ${versioned[3].toUpperCase()}`;
    return { serviceCode: 'AmazonBedrock', identityField: 'model', identityValue: display };
  }
  const named = /^meta\.llama(\d+)-(\w+)-(\d+b)-/.exec(stripped);
  if (named) {
    const variant = named[2][0].toUpperCase() + named[2].slice(1);
    const display = `Llama ${named[1]} ${variant} ${named[3].toUpperCase()}`;
    return { serviceCode: 'AmazonBedrock', identityField: 'model', identityValue: display };
  }
  throw new Error(`pricing-display-name: cannot parse Llama modelId: ${modelId}`);
}

function mistral(modelId: string): PricingIdentity {
  // mistral.mistral-large-2407-v1:0 → "Mistral Large 2407"
  const stripped = stripRegion(modelId);
  const m = /^mistral\.([a-z]+)-([a-z]+)(?:-(\d+))?/.exec(stripped);
  if (!m) throw new Error(`pricing-display-name: cannot parse Mistral modelId: ${modelId}`);
  const family = m[1][0].toUpperCase() + m[1].slice(1); // Mistral
  const variant = m[2][0].toUpperCase() + m[2].slice(1); // Large
  const year = m[3] ? ` ${m[3]}` : '';
  return {
    serviceCode: 'AmazonBedrock',
    identityField: 'model',
    identityValue: `${family} ${variant}${year}`,
  };
}

export function resolvePricingIdentity(modelId: string): PricingIdentity {
  const stripped = stripRegion(modelId);
  if (stripped.startsWith('anthropic.')) return anthropic(modelId);
  if (stripped.startsWith('amazon.nova-')) return nova(modelId);
  if (stripped.startsWith('meta.llama')) return llama(modelId);
  if (stripped.startsWith('mistral.')) return mistral(modelId);
  throw new Error(`pricing-display-name: unmapped vendor for modelId: ${modelId}`);
}
