import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-atomicity-split.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-atomicity-split: a mixed finding whose sub-parts split across the closure
// verdict must be filed as TWO atomic items (route split). The splitInto suffixes are pinned EXACTLY
// (like the legacy pinned titles) so the derived slugs — from-<check>-<suffix> — are deterministic.
const finding = {
  id: 'f-webhook-two-parts', check: 'webhook-audit', kind: 'inconsistency', scope: ['docs/**'],
  detail: 'two distinct sub-parts: (1) the webhook POST is missing its retry header — independently actionable now; (2) webhook signature rotation is blocked on out-of-scope vendor work — orthogonal and blocked. Their closure-relevance differs, so one mixed item cannot carry a correct verdict.',
};

export default {
  ...legacy,
  id: 'rt-add-atomicity-split',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md. If you judge the finding must be split into atomic items, the route JSON uses "route":"split" with "splitInto" set EXACTLY to ["retry-header","vendor-rotation"].'),
  terminal: 'completed',
  golden: {
    present: [
      { file: 'from-webhook-audit-retry-header', field: 'status' },
      { file: 'from-webhook-audit-vendor-rotation', field: 'status' },
    ],
  },
  journal: [{ runId: 'intake-f-webhook-two-parts', has: 'intake:f-webhook-two-parts:filed' }],
  rubric: ['The finding bundles an independently-actionable bug and an orthogonal vendor-blocked part whose closure-relevance differs. Did it SPLIT into two separate atomic items rather than file one mixed item?'],
};
