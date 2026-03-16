import type { MandateLevel } from '@nestfolio/investor-bff/service';
import { MandateValidator } from './mandate-validator';
import { GuardrailEvaluator } from './guardrail-evaluator';
import { SuitabilityChecker } from './suitability-checker';
import { AuthorityResolver } from './authority-resolver';

export interface MandateSnapshot {
  mandateId: string;
  level: MandateLevel;
  monthlyTurnoverCapPercent: number;
  maxSingleTradePercent: number;
  effectiveDate: string;
  revokedAt: string | null;
}

export interface ComplianceInput {
  decisionPacketId: string;
  tenantId: string;
  userId: string;
  mandate: MandateSnapshot;
  proposedTrades: Array<{
    symbol: string;
    assetClass: string;
    side: 'BUY' | 'SELL';
    quantityOrAmountCents: number;
    targetWeightPercent: number;
    rationale: string;
  }>;
  portfolioValue: number;
  riskScore: number;
  currentPositions: Array<{ ticker: string; weight: number }>;
}

export interface ComplianceOutput {
  result: 'APPROVED' | 'BLOCKED';
  authorityLevel: 'L1' | 'L2';
  violations: Violation[];
  checks: CheckResult[];
}

export interface Violation {
  rule: string;
  description: string;
  severity: 'WARNING' | 'BLOCKING';
}

export interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
}

export class RuleEngine {
  constructor(
    private readonly mandateValidator: MandateValidator,
    private readonly guardrailEvaluator: GuardrailEvaluator,
    private readonly suitabilityChecker: SuitabilityChecker,
    private readonly authorityResolver: AuthorityResolver,
  ) {}

  evaluate(input: ComplianceInput): ComplianceOutput {
    const checks: CheckResult[] = [];
    const violations: Violation[] = [];

    // 1. Validate mandate
    const mandateResult = this.mandateValidator.validate(input);
    checks.push(mandateResult);
    if (!mandateResult.passed) {
      violations.push({
        rule: 'MANDATE_SCOPE',
        description: mandateResult.details,
        severity: 'BLOCKING',
      });
    }

    // 2. Evaluate guardrails
    const guardrailResults = this.guardrailEvaluator.evaluate(input);
    checks.push(...guardrailResults);
    violations.push(
      ...guardrailResults
        .filter((r) => !r.passed)
        .map((r) => ({
          rule: r.name,
          description: r.details,
          severity: 'BLOCKING' as const,
        })),
    );

    // 3. Check suitability
    const suitabilityResult = this.suitabilityChecker.check(input);
    checks.push(suitabilityResult);
    if (!suitabilityResult.passed) {
      violations.push({
        rule: 'SUITABILITY',
        description: suitabilityResult.details,
        severity: 'BLOCKING',
      });
    }

    // 4. Determine authority level
    const authorityLevel = this.authorityResolver.resolve(input, violations);

    const hasBlockingViolations = violations.some(
      (v) => v.severity === 'BLOCKING',
    );

    return {
      result: hasBlockingViolations ? 'BLOCKED' : 'APPROVED',
      authorityLevel,
      violations,
      checks,
    };
  }
}
