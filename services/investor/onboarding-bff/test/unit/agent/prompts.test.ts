import { SYSTEM_PROMPT } from '../../../src/agent/prompts/system';
import { PHASE_INSTRUCTIONS } from '../../../src/agent/prompts/phase-instructions';
import { PHASE_ORDER } from '../../../src/agent/state';

describe('SYSTEM_PROMPT invariants', () => {
  it('does not contain the dropped confirm directive', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Confermi\?/);
    expect(SYSTEM_PROMPT).not.toMatch(/Ho capito bene/);
    expect(SYSTEM_PROMPT).not.toMatch(/ON CONFIRMATION/i);
    expect(SYSTEM_PROMPT).not.toMatch(/restate it once/i);
  });

  it('explicitly forbids listing options in the assistant message text', () => {
    expect(SYSTEM_PROMPT).toMatch(/render_\* tool arguments/);
    expect(SYSTEM_PROMPT).toMatch(/NEVER in the assistant message text/);
  });

  it('keeps Italian-output rule', () => {
    expect(SYSTEM_PROMPT).toMatch(/MUST be written in Italian/);
  });

  it('keeps the persona block', () => {
    expect(SYSTEM_PROMPT).toMatch(/Name: Nestfolio\./);
  });
});

describe('PHASE_INSTRUCTIONS invariants', () => {
  it('has an entry for every phase in PHASE_ORDER', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INSTRUCTIONS).toHaveProperty(phase);
    }
  });

  it('every entry contains the OPTIONS (tool args only) marker', () => {
    // mandate_cta and mandate_consent are phases without a separate OPTIONS block
    // (they have inline tool args / no configurable options). Allow those exceptions.
    const noOptionsPhases = new Set(['mandate_cta', 'mandate_consent']);
    for (const phase of PHASE_ORDER) {
      const body = PHASE_INSTRUCTIONS[phase];
      if (noOptionsPhases.has(phase)) continue;
      expect(body).toMatch(/OPTIONS \(tool args only/);
    }
  });

  it('every entry has an Italian TITLE line', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INSTRUCTIONS[phase]).toMatch(/TITLE \(Italian\):/);
    }
  });

  it('every entry has an ON ENTRY directive', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INSTRUCTIONS[phase]).toMatch(/ON ENTRY:/);
    }
  });

  it('mandate_cta explicitly does NOT call commit_phase', () => {
    expect(PHASE_INSTRUCTIONS['mandate_cta']).toMatch(/DO NOT call commit_phase/);
  });

  it('preserves option ids verbatim from the original schema (goal phase)', () => {
    const goal = PHASE_INSTRUCTIONS['goal'];
    expect(goal).toMatch(/"growth"/);
    expect(goal).toMatch(/"real_estate"/);
    expect(goal).toMatch(/"family"/);
    expect(goal).toMatch(/"education"/);
    expect(goal).toMatch(/"retirement"/);
    expect(goal).toMatch(/"other"/);
  });

  it('preserves operating_mode card ids verbatim', () => {
    const mode = PHASE_INSTRUCTIONS['operating_mode'];
    expect(mode).toMatch(/"conservative"/);
    expect(mode).toMatch(/"balanced"/);
    expect(mode).toMatch(/"aggressive"/);
  });

  it('preserves slider bounds and capital presets verbatim', () => {
    expect(PHASE_INSTRUCTIONS['horizon']).toMatch(/min: 1, max: 30, step: 1/);
    expect(PHASE_INSTRUCTIONS['capital']).toMatch(/\[5000, 10000, 25000, 50000\]/);
  });
});
