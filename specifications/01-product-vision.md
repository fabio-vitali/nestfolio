# Product Vision and Business Rules

The business foundation for all Nestfolio decisions. For implementation details, see service cards and code.

---

## Mission

Nestfolio is an AI-managed investment platform that serves as a digital financial coach for novice investors. It simplifies investing through automation, transparency, and explainable decision-making.

**Launch market:** Italy. EU-compliant architecture for geographic expansion.

**Regulatory model:** Platform + Licensed Partner. Nestfolio owns AI/UX/orchestration. A licensed investment firm owns discretionary authority. A licensed broker partner owns custody. The broker is abstracted behind an adapter and can be replaced without architectural changes.

## Target Users

- **Novice investors** -- limited or no prior investing experience
- **Trust-oriented savers** -- prioritize safety and transparency over returns
- **Hands-off delegators** -- fully automated management, minimal involvement

## Core Principles

1. **Trust through transparency** -- every decision includes human-readable reasoning
2. **Clarity and simplicity** -- no financial jargon, plain accessible language
3. **Customer-centric automation** -- acts on user's behalf, user always knows what and why
4. **Localized communication** -- adapted to local financial norms (Italian first)

---

## Operating Modes

Three modes govern autonomy, guardrails, and communication:

| Parameter | Conservative | Balanced (Default) | Aggressive |
|---|---|---|---|
| Equity Risk Band | +/-3% | +/-6% | +/-10% |
| Drift Trigger | 2% | 4% | 7% |
| Max Trade Size | 5% of portfolio | 10% of portfolio | 20% of portfolio |
| Rebalance Cadence | Quarterly | Monthly | Bi-Weekly |
| Monthly Turnover Cap | 10% | 25% | 50% |
| Single ETF Concentration | 20% | 30% | 40% |
| Illiquid Assets | Not allowed | Limited | Allowed (screened) |
| Volatility Pause Trigger | High | Medium | Extreme |
| Drawdown Circuit Breaker | -8% | -12% | -18% |
| Instrument Cool-Down | 10 trading days | 5 trading days | 2 trading days |

Selected during onboarding, changeable later (L2 action). Each mode defines a complete policy bundle.

---

## Authority Levels

| Level | Name | Scope | Examples |
|---|---|---|---|
| L0 | Informational | No execution impact | Portfolio insights, market explanations |
| L1 | Autonomous | Within mandate guardrails | Rebalancing, drift correction, dividend reinvestment |
| L2 | User Confirmation | Outside autonomous scope | Strategy change, large allocation shifts |
| L3 | User Exclusive | User-initiated only | Deposits, withdrawals, account closure |

**L1 escalates to L2 when:** allocation change exceeds risk band, trade exceeds max size, turnover cap would breach, drawdown exceeds circuit breaker, strategy model changes allocation class, or mandate/risk mismatch detected.

---

## Account Modes

Orthogonal to operating mode:

- **Simulation** -- virtual capital, simulated execution, real market data. Full decision lifecycle applies identically.
- **Live** -- real capital, real execution via broker.

All guardrails, compliance, and authority levels apply identically in both modes. Simulation-to-Live is L2 (preserves goals/risk/mode/mandate, resets portfolio). Live-to-Simulation not supported.

---

## Communication Model

| Authority | Timing |
|---|---|
| L1 actions | Post-execution explanation |
| High-impact L1 | Soft pre-notice when feasible |
| L2 actions | Pre-execution confirmation request |

Default notification timing: Conservative/Balanced = Hybrid, Aggressive = Post-Fact. Confirmation expiry: Conservative 72h, Balanced 48h, Aggressive 24h.
