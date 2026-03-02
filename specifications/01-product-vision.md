# Product Vision and Principles

Defines the product mission, target users, experience principles, and operating philosophy that form the conceptual foundation for all Nestfolio technical and operational decisions.

> [Back to Index](../README.md)

---

## Product Mission

Nestfolio is an AI-managed investment platform that serves as a digital financial coach for novice investors. It simplifies investing through automation, transparency, and explainable decision-making, enabling users to build wealth without requiring financial expertise.

## Regulatory Positioning

Nestfolio operates under a **Platform + Licensed Partner Model** that separates technology from regulated activity:

| Responsibility | Owner |
|---|---|
| AI infrastructure, orchestration, UX, and explainability | Nestfolio |
| Discretionary investment authority and regulatory compliance | Licensed investment firm partner |
| Asset custody | Interactive Brokers |

This structure enables safe market entry while preserving a clear path toward independent authorization in the future.

## Target Users

Nestfolio serves three overlapping user segments:

- **Novice investors** -- individuals with limited or no prior investing experience.
- **Trust-oriented savers** -- users who prioritize safety, transparency, and predictability over maximizing returns.
- **Hands-off delegators** -- users seeking fully automated portfolio management with minimal day-to-day involvement.

**Primary launch market:** Italy, with an EU-compliant architecture designed for geographic expansion.

## Core Experience Principles

### Trust Through Transparency

Users must understand *why* every decision occurs. Explanations accompany all portfolio-impacting actions, and reasoning is persisted for later review.

### Clarity and Simplicity

Financial jargon is avoided throughout the interface. All explanations use plain, accessible language so that users with no financial background can follow along confidently.

### Customer-Centric Automation

Automation minimizes required user action while preserving a sense of control. The system acts on the user's behalf, but the user always knows what happened and why.

### Localized Communication

Language, tone, and cultural framing align with the user's market. Content is not merely translated -- it is adapted to local financial norms and communication styles.

## Operating Modes

Nestfolio offers three configurable operating modes that govern autonomy levels, guardrail thresholds, and communication behavior:

| Mode | Description |
|---|---|
| **Conservative** | Tighter guardrails, lower autonomy, more frequent confirmations |
| **Balanced** (default) | Standard guardrails with a moderate level of autonomous action |
| **Aggressive** | Wider autonomy range, relaxed guardrails, fewer interruptions |

Users select a mode during onboarding and may adjust it at any time within compliance constraints.

## Communication Philosophy

Nestfolio follows a configurable hybrid communication model:

- **Autonomous actions** are explained post-execution via notification.
- **High-impact actions** trigger pre-execution notifications.
- **Compliance-mandated actions** require explicit user confirmation before proceeding.

Users may override notification timing within the bounds set by their operating mode and regulatory requirements.

## Trust Reinforcement

Nestfolio builds and maintains user confidence through four mechanisms:

1. **Explainable AI** -- every portfolio decision includes human-readable reasoning factors.
2. **Auditability** -- all decisions and their inputs are immutably recorded and replayable.
3. **Predictable automation** -- the system behaves consistently within the boundaries of the selected operating mode.
4. **Clear ownership boundaries** -- responsibilities between Nestfolio (technology) and the licensed partner (regulation) are explicit and visible to the user.

## Evolution Path

Nestfolio is architected to evolve from its initial partnered regulatory model toward potential independent authorization. This transition requires no architectural redesign -- the governance, compliance, and operational layers are built to accommodate increasing levels of regulatory responsibility over time.
