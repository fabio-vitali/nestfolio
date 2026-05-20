import { resolvePricingIdentity } from './pricing-display-name';

describe('resolvePricingIdentity', () => {
  it('Anthropic Claude → AmazonBedrockFoundationModels + servicename', () => {
    expect(resolvePricingIdentity('us.anthropic.claude-sonnet-4-6')).toEqual({
      serviceCode: 'AmazonBedrockFoundationModels',
      identityField: 'servicename',
      identityValue: 'Claude Sonnet 4.6 (Amazon Bedrock Edition)',
    });
    expect(resolvePricingIdentity('anthropic.claude-haiku-4-5-20251001')).toEqual({
      serviceCode: 'AmazonBedrockFoundationModels',
      identityField: 'servicename',
      identityValue: 'Claude Haiku 4.5 (Amazon Bedrock Edition)',
    });
    expect(resolvePricingIdentity('us.anthropic.claude-opus-4-7')).toEqual({
      serviceCode: 'AmazonBedrockFoundationModels',
      identityField: 'servicename',
      identityValue: 'Claude Opus 4.7 (Amazon Bedrock Edition)',
    });
  });

  it('Amazon Nova → AmazonBedrock + model', () => {
    expect(resolvePricingIdentity('us.amazon.nova-pro-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Nova Pro',
    });
    expect(resolvePricingIdentity('us.amazon.nova-lite-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Nova Lite',
    });
    expect(resolvePricingIdentity('us.amazon.nova-premier-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Nova Premier',
    });
  });

  it('Meta Llama → AmazonBedrock + model', () => {
    expect(resolvePricingIdentity('meta.llama3-3-70b-instruct-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Llama 3.3 70B',
    });
    expect(resolvePricingIdentity('meta.llama4-maverick-17b-instruct-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Llama 4 Maverick 17B',
    });
  });

  it('Mistral → AmazonBedrock + model', () => {
    expect(resolvePricingIdentity('mistral.mistral-large-2407-v1:0')).toEqual({
      serviceCode: 'AmazonBedrock',
      identityField: 'model',
      identityValue: 'Mistral Large 2407',
    });
  });

  it('throws for unknown vendor', () => {
    expect(() => resolvePricingIdentity('foo.bar-v1:0')).toThrow(/unmapped/);
  });

  describe('global.* region prefix (Fix B)', () => {
    it('resolves global.anthropic.* like us.anthropic.*', () => {
      expect(resolvePricingIdentity('global.anthropic.claude-sonnet-4-6')).toEqual({
        serviceCode: 'AmazonBedrockFoundationModels',
        identityField: 'servicename',
        identityValue: 'Claude Sonnet 4.6 (Amazon Bedrock Edition)',
      });
    });
  });
});
