import { sizeClassFor, dedupeUsStarPreference } from './catalog-loader';

describe('sizeClassFor', () => {
  it('classifies Anthropic Opus/Sonnet as frontier, Haiku as mid', () => {
    expect(sizeClassFor('us.anthropic.claude-opus-4-6')).toBe('frontier');
    expect(sizeClassFor('us.anthropic.claude-sonnet-4-6')).toBe('frontier');
    expect(sizeClassFor('anthropic.claude-haiku-4-5-20251001')).toBe('mid');
  });

  it('classifies Amazon Nova by variant', () => {
    expect(sizeClassFor('us.amazon.nova-premier-v1:0')).toBe('frontier');
    expect(sizeClassFor('us.amazon.nova-pro-v1:0')).toBe('frontier');
    expect(sizeClassFor('us.amazon.nova-lite-v1:0')).toBe('mid');
    expect(sizeClassFor('us.amazon.nova-micro-v1:0')).toBe('cheap');
  });

  it('classifies Llama by size token in id', () => {
    expect(sizeClassFor('meta.llama3-3-70b-instruct-v1:0')).toBe('frontier');
    expect(sizeClassFor('meta.llama3-1-405b-instruct-v1:0')).toBe('frontier');
    expect(sizeClassFor('meta.llama4-maverick-17b-instruct-v1:0')).toBe('mid');
    expect(sizeClassFor('meta.llama4-scout-17b-instruct-v1:0')).toBe('mid');
    expect(sizeClassFor('meta.llama3-1-8b-instruct-v1:0')).toBe('cheap');
  });

  it('classifies Mistral Large as frontier', () => {
    expect(sizeClassFor('mistral.mistral-large-2407-v1:0')).toBe('frontier');
  });

  it('returns unknown for unmapped models', () => {
    expect(sizeClassFor('cohere.command-r-plus-v1:0')).toBe('unknown');
    expect(sizeClassFor('foo.bar')).toBe('unknown');
  });
});

describe('dedupeUsStarPreference', () => {
  it('drops base id when us.* variant exists', () => {
    const input = [
      'anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-sonnet-4-6',
      'us.amazon.nova-pro-v1:0',
    ];
    expect(dedupeUsStarPreference(input).sort()).toEqual(
      ['us.amazon.nova-pro-v1:0', 'us.anthropic.claude-sonnet-4-6'],
    );
  });

  it('keeps base id when no us.* variant exists', () => {
    const input = ['anthropic.claude-haiku-4-5-20251001', 'meta.llama3-3-70b-instruct-v1:0'];
    expect(dedupeUsStarPreference(input).sort()).toEqual([
      'anthropic.claude-haiku-4-5-20251001',
      'meta.llama3-3-70b-instruct-v1:0',
    ]);
  });

  it('keeps eu.* and apac.* variants alongside us.*', () => {
    const input = [
      'us.anthropic.claude-sonnet-4-6',
      'eu.anthropic.claude-sonnet-4-6',
      'apac.anthropic.claude-sonnet-4-6',
    ];
    expect(dedupeUsStarPreference(input).sort()).toEqual([
      'apac.anthropic.claude-sonnet-4-6',
      'eu.anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-sonnet-4-6',
    ]);
  });
});
