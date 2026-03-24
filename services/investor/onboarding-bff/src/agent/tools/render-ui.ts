import { z } from 'zod';

const OptionItemSchema = z.object({
  id: z.string(),
  emoji: z.string().optional(),
  label: z.string(),
  description: z.string().optional(),
});

const ModeCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  badge: z.string().optional(),
  details: z.array(z.string()),
});

export const RENDER_TOOLS = [
  {
    name: 'render_options',
    description: 'Display emoji choice cards for the user to select from',
    schema: z.object({
      title: z.string(),
      options: z.array(OptionItemSchema).min(2),
    }),
  },
  {
    name: 'render_mode_cards',
    description: 'Display large cards with badge and details list for mode selection',
    schema: z.object({
      title: z.string(),
      cards: z.array(ModeCardSchema).min(2),
    }),
  },
  {
    name: 'render_slider',
    description: 'Display a range slider for numeric input',
    schema: z.object({
      label: z.string(),
      min: z.number(),
      max: z.number(),
      step: z.number(),
      unit: z.string().optional(),
    }),
  },
  {
    name: 'render_amount',
    description: 'Display a currency input with preset buttons',
    schema: z.object({
      label: z.string(),
      currency: z.string(),
      presets: z.array(z.number()),
    }),
  },
  {
    name: 'render_summary',
    description: 'Display a read-only recap card with label-value rows',
    schema: z.object({
      title: z.string(),
      rows: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
  },
  {
    name: 'render_consent',
    description: 'Display a consent checkbox with legal links',
    schema: z.object({
      label: z.string(),
      links: z.array(z.object({ text: z.string(), url: z.string() })).optional(),
    }),
  },
  {
    name: 'render_cta',
    description: 'Display a call-to-action button',
    schema: z.object({
      label: z.string(),
      action: z.string(),
    }),
  },
] as const;
