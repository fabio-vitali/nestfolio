import { RENDER_TOOLS } from '../../src/agent/tools/render-ui';

describe('RENDER_TOOLS', () => {
  it('defines 7 render tools', () => {
    expect(RENDER_TOOLS).toHaveLength(7);
  });

  it('each tool has name, description, and schema', () => {
    for (const tool of RENDER_TOOLS) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.schema).toBeDefined();
    }
  });

  const expectedTools = [
    'render_options',
    'render_mode_cards',
    'render_slider',
    'render_amount',
    'render_summary',
    'render_consent',
    'render_cta',
  ];

  it.each(expectedTools)('includes %s tool', (toolName) => {
    expect(RENDER_TOOLS.find((t) => t.name === toolName)).toBeDefined();
  });

  it('render_options schema requires title + options array', () => {
    const tool = RENDER_TOOLS.find((t) => t.name === 'render_options')!;
    const parsed = tool.schema.safeParse({ title: 'Obiettivo', options: [{ id: 'grow', emoji: '📈', label: 'Crescita' }, { id: 'income', emoji: '💰', label: 'Reddito' }] });
    expect(parsed.success).toBe(true);
  });

  it('render_slider schema requires min, max, step, label', () => {
    const tool = RENDER_TOOLS.find((t) => t.name === 'render_slider')!;
    const parsed = tool.schema.safeParse({ label: 'Orizzonte', min: 1, max: 30, step: 1, unit: 'anni' });
    expect(parsed.success).toBe(true);
  });

  it('render_amount schema requires currency + presets', () => {
    const tool = RENDER_TOOLS.find((t) => t.name === 'render_amount')!;
    const parsed = tool.schema.safeParse({ label: 'Capitale', currency: 'EUR', presets: [5000, 10000, 25000] });
    expect(parsed.success).toBe(true);
  });
});
