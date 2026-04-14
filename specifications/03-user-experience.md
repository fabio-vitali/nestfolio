# User Experience

Design principles and user flows. For current BFF mappings and GraphQL operations, see service cards and frontend code. For wireframes, see [wireframes/](./wireframes/index.html).

---

## Design Philosophy

- **Mobile-first, responsive** (PWA). Desktop widens but never adds absent features.
- **WCAG 2.1 AA** minimum. Color never sole indicator of state.
- **Low cognitive load** -- single primary action per screen, jargon-free with contextual glossary tooltips.
- **Localization-first** -- it-IT primary, en-GB secondary. Tone-localized (formal "Lei" for legal, informal "tu" for conversational).
- **Progressive disclosure** -- headline, then summary, then full detail. Novice investors never overwhelmed.

---

## Onboarding

Conversational flow (not a form), served by a dedicated BFF with a conversational AI agent.

1. **Welcome** -- "Ciao! Let's set up your investment plan together."
2. **Goal Setting** -- what, when, how much
3. **Account Mode** -- Simulation (virtual capital) or Live (real money)
4. **Risk Comfort** -- behavioral questions for suitability compliance
5. **Operating Mode** -- Conservative ("check with me often") / Balanced ("handle most, ask for big changes") / Aggressive ("manage everything, keep me informed")
6. **Mandate & Terms** -- plain-language scope summary, explicit consent
7. **Account Activation** -- broker provisioning (Live) or instant virtual credit (Simulation)
8. **Confirmation** -- goal summary, risk profile, mode badges, go to dashboard

One question per screen on mobile. No skipping (suitability compliance). Abandoned flows resume on return.

---

## Key Screens

| Screen | Design Intent |
|---|---|
| **Dashboard** | "Is my money OK?" Portfolio value, status banner, recent activity, action required card |
| **Portfolio Detail** | Overview (allocation donut, risk gauge, goal progress), Holdings, Performance chart, Activity |
| **Decision Detail ("Why")** | Core trust screen. Headline, reasoning, market context, trades, costs, compliance. Progressive disclosure. |
| **Confirmation Dialog** | L2 decisions. Shows proposed action, why approval needed, what will happen. Confirm/Decline/Expiry. |
| **Notifications** | 5 severity tiers (Informational, Advisory, Impactful, Confirmable, Critical). Grouped by date. |
| **Settings** | Profile, goals, risk, operating mode, account mode, safety rules, mandate, notifications, deposits/withdrawals |
| **How Nestfolio Works** | Educational: what's automatic (L1), what needs OK (L2), what's user-only (L3), safety rules |

Navigation: flat 4-tab bar (Home, Portfolio, Notifications, Settings). Decision Detail and Confirmation pushed from any entry point. Deep linking from push notifications.

---

## Key User Flows

### Mode Change (L2)
Side-by-side comparison -> impact summary -> compliance validation -> confirmation -> guardrails updated across all domains.

### Deposit
Initiate -> pending -> broker adapter detects cash -> advisory assessment -> investment. Simulation: instant virtual credit.

### Withdrawal (L3)
Request -> if positions must be sold, liquidation plan -> broker submission -> completed/rejected. Simulation: instant virtual debit.

### Simulation-to-Live (L2)
Impact summary (preserves goals/risk/mode/mandate, resets portfolio) -> confirmation -> broker provisioning -> portfolio reset -> deposit prompt.

### Account Closure
Multi-step confirmation -> mandate revoked -> broker auth revoked -> execution halted -> read-only portfolio.

---

## Notification Model

| Severity | Examples | Timing |
|---|---|---|
| Informational | Monthly report, minor rebalance | Post-fact |
| Advisory | Recommendation, deposit received | Pre or post |
| Impactful | Large rebalance within guardrails | Soft pre-notice |
| Confirmable | Strategy change needing approval | Pre-execution |
| Critical | Circuit breaker, execution pause | Immediate |

Push delivery: L2 confirmations and critical alerts always; autonomous summaries and reports configurable. Users set per-channel preferences (push/email) per severity tier.

---

## Trust Signals

- Status banner defaults positive: "Portfolio is on track"
- Autonomous actions: "We handled this -- tap to see why"
- Losses use neutral language: "down 2.1%" not "lost EUR 510"
- No buy/sell buttons: "Managed by Nestfolio"
- Simulation mode: persistent amber badge with "Go Live" CTA
- Declining L2 is frictionless: "No problem -- we won't make this change"
