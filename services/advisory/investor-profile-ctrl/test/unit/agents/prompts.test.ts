import { userGoalsPrompt, riskAssessmentPrompt } from '../../../src/agents/prompts';

describe('investor-profile prompts — content anchors', () => {
  describe('userGoalsPrompt', () => {
    it('declares the role and task headers', () => {
      expect(userGoalsPrompt).toContain('ROLE: investor goals analyst');
      expect(userGoalsPrompt).toContain('TASK:');
    });

    it('emits the schema-derived field markers', () => {
      expect(userGoalsPrompt).toContain('"goals"');
      expect(userGoalsPrompt).toContain('"timeHorizon"');
      expect(userGoalsPrompt).toContain('"riskWillingness"');
      expect(userGoalsPrompt).toContain('"confidence"');
    });

    it('emits the forbid-empty marker', () => {
      expect(userGoalsPrompt).toContain('You MUST call the structured-output tool');
    });

    it('terminates with Input: {input}', () => {
      expect(userGoalsPrompt.endsWith('Input: {input}')).toBe(true);
    });
  });

  describe('riskAssessmentPrompt', () => {
    it('declares the role and task headers', () => {
      expect(riskAssessmentPrompt).toContain('ROLE: regulatory risk assessment specialist');
      expect(riskAssessmentPrompt).toContain('TASK:');
    });

    it('emits the schema-derived field markers', () => {
      expect(riskAssessmentPrompt).toContain('"riskScore"');
      expect(riskAssessmentPrompt).toContain('"riskCategory"');
      expect(riskAssessmentPrompt).toContain('"regulatoryFlags"');
      expect(riskAssessmentPrompt).toContain('"suitabilityAssessment"');
      expect(riskAssessmentPrompt).toContain('"confidence"');
    });

    it('encodes the risk score range and risk category enum', () => {
      expect(riskAssessmentPrompt).toMatch(/riskScore[^.]*\[0, 100\]/);
      expect(riskAssessmentPrompt).toContain('CONSERVATIVE | MODERATE | AGGRESSIVE');
    });

    it('references regulatory frameworks (FINRA 2111, Reg BI)', () => {
      expect(riskAssessmentPrompt).toContain('FINRA 2111');
      expect(riskAssessmentPrompt).toContain('Reg BI');
    });

    it('emits the forbid-empty marker', () => {
      expect(riskAssessmentPrompt).toContain('You MUST call the structured-output tool');
    });

    it('terminates with Input: {input}', () => {
      expect(riskAssessmentPrompt.endsWith('Input: {input}')).toBe(true);
    });
  });
});
