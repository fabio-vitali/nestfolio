# Nestfolio — Volume 8: UI/UX Specification

> Defines the user experience strategy, screen inventory, interaction patterns, and design principles for Nestfolio. Derives from Volume 1 (Product & Principles), Volume 2 (System Architecture), and Volume 7 (Domain Decomposition).

---

## 1. Purpose of this Document

This specification describes **what users see and how they interact** with Nestfolio. It maps every user-facing surface to the underlying bounded contexts and BFF services defined in Volumes 2 and 7, ensuring the UI is a faithful expression of the system architecture.

---

## 2. Design Philosophy

### 2.1 Core Principles

| Principle | Manifestation |
|-----------|---------------|
| **Trust through transparency** | Every AI decision links to a plain-language "Why" explanation. Nothing feels hidden. |
| **Clarity over completeness** | Screens show the single most important insight first. Detail is available on demand, never forced. |
| **Hands-off by default** | The UI reinforces that Nestfolio is working for the user. Proactive status, not constant demands for input. |
| **Localized communication** | All copy, tone, date/currency formatting, and cultural framing adapt to the user's market. Italy is the launch market. |
| **Progressive disclosure** | Information is layered: headline → summary → full detail. Novice investors are never overwhelmed. |

### 2.2 Design Constraints

- **Mobile-first, responsive**: Primary experience is a mobile web app. Desktop is a widened layout, not a separate product.
- **Accessible**: WCAG 2.1 AA minimum. High contrast, keyboard navigation, screen reader support.
- **Low cognitive load**: Screens contain a single primary action at most. Jargon-free copy with contextual glossary tooltips.
- **Offline-aware**: Graceful degradation when connectivity drops. Cached projections shown with staleness indicator.

---

## 3. Target Personas

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Luca** (novice saver) | 28, first-time investor. Has savings but no market knowledge. Anxious about risk. | Reassurance. Wants to know his money is safe and someone competent is managing it. |
| **Giulia** (passive delegator) | 42, professional. Knows investing exists but doesn't want to learn. Values time. | Hands-off automation. Wants results without decisions. |
| **Marco** (curious learner) | 35, reads financial news casually. Wants to understand decisions without making them. | Explainability. Wants to peek under the hood when curious. |

All three personas share: novice-to-intermediate financial literacy, preference for Italian-language UI, and high sensitivity to trust signals.

---

## 4. User Journey Map

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER JOURNEY                              │
│                                                                  │
│  ┌─────────┐   ┌──────────┐   ┌───────────┐   ┌─────────────┐  │
│  │  LAND   │──►│  SIGN UP │──►│  ONBOARD  │──►│  DASHBOARD  │  │
│  └─────────┘   └──────────┘   └───────────┘   └──────┬──────┘  │
│                                                       │         │
│                          ┌────────────────────────────┤         │
│                          │            │               │         │
│                          ▼            ▼               ▼         │
│                   ┌───────────┐ ┌──────────┐  ┌────────────┐   │
│                   │ PORTFOLIO │ │ ACTIVITY │  │ SETTINGS   │   │
│                   │ DETAIL    │ │ & NOTIFS │  │ & PROFILE  │   │
│                   └─────┬─────┘ └──────────┘  └────────────┘   │
│                         │                                       │
│                         ▼                                       │
│                   ┌───────────┐                                 │
│                   │ DECISION  │                                 │
│                   │ DETAIL    │                                 │
│                   │ ("Why")   │                                 │
│                   └───────────┘                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Screen Inventory

| # | Screen | BFF Service | GraphQL Operations | Primary Content |
|---|--------|-------------|--------------------|-----------------|
| 1 | Landing / Marketing | `identity-web` | — | Value proposition, trust signals, CTA |
| 2 | Sign Up / Sign In | `identity-web` | Cognito federation (Google, Facebook, email) | Authentication |
| 3 | Onboarding Conversation | `identity-bff` | `recordOnboardingAnswer`, `setGoal`, `setRiskProfile`, `selectOperatingMode`, `grantMandate` | Guided Q&A |
| 4 | Dashboard (Home) | `portfolio-bff`, `advisory-bff`, `notification-bff` | `getPortfolioSummary`, `getRecommendations`, `getUnreadCount` | Portfolio health, recent activity, nudges |
| 5 | Portfolio Detail | `portfolio-bff` | `getPositions`, `getCashBalances`, `getPerformanceChart` | Holdings, allocation, performance |
| 6 | Decision Detail ("Why") | `advisory-bff` | `getExplanation`, `getRecommendation` | Plain-language reasoning for a specific action |
| 7 | Activity & Notifications | `notification-bff` | `getNotifications`, `markAsRead` | Notification inbox, history |
| 8 | Confirmation Dialog | `advisory-bff` | `confirmDecision`, `rejectDecision` | Level 2 user confirmation |
| 9 | Settings & Profile | `identity-bff` | `getProfile`, `updateGoal`, `updateOperatingMode`, `updateMandate` | Goals, risk profile, mode, notification preferences |
| 10 | IBKR Connection | `identity-bff` | `getBrokerStatus`, `revokeBrokerAuthorization` | Broker link status, authorization flow, disconnect |
| 11 | Deposit Flow | `identity-bff` | `initiateDeposit` | Bank transfer instructions, deposit status |
| 12 | Withdrawal Flow | `identity-bff` | `requestWithdrawal` | Withdrawal amount, confirmation, status tracking |
| 13 | Account Closure & Deletion | `identity-bff` | `requestAccountClosure`, `requestDeletion` | Closure confirmation, GDPR deletion, data retention info |
| 14 | How Nestfolio Works | `identity-bff`, `compliance-bff` | `getProfile`, `getGuardrailSummary` | Goals, mode, mandate scope, safety rules, authority levels |

---

## 6. Onboarding Experience

### 6.1 Design Intent

Onboarding is a **conversational flow**, not a traditional form. It feels like talking to a knowledgeable friend who asks one question at a time.

### 6.2 Flow Structure

```
Step 1 — Welcome
  "Ciao! Let's set up your investment plan together."
  [Continue]

Step 2 — Goal Setting (1–3 questions)
  "What are you saving for?"
  → Options: Retirement · Rainy Day · Home · Education · Grow Wealth
  "When do you want to reach this goal?"
  → Slider: 1 year ──────── 30+ years
  "How much do you want to invest to start?"
  → Amount input with sensible defaults

Step 3 — Risk Comfort (2–3 questions)
  "If your portfolio dropped 10% in a month, what would you do?"
  → Options: Sell everything · Sell some · Do nothing · Buy more
  "Which best describes your investment experience?"
  → Options: None · A little · Some · Experienced
  (Additional questions as needed for suitability)

Step 4 — Operating Mode Selection
  "How much control do you want to keep?"
  → Conservative: "Check with me often"
     · Rebalances about once per quarter
     · Asks confirmation for trades above 5% of portfolio
     · Drawdown protection pauses trading at -8%
  → Balanced (recommended): "Handle most things, ask me for big changes"
     · Rebalances about once per month
     · Asks confirmation for trades above 10% of portfolio
     · Drawdown protection pauses trading at -12%
  → Aggressive: "Manage everything, just keep me informed"
     · Rebalances up to twice per month
     · Asks confirmation for trades above 20% of portfolio
     · Drawdown protection pauses trading at -18%
  (Visual comparison card for each mode with plain-language guardrail summary)

Step 5 — Mandate & Terms
  "Here's what you're allowing Nestfolio to do for you."
  → Summary of mandate scope in plain language
  → Explicit consent toggle
  → Link to full terms

Step 6 — Broker Connection
  "Connect your Interactive Brokers account."
  → OAuth / redirect flow to IBKR
  → Success confirmation

Step 7 — Confirmation & Launch
  "You're all set! Here's your plan:"
  → Goal summary card
  → Risk profile summary
  → Operating mode badge
  [Go to Dashboard]
```

### 6.3 Technical Mapping

Each step emits domain events via `identity-bff`:

| Step | Events Emitted |
|------|---------------|
| Step 2 | `ONBOARDING_ANSWER_RECORDED` (×N), `GOAL_SET` |
| Step 3 | `ONBOARDING_ANSWER_RECORDED` (×N), `RISK_PROFILE_SET` |
| Step 4 | `OPERATING_MODE_SELECTED` |
| Step 5 | `MANDATE_GRANTED` |
| Step 7 | `ONBOARDING_COMPLETED` |

`ONBOARDING_COMPLETED` triggers downstream: `advisory-ctrl` begins initial portfolio assessment, `compliance-ctrl` stores guardrail policy, `notification-ctrl` sends welcome message.

### 6.4 UX Rules

- One question per screen on mobile. Grouped on desktop where appropriate.
- Back navigation is always available. No answer is permanent during onboarding.
- Progress indicator shows steps completed (e.g., "3 of 7").
- Skip is never available — all steps are required for suitability compliance.
- If the user abandons mid-flow, the system resumes from where they left off on next visit.

---

## 7. Dashboard (Home Screen)

### 7.1 Design Intent

The dashboard answers the single question: **"Is my money OK?"** Everything else is secondary.

### 7.2 Layout

```
┌──────────────────────────────────────────┐
│  ┌────────────────────────────────────┐  │
│  │  PORTFOLIO VALUE              ▲3.2% │  │
│  │  €24,350.00                        │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │  ~~~~~~ performance chart ~~ │  │  │
│  │  │  ~~~~~~~~~~~~~~~~~~~~~~~~~── │  │  │
│  │  └──────────────────────────────┘  │  │
│  │  1W  1M  3M  6M  YTD  1Y  ALL     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  STATUS                            │  │
│  │  ✓ Portfolio is on track           │  │
│  │  ✓ No action needed               │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  RECENT ACTIVITY                   │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │ ● Rebalanced 3 positions     │  │  │
│  │  │   Feb 28 · "Why?"            │  │  │
│  │  ├──────────────────────────────┤  │  │
│  │  │ ○ Monthly report ready       │  │  │
│  │  │   Feb 1                      │  │  │
│  │  └──────────────────────────────┘  │  │
│  │  See all activity →                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  ⚠ ACTION REQUIRED (if any)       │  │
│  │  "Confirm: strategy adjustment"    │  │
│  │  [Review & Confirm]                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌─────┬──────┬──────┬────────┐         │
│  │ Home│Portf.│Notifs│Settings│         │
│  └─────┴──────┴──────┴────────┘         │
└──────────────────────────────────────────┘
```

### 7.3 Sections

| Section | Source | Behavior |
|---------|--------|----------|
| **Portfolio Value** | `portfolio-bff` → `getPortfolioSummary` | Total value, change %, sparkline chart. Tap to open Portfolio Detail. |
| **Status Banner** | `advisory-bff` → `getRecommendations` | Summarizes system state in one sentence. Green/amber/red sentiment. |
| **Recent Activity** | `notification-bff` → `getNotifications(limit: 3)` | Last 3 notifications. Each links to Decision Detail ("Why?") or notification detail. |
| **Action Required** | `advisory-bff` → pending `USER_CONFIRMATION_REQUESTED` | Appears only when Level 2 confirmation is needed. Tapping opens Confirmation Dialog. |

### 7.4 Trust Signals

- The status banner defaults to positive framing: "Portfolio is on track" / "No action needed".
- When Nestfolio has acted autonomously, the recent activity entry says: "We handled this — tap to see why."
- The portfolio value change is shown in context (vs. relevant benchmark or goal progress) to avoid panic on red days.
- A subtle "Last health check: today" indicator at the bottom of the status section reinforces that Nestfolio is actively monitoring. Derived from `HEALTH_CHECK_COMPLETED` events via `operations-bff`.
- When a deposit is detected, the status banner shows: "New deposit received — we're evaluating how to invest it."
- When an order is staged (market closed), recent activity shows: "Trade scheduled for next market open."

---

## 8. Portfolio Detail

### 8.1 Design Intent

For users who want to look deeper. Shows **what** is in the portfolio and **how** it's performing — never demands action.

### 8.2 Content

| Tab / Section | Content | Source |
|---------------|---------|--------|
| **Overview** | Total value, cash balance, allocation donut chart (actual vs target overlay), goal progress section, risk band gauge | `portfolio-bff`, `identity-bff` (goal data), `advisory-bff` (target allocation) |
| **Holdings** | List of positions: instrument name, quantity, current value, gain/loss %, weight %, target weight % | `portfolio-bff` → `getPositions` |
| **Performance** | Time-series chart with period selectors (1W, 1M, 3M, 6M, YTD, 1Y, ALL), comparison against goal target line, projected completion date | `portfolio-bff` → `getPerformanceChart` |
| **Activity** | Chronological list of trades, rebalances, deposits, withdrawals, corporate actions, dividend reinvestments. Each links to Decision Detail. Distinct icons per action type. | `notification-bff`, `advisory-bff` |

A subtle "Last synced with broker: 2 min ago" timestamp appears at the bottom of the Overview tab (derived from `PORTFOLIO_SNAPSHOT_IMPORTED`).

### 8.3 Interaction Patterns

- **Tap a holding** → Expands to show: instrument description, why it's in the portfolio (link to most recent Decision Detail involving this instrument), current weight vs. target weight, last action taken.
- **Allocation donut chart** → Shows actual allocation with target allocation as a ghost ring overlay. Tappable segments highlight the corresponding holding in the list.
- **Risk band gauge** → Visual meter showing where the portfolio sits within its allowed risk range. Green zone = within band, amber = approaching edge. Tapping shows plain-language explanation: "Your portfolio risk is within your safety limits."
- **Goal progress section** → Shows:
  - Progress bar: actual vs target trajectory
  - Projected completion date (e.g., "On track to reach your goal by March 2038")
  - Runway summary: "X months ahead of schedule" / "Y months behind — Nestfolio is optimizing"
  - Goal data sourced from `identity-bff`, progress computed from `portfolio-bff` performance metrics.

### 8.4 Copy Guidelines

- Instrument names use common names, not ticker symbols (e.g., "Global Stocks ETF" not "VWCE.DE"). Ticker shown as secondary text.
- Gains shown in absolute and percentage terms. Losses use neutral language ("down 2.1%" not "lost €510").
- No buy/sell buttons. Nestfolio manages trades. The UI reinforces this with copy: "Managed by Nestfolio."

---

## 9. Decision Detail ("Why" View)

### 9.1 Design Intent

The core trust-building screen. When a user taps "Why?" on any activity item, they see a clear, layered explanation of what happened and why.

### 9.2 Structure (Progressive Disclosure)

```
┌──────────────────────────────────────────┐
│  ← Back                                 │
│                                          │
│  WHAT HAPPENED                           │
│  ─────────────────────────────────────   │
│  "We rebalanced your portfolio to keep   │
│   it aligned with your goals."           │
│                                          │
│  WHY                                     │
│  ─────────────────────────────────────   │
│  "Your stock allocation had drifted      │
│   above your target range. We sold a     │
│   small amount and bought bonds to       │
│   bring it back in line."                │
│                                          │
│  DETAILS (expandable)                    │
│  ─────────────────────────────────────   │
│  ▸ Reasoning factors (3)                 │
│  ▸ Trades executed (2)                   │
│  ▸ Cost & impact summary                 │
│  ▸ Compliance check: ✓ Passed            │
│                                          │
│  Decision #d8f3a · Feb 28, 2026          │
└──────────────────────────────────────────┘
```

### 9.3 Content Layers

| Layer | Content | Source |
|-------|---------|--------|
| **Headline** | One-sentence summary of the action taken | `advisory-bff` → `getExplanation` → `narrative` |
| **Why** | 2–3 sentence plain-language reasoning | `advisory-bff` → `getExplanation` → `reasoningFactors` (rendered by Recommendation & Explainability Agent) |
| **Market Context** | What market conditions influenced this decision (e.g., "Markets are in a stable growth regime" or "Elevated volatility in European equities") | `advisory-bff` → `getExplanation` → market-related reasoning factors (derived from `MARKET_SIGNAL_DETECTED` data embedded in decision context) |
| **Reasoning Factors** | Structured list: drift magnitude, risk band compliance, goal horizon, expected improvement, cool-down status | `advisory-bff` → `getExplanation` → `reasoningFactors` (raw) |
| **Risk Impact** | Pre/post risk band position shown as a visual gauge. "Before: 62% equity (target: 60%). After: 60% equity." | Decision Packet `riskChecks` via `advisory-bff` |
| **Trades Executed** | Instrument, side (buy/sell), quantity, price, current status (submitted / accepted / partially filled / filled / staged / rejected / cancelled). Live status for in-flight orders. | `portfolio-bff` / `advisory-bff` → Decision Packet trade plan + execution outcomes |
| **Cost & Impact** | Breakdown: estimated fees, estimated slippage, tax impact estimate, monthly turnover consumed (e.g., "8% of 25% monthly limit used") | Decision Packet `cost_checks` |
| **Compliance** | Pass/fail badge, authority level used, mandate scope invoked (e.g., "Within your Balanced mode mandate"), escalation reason if Level 2 (e.g., "Escalated because trade exceeds 10% of portfolio") | `compliance-bff` audit projection |

### 9.4 Decision Detail Variants

The "Why" view adapts its content based on the type of action:

| Action Type | Headline Pattern | Extra Content |
|-------------|-----------------|---------------|
| Rebalance | "We rebalanced your portfolio..." | Drift magnitude, target vs actual allocation |
| Dividend reinvestment | "We reinvested your dividend..." | Dividend source, reinvestment instrument |
| Tax-efficient adjustment | "We made a tax-efficient swap..." | Tax savings estimate, replacement instrument rationale |
| Deposit investment | "We invested your new deposit..." | Deposit amount, allocation decisions |
| Corporate action | "A corporate action affected your portfolio..." | Action type (split, merger, etc.), impact on holdings |
| Blocked decision | "We considered a change but didn't proceed..." | Reason for block, which safety rule prevented it |

### 9.5 UX Rules

- The headline and "Why" section are **always** visible without scrolling.
- The detail sections are collapsed by default. Expanding them is optional.
- Every detail section uses plain language. Hovering/tapping a term shows a contextual glossary definition (e.g., "Drift: how far your portfolio has moved from its target allocation").
- The `decision_id` and model version (e.g., "Model: v2.3") are shown as small references at the bottom for support/audit purposes.
- Emitting `USER_VIEWED_EXPLANATION` event when this screen is opened.
- If an order is still in flight (submitted but not yet filled), the Trades section shows live status with a subtle animation.

---

## 10. Confirmation Dialog (Level 2)

### 10.1 When It Appears

The system requests user confirmation for Level 2 decisions:
- Strategy or risk profile changes
- Trades exceeding mode thresholds (e.g., single trade > max trade size)
- Operating mode changes
- Mandate modifications
- Withdrawal recommendations
- Monthly turnover cap would be breached
- Portfolio drawdown exceeds circuit breaker threshold
- Any action escalated by compliance due to mandate/suitability mismatch

### 10.2 Layout

```
┌──────────────────────────────────────────┐
│                                          │
│  ⚠ YOUR CONFIRMATION IS NEEDED          │
│                                          │
│  PROPOSED ACTION                         │
│  ─────────────────────────────────────   │
│  "Nestfolio recommends adjusting your    │
│   portfolio: reduce stocks by 5%,        │
│   increase bonds by 5%."                 │
│                                          │
│  WHY THIS NEEDS YOUR OK                  │
│  ─────────────────────────────────────   │
│  (Dynamic — references the specific      │
│   escalation rule, e.g.:)                │
│  "This trade is 12% of your portfolio,   │
│   above your Balanced mode limit of 10%. │
│   Your settings require your OK for      │
│   changes of this size."                 │
│                                          │
│  WHAT WILL HAPPEN                        │
│  ─────────────────────────────────────   │
│  • Sell: Global Stocks ETF (€1,200)      │
│  • Buy: Euro Bonds ETF (€1,200)          │
│  • Estimated fees: €2.40                 │
│  • Estimated tax impact: €0 (no gain)    │
│  • Turnover: 8% of 25% monthly limit     │
│                                          │
│  ▸ Full reasoning (expandable)           │
│                                          │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │   Decline     │  │   Confirm ✓     │  │
│  └──────────────┘  └──────────────────┘  │
│                                          │
│  Expires in: 48h                         │
└──────────────────────────────────────────┘
```

### 10.3 Behavior

| Action | Event Emitted | Result |
|--------|--------------|--------|
| **Confirm** | `USER_CONFIRMED` | Execution proceeds. User sees success notification. |
| **Decline** | `USER_REJECTED` | Decision is cancelled. User may provide optional reason. System acknowledges. |
| **Expiry** | `USER_REJECTED` (auto, reason: "expired") | Decision is cancelled. User is notified it expired. |

### 10.4 UX Rules

- Confirmation requests appear as both an in-app banner (on Dashboard) and a push notification.
- The dialog presents the information needed to decide — not more.
- The "Confirm" button is prominent but not the default action. No accidental confirmations.
- An expiry timer (Conservative 72h, Balanced 48h, Aggressive 24h) is shown. Expired confirmations are auto-declined gracefully.
- Declining is frictionless and judgment-free. Copy: "No problem — we won't make this change."
- If confirmed outside market hours, contextual copy is shown: "This trade will be submitted when markets open on Monday." The order enters `Staged` state.
- The "Why this needs your OK" section dynamically references the specific escalation rule from the compliance check (e.g., trade size threshold, turnover cap, drawdown breaker).

---

## 11. Activity & Notifications

### 11.1 Design Intent

A chronological inbox of everything Nestfolio has done or communicated. The user's audit trail.

### 11.2 Notification Types

Maps to the five severity tiers from spec 2 §29.2:

| Severity Tier | Icon | Examples | Tappable Destination |
|---------------|------|---------|---------------------|
| **Informational** | ○ | "Monthly report is ready" · "Weekly health check complete — your portfolio is on track" · "Model v2.4 has improved our investment reasoning" | Report view / Dashboard |
| **Advisory** | ◉ | "New recommendation available" · "Corporate action: VWCE stock split applied" · "Deposit of €500 received — we're evaluating how to invest it" | Decision Detail |
| **Impactful** (soft pre-notice) | ◈ | "Upcoming: Nestfolio plans to rebalance 3 positions tomorrow" · "Large rebalance completed — within your safety rules" · "Dividend from Global Stocks ETF reinvested" | Decision Detail |
| **Confirmable** | ⚠ | "Your confirmation is needed: strategy adjustment" · "Withdrawal recommendation requires your approval" | Confirmation Dialog |
| **Critical** | ◆ | "Trading paused due to market volatility" · "Broker connection lost — tap to reconnect" · "An order was partially filled — we're monitoring" | Status detail / Decision Detail |

### 11.2.1 Specific Notification Templates

| Event Source | Notification Copy | Severity |
|-------------|-------------------|----------|
| `DECISION_BLOCKED` | "We considered a portfolio change but our safety rules determined it wasn't appropriate right now. Tap to learn more." | Advisory |
| `ORDER_PARTIALLY_FILLED` | "A trade was partially completed. We're monitoring the remaining portion." | Critical |
| `ORDER_CANCELLED` | "A trade was cancelled. Tap to see why." | Advisory |
| `ORDER_REJECTED` | "A trade could not be completed. [Specific reason, e.g., 'Your broker account may need additional funds.']" | Critical |
| `ORDER_STAGED` | "Your trade is scheduled for when markets open." | Informational |
| `CORPORATE_ACTION_APPLIED` | "A corporate action affected your holdings: [action type] on [instrument]. Tap to see the impact." | Advisory |
| `DEPOSIT_DETECTED` | "Deposit of €[amount] received — we're evaluating how to invest it." | Advisory |
| `WITHDRAWAL_COMPLETED` | "Your withdrawal of €[amount] has been processed." | Informational |
| `WITHDRAWAL_REJECTED` | "Your withdrawal could not be processed: [reason]." | Critical |
| `RECONCILIATION_COMPLETED` | "Portfolio verification complete — everything matches." (only shown if user-visible drift was corrected) | Informational |
| `RECONCILIATION_FAILED` | "We're having trouble verifying your portfolio with your broker. Our team is looking into it." | Critical |
| `INCIDENT_RESOLVED` | "Trading has resumed. Everything is back to normal." | Informational |
| `CIRCUIT_BREAKER_RESET` | "Market conditions have stabilized. Your safety rules are no longer pausing trades." | Informational |

### 11.3 Layout

- **Unread count badge** on the bottom nav "Notifications" tab.
- **List view**: Grouped by date. Each item shows: icon, title, subtitle (time ago), unread dot.
- **Mark as read**: Tapping an item marks it read (`NOTIFICATION_READ` event). Bulk "mark all as read" available.
- **Empty state**: "You're all caught up. Nestfolio is working quietly in the background."

### 11.4 Push Notifications

Delivered via push for:
- Level 2 confirmation requests (always)
- Critical alerts (always)
- Autonomous action summaries (configurable)
- Monthly reports (configurable)

Users configure push preferences in Settings.

---

## 12. Settings & Profile

### 12.1 Sections

| Section | Content | Editable | BFF |
|---------|---------|----------|-----|
| **Profile** | Name, email, federation provider | Read-only (managed by Cognito) | `identity-bff` |
| **Investment Goal** | Goal type, target amount, time horizon | Yes | `identity-bff` → `updateGoal` |
| **Risk Profile** | Risk comfort summary, risk band | Re-take questionnaire | `identity-bff` → triggers re-assessment |
| **Operating Mode** | Current mode with description, guardrail summary, change option | Yes (Level 2 confirmation) | `identity-bff` → `updateOperatingMode` |
| **Your Safety Rules** | Expandable panel showing simplified guardrail parameters for the active mode | Read-only (changes with mode) | `compliance-bff` → `getGuardrailSummary` |
| **Mandate** | Plain-language summary of what Nestfolio can do | Revocable | `identity-bff` → `updateMandate` |
| **Notifications** | Channel preferences (push/email on/off per type), timing mode selection, email summary frequency | Yes | `notification-bff` |
| **Broker Connection** | IBKR account status, last sync time, reconnect option, disconnect option | Action: reconnect / disconnect | `identity-bff` |
| **Deposits & Withdrawals** | Initiate deposit (bank transfer instructions), request withdrawal | Action flows | `identity-bff` |
| **Language** | Interface language selection | Yes | Client-side (i18n) |
| **Legal & Privacy** | Terms, privacy policy, mandate document, data retention summary | Read-only | Static |
| **Account** | Account deletion (GDPR), account closure | Action: close / delete | `identity-bff` |
| **How Nestfolio Works** | Link to educational overview (see §23) | Read-only | — |
| **Support** | Contact, FAQ link | Read-only | Static |

### 12.2 Your Safety Rules Panel

An expandable panel within the Operating Mode section showing simplified guardrail parameters:

| Parameter | Copy Example (Balanced mode) |
|-----------|------|
| Rebalance frequency | "About once per month" |
| Max single trade | "Up to 10% of your portfolio" |
| Monthly turnover limit | "Up to 25% of portfolio value per month" |
| Concentration limit | "No single ETF above 30% of portfolio" |
| Cool-down period | "5 trading days between trades on the same instrument" |
| Drawdown protection | "Trading pauses if portfolio drops more than 12%" |
| Volatility protection | "Trading pauses during moderate market turbulence" |

Copy: "These rules protect your portfolio. They adjust automatically when you change your operating mode."

### 12.3 Mode Change Flow

Changing the operating mode is a Level 2 action:

1. User taps current mode → sees side-by-side comparison of all three modes with both qualitative descriptions and quantitative guardrail parameters (rebalance frequency, max trade size, confirmation thresholds, cool-down periods, circuit breaker levels).
2. User selects new mode → sees impact summary ("This means Nestfolio will ask for your confirmation less often" / "Rebalancing will happen more frequently").
3. System validates compatibility with risk profile via `compliance-ctrl`.
4. If compatible → confirmation dialog with explicit consent.
5. `OPERATING_MODE_CHANGED` emitted → guardrail policy updated across all domains.

### 12.4 Notification Timing Preferences

A dedicated sub-screen within Notification settings:

| Timing Mode | Description | Example |
|-------------|-------------|---------|
| **Post-Fact** (default for Aggressive) | "We'll tell you after we act" | Rebalance notification arrives after trades complete |
| **Pre-Intent** | "We'll tell you before we act, with a short window to say 'wait'" | Soft pre-notice arrives before autonomous execution |
| **Hybrid** (default for Conservative, Balanced) | "We'll choose the right timing based on the importance of each action" | Small rebalances notified post-fact; large ones get pre-notice |

Copy: "This controls when you hear about autonomous actions. It does not affect actions that require your confirmation — those always ask first."

Per-channel toggles for each notification severity tier (push on/off, email on/off).

### 12.5 Broker Connection Management

- **Status**: Connected / Disconnected, last sync timestamp
- **Reconnect**: Button to re-authorize IBKR session (redirects to IBKR auth flow)
- **Disconnect broker account**: Explicit action with warning: "Disconnecting will stop all trading. Your current holdings remain in your IBKR account. You can reconnect at any time." Emits `BROKER_AUTHORIZATION_REVOKED` → `EXECUTION_PAUSED`.
- **Re-authorization**: After disconnect, a "Reconnect" flow that re-establishes IBKR authorization. Execution resumes after compliance revalidation.

### 12.6 Mandate Revocation

Users can revoke their mandate at any time:

1. User taps "Revoke mandate" → warning: "Nestfolio will stop managing your portfolio. Your current holdings will remain in your IBKR account."
2. Confirmation required.
3. `MANDATE_REVOKED` emitted → execution halted → user notified.
4. Portfolio remains visible in read-only mode. Re-onboarding possible.

### 12.7 Account Closure & Deletion

Two distinct actions available in the Account section:

**Account Closure:**
1. User taps "Close my account" → multi-step confirmation:
   - Step 1: "This will stop all portfolio management. Your holdings remain in your IBKR account."
   - Step 2: "Your mandate will be revoked and broker connection disconnected."
   - Step 3: Explicit "I understand, close my account" confirmation.
2. `ACCOUNT_CLOSURE_REQUESTED` → mandate revoked → broker authorization revoked → execution halted.
3. `ACCOUNT_CLOSED` emitted. Portfolio read-only. Welcome back flow available.

**GDPR Data Deletion:**
1. User taps "Delete my data" → explanation:
   - "We will delete your personal data. Some anonymized financial records are kept for regulatory compliance (up to 10 years)."
   - Data retention summary: PII deleted immediately, operational data retained 5 years (anonymized), financial records 10+ years (anonymized).
2. Requires account closure first if active.
3. `USER_DELETION_REQUESTED` → PII removed → audit data anonymized.

### 12.8 Legal & Privacy

Includes a user-friendly data retention summary (not just legal documents):

| Data Type | Retention | After Deletion |
|-----------|-----------|----------------|
| Personal information | Until you delete | Removed immediately |
| Portfolio decisions | 5 years | Anonymized |
| Financial records | 10+ years (regulatory) | Anonymized |

---

## 13. Navigation Structure

### 13.1 Bottom Tab Bar (Mobile)

| Tab | Icon | Screen | Badge |
|-----|------|--------|-------|
| **Home** | House | Dashboard | — |
| **Portfolio** | Pie chart | Portfolio Detail | — |
| **Notifications** | Bell | Activity & Notifications | Unread count |
| **Settings** | Gear | Settings & Profile | — |

### 13.2 Navigation Principles

- **Flat hierarchy**: All primary screens are one tap from the tab bar.
- **Contextual depth**: Decision Detail and Confirmation Dialog are pushed onto the stack from any entry point (dashboard, notifications, portfolio activity).
- **Deep linking**: Push notifications and emails deep-link to the relevant Decision Detail or Confirmation Dialog.
- **Back always works**: Hardware/software back button returns to previous screen. No dead ends.

---

## 14. Visual Design Language

### 14.1 Color System

| Role | Usage |
|------|-------|
| **Primary** | CTAs, active states, positive indicators |
| **Neutral** | Backgrounds, borders, secondary text |
| **Positive** | Portfolio gains, "on track" states, completed actions |
| **Cautionary** | Confirmations needed, drift warnings |
| **Negative** | Errors, critical alerts, execution paused |

Colors are defined as design tokens. Light and dark modes supported from launch.

### 14.2 Typography

- **Headings**: System font (SF Pro / Roboto), semibold. Sized for scannability.
- **Body**: System font, regular. Minimum 16px for readability.
- **Numbers**: Tabular-lining figures for financial data alignment.
- **Labels**: Uppercase small text sparingly for section headers.

### 14.3 Iconography

- Simple, line-based icon set. No filled icons to keep visual weight low.
- Consistent metaphors: house = home, pie = portfolio, bell = notifications, gear = settings.
- Status indicators use filled circles: green (ok), amber (attention), red (action needed).

### 14.4 Motion

- Transitions are fast (200–300ms) and purposeful. No decorative animation.
- Chart animations render data progressively (left to right) on first load.
- Confirmation button has a brief press-and-hold (300ms) to prevent accidental taps.

---

## 15. Localization Strategy

### 15.1 Architecture

- All user-facing strings are externalized into locale files.
- Locale is resolved from: user preference → browser locale → default (it-IT).
- Number formatting (€1.234,56), date formatting (28 feb 2026), and percentage formatting (3,2%) follow locale conventions.
- Right-to-left (RTL) layout support is not required for MVP (Italian + English).

### 15.2 Launch Locales

| Locale | Priority |
|--------|----------|
| `it-IT` (Italian) | Primary — launch market |
| `en-GB` (English) | Secondary — expat users, internal testing |

### 15.3 Tone Localization

Italian financial communication norms:
- Formal "Lei" register for legal/mandate copy.
- Informal "tu" register for conversational onboarding and explanations.
- Avoid Anglicisms where Italian equivalents exist (e.g., "portafoglio" not "portfolio" in UI copy).

---

## 16. Explainability UX Patterns

### 16.1 "Why?" Links

Every autonomous action shown in the UI includes a tappable "Perche?" / "Why?" link that opens the Decision Detail view.

### 16.2 Contextual Glossary

Financial terms throughout the UI are underlined with a dotted line. Tapping/hovering shows a tooltip with a plain-language definition. Examples:

| Term | Definition |
|------|-----------|
| Rebalance | Adjusting your portfolio to match your target allocation |
| Drift | How far your portfolio has moved from its ideal mix |
| Risk band | The range of risk your portfolio is designed to stay within |
| ETF | A fund that holds many investments and trades like a stock |
| Cool-down | A waiting period after a trade to prevent excessive buying and selling |
| Circuit breaker | A safety rule that pauses trading during unusual market conditions |
| Turnover | How much of your portfolio is bought and sold in a given period |
| Corporate action | A company event (like a stock split or merger) that changes your holdings |
| Mandate | The permission you give Nestfolio to manage your portfolio |
| Staged order | A trade waiting to execute when markets reopen |

### 16.3 Status Explanations

The dashboard status banner always explains the current state:

| State | Copy |
|-------|------|
| On track, no action | "Your portfolio is on track. No action needed." |
| Recently rebalanced | "We just made a small adjustment. Tap to see why." |
| Confirmation pending | "We have a recommendation for you. Tap to review." |
| Execution paused (reconciliation) | "Trading is paused while we verify your portfolio. This is a normal safety check." |
| Execution paused (circuit breaker) | "Markets are volatile today. Your safety rules are active and protecting your portfolio." |
| Order staged | "A trade is scheduled for when markets open." |
| Deposit received | "New deposit received — we're evaluating how to invest it." |
| Withdrawal processing | "Your withdrawal is being processed." |
| Reconciliation in progress | "We're verifying your portfolio with your broker — routine safety check." |
| Incident resolved | "Everything is back to normal. Trading has resumed." |
| Cool-down active | "Your portfolio was recently adjusted. Next rebalance check in X days." |
| Broker disconnected | "Your broker connection needs attention. Tap Settings to reconnect." |

---

## 17. Error & Edge Case States

### 17.1 Empty States

| Screen | Condition | Copy |
|--------|-----------|------|
| Dashboard | New user, no portfolio yet | "Your portfolio is being set up. We'll notify you when it's ready." |
| Portfolio Detail | No positions yet | "Once your first investment is placed, your holdings will appear here." |
| Notifications | No notifications | "You're all caught up. Nestfolio is working quietly in the background." |

### 17.2 Error States

| Condition | User-Facing Message | Background Action |
|-----------|--------------------|--------------------|
| Network offline | "You're offline. Showing your last known portfolio data." | Retry on reconnect |
| Broker disconnected | "Your broker connection needs attention. Tap to reconnect." | `BROKER_SESSION_LOST` → ops alert |
| Stale data (>1h) | "Last updated 2 hours ago" (subtle timestamp) | Automatic refresh on reconnect |
| Order rejected — insufficient funds | "A trade could not be completed. Your broker account may need additional funds." | `ORDER_REJECTED` → notification |
| Order rejected — invalid instrument | "A trade could not be completed. We're investigating the issue." | `ORDER_REJECTED` → ops alert |
| Order rejected — permission | "A trade was blocked by your broker. Tap Settings to check your broker connection." | `ORDER_REJECTED` → notification |
| Order partially filled | "A trade was partially completed. We're monitoring the remaining portion." | `ORDER_PARTIALLY_FILLED` → execution monitors |
| Order cancelled | "A pending trade was cancelled. Tap to see why." | `ORDER_CANCELLED` → notification |
| Circuit breaker active | "Trading is temporarily paused for safety. Your portfolio is secure." | `CIRCUIT_BREAKER_TRIGGERED` |
| Reconciliation failed | "We're having trouble verifying your portfolio. Our team is looking into it." | `RECONCILIATION_FAILED` → ops alert |
| Withdrawal rejected | "Your withdrawal could not be processed: [reason]. Please check your broker account." | `WITHDRAWAL_REJECTED` → notification |
| Degraded explanations | "Simplified explanation shown. A detailed explanation will be available shortly." | `REASONING_TIER_CHANGED` |

### 17.3 Loading States

- Skeleton screens for all data-driven sections (no blank white screens, no spinners).
- Portfolio value shows cached value immediately, updates when fresh data arrives.
- Charts show last-known shape with a subtle pulse to indicate refresh in progress.

---

## 18. Accessibility

### 18.1 Standards

- **WCAG 2.1 AA** compliance minimum.
- All interactive elements have accessible names.
- Color is never the sole indicator of state — always paired with icon or text.

### 18.2 Specifics

| Requirement | Implementation |
|-------------|----------------|
| Screen readers | Semantic HTML, ARIA labels on charts and custom components |
| Keyboard navigation | Full tab navigation on all screens. Focus rings visible. |
| Touch targets | Minimum 44×44px tap targets |
| Font scaling | Respects system font size up to 200% without layout breakage |
| Color contrast | 4.5:1 minimum for body text, 3:1 for large text |
| Reduced motion | Respects `prefers-reduced-motion`. All animations skip when enabled. |

---

## 19. Real-Time Behavior

### 19.1 Live Subscriptions

The following screens use AppSync GraphQL subscriptions for real-time updates:

| Screen | Subscription | Trigger |
|--------|-------------|---------|
| Dashboard — portfolio value | Position update | `POSITION_UPDATED`, `CASH_BALANCE_UPDATED` |
| Dashboard — notifications | New notification | `NOTIFICATION_CREATED` |
| Dashboard — action required | Confirmation request | `USER_CONFIRMATION_REQUESTED` |
| Portfolio Detail — positions | Position changes | `POSITION_UPDATED` |
| Notifications — inbox | New messages | `NOTIFICATION_CREATED` |

### 19.2 Update Behavior

- Real-time updates are applied silently (no flash/reload).
- Portfolio value changes animate smoothly (number counter).
- New notifications appear at the top of the list with a subtle highlight that fades after 3 seconds.
- If a confirmation request arrives while the user is on the dashboard, the "Action Required" card slides in.

---

## 20. Monthly Report

### 20.1 Content

A periodic summary delivered in-app and via email:

- Portfolio performance for the period (absolute and %)
- Actions taken by Nestfolio (count and summary)
- Goal progress update
- Key decisions and their reasoning (links to Decision Detail)
- Upcoming outlook (plain-language, non-predictive)

### 20.2 Trigger

`MONTHLY_REPORT_GENERATED` event from `notification-ctrl`. Report data assembled from `portfolio-bff` and `advisory-bff` projections.

### 20.3 Format

- In-app: scrollable card-based layout.
- Email: HTML email with summary and "View full report in Nestfolio" CTA.

---

## 21. Deposit & Withdrawal Flows

### 21.1 Deposit Flow

Deposits are Level 3 (user-exclusive) actions. Nestfolio facilitates but does not initiate them.

```
Step 1 — Initiate
  User taps "Add funds" (accessible from Portfolio Detail or Settings)
  → Shows bank transfer instructions for their IBKR account
  → Reference number and amount input
  → "Funds typically arrive in 1–3 business days"

Step 2 — Pending
  DEPOSIT_INITIATED emitted
  → Dashboard shows "Deposit pending" status
  → Notification: "We'll let you know when your deposit arrives"

Step 3 — Detected
  execution-adpt detects new cash via IBKR snapshot diff
  → DEPOSIT_DETECTED emitted
  → Dashboard status: "Deposit of €500 received"
  → Notification: "Deposit received — we're evaluating how to invest it"

Step 4 — Investment
  advisory-ctrl triggers portfolio assessment for new cash
  → Normal decision lifecycle: construction → compliance → execution
  → Decision Detail shows: "We invested your new deposit"
```

### 21.2 Withdrawal Flow

Withdrawals are Level 3 (user-exclusive) actions.

```
Step 1 — Request
  User taps "Withdraw funds" (accessible from Settings → Deposits & Withdrawals)
  → Amount input (with available cash shown)
  → Warning if withdrawal requires selling positions:
    "To withdraw €X, we may need to sell some holdings. Nestfolio will
     choose the most tax-efficient way to free up the funds."
  → Confirmation: "Withdraw €X"

Step 2 — Processing
  WITHDRAWAL_REQUESTED emitted
  → If positions need to be sold: advisory-ctrl triggers liquidation plan
  → execution-adpt submits withdrawal to IBKR → WITHDRAWAL_SUBMITTED
  → Status shown in Settings and Dashboard: "Withdrawal processing"

Step 3 — Outcome
  WITHDRAWAL_COMPLETED → Notification: "Your withdrawal of €X has been processed"
  OR
  WITHDRAWAL_REJECTED → Notification: "Withdrawal could not be processed: [reason]"
```

### 21.3 Withdrawal Recommendation

The advisory system may recommend a withdrawal (Level 2). This appears as a Confirmation Dialog variant:

- Copy: "Based on your goal timeline, we recommend withdrawing €X to [reason]."
- User confirms or declines.
- If confirmed, enters the standard withdrawal execution flow.

---

## 22. Deposit & Withdrawal in Portfolio Detail

Deposits and withdrawals appear as distinct activity items in the Portfolio Detail Activity tab:

| Action | Icon | Copy |
|--------|------|------|
| Deposit received | ↓ | "Deposit: €500 received" |
| Deposit invested | ● | "New funds invested across 3 positions" |
| Withdrawal requested | ↑ | "Withdrawal: €1,000 requested" |
| Withdrawal completed | ↑ | "Withdrawal: €1,000 processed" |

---

## 23. How Nestfolio Works (Educational Screen)

### 23.1 Design Intent

A single trust-building screen that ties together the mandate, authority levels, operating mode, and safety rules into a comprehensive "Here's what Nestfolio can and cannot do" view. Accessible from Settings and from the Dashboard via a "How it works" link.

### 23.2 Content

```
┌──────────────────────────────────────────┐
│  ← Back                                 │
│                                          │
│  HOW NESTFOLIO WORKS                     │
│                                          │
│  YOUR GOALS                              │
│  ─────────────────────────────────────   │
│  Grow Wealth · €50,000 · by 2038        │
│  [Edit in Settings]                      │
│                                          │
│  YOUR RISK PROFILE                       │
│  ─────────────────────────────────────   │
│  Moderate risk tolerance                 │
│  [Retake questionnaire]                  │
│                                          │
│  YOUR OPERATING MODE: BALANCED           │
│  ─────────────────────────────────────   │
│  "Nestfolio handles most things and      │
│   asks for your OK on big changes."      │
│  [Change mode]                           │
│                                          │
│  WHAT NESTFOLIO CAN DO AUTOMATICALLY     │
│  ─────────────────────────────────────   │
│  ✓ Rebalance your portfolio              │
│  ✓ Reinvest dividends                    │
│  ✓ Make tax-efficient swaps              │
│  ✓ Respond to market changes             │
│                                          │
│  WHAT REQUIRES YOUR OK                   │
│  ─────────────────────────────────────   │
│  ⚠ Trades above 10% of portfolio        │
│  ⚠ Strategy or risk level changes       │
│  ⚠ Withdrawal recommendations           │
│                                          │
│  WHAT ONLY YOU CAN DO                    │
│  ─────────────────────────────────────   │
│  ◉ Add or withdraw funds                 │
│  ◉ Close your account                    │
│                                          │
│  YOUR SAFETY RULES                       │
│  ─────────────────────────────────────   │
│  ▸ Rebalance: about once per month       │
│  ▸ Max single trade: 10% of portfolio    │
│  ▸ Monthly turnover limit: 25%           │
│  ▸ Cool-down: 5 days between trades      │
│  ▸ Drawdown protection: pauses at -12%   │
│  ▸ Concentration: no ETF above 30%       │
│                                          │
│  COMPLIANCE SUMMARY                      │
│  ─────────────────────────────────────   │
│  "All 47 decisions in the past year were │
│   within your mandate."                  │
│  ▸ View audit history                    │
│                                          │
└──────────────────────────────────────────┘
```

### 23.3 Data Sources

| Section | Source |
|---------|--------|
| Goals | `identity-bff` → `getProfile` |
| Risk Profile | `identity-bff` → `getProfile` |
| Operating Mode | `identity-bff` → `getProfile` |
| Autonomous/Confirmation/User-only lists | Derived from operating mode + authority level definitions |
| Safety Rules | `compliance-bff` → `getGuardrailSummary` |
| Compliance Summary | `compliance-bff` → aggregate audit projection |

---

## 24. Relationship to System Architecture

| UI Surface | Bounded Context(s) | BFF(s) | Key Events Consumed/Produced |
|------------|-------------------|--------|------------------------------|
| Onboarding | Identity | `identity-bff` | Produces: `ONBOARDING_ANSWER_RECORDED`, `GOAL_SET`, `RISK_PROFILE_SET`, `OPERATING_MODE_SELECTED`, `MANDATE_GRANTED`, `ONBOARDING_COMPLETED` |
| Dashboard | Portfolio, Advisory, Notification, Operations | `portfolio-bff`, `advisory-bff`, `notification-bff` | Consumes: position/cash projections, recommendations, notifications, health check status |
| Portfolio Detail | Portfolio, Advisory, Identity | `portfolio-bff`, `advisory-bff`, `identity-bff` | Consumes: positions, cash balances, performance data, target allocation, goal data |
| Decision Detail | Advisory, Compliance | `advisory-bff`, `compliance-bff` | Consumes: explanations, recommendations, compliance audit, risk checks. Produces: `USER_VIEWED_EXPLANATION` |
| Confirmation | Advisory, Compliance | `advisory-bff` | Consumes: `USER_CONFIRMATION_REQUESTED`, escalation reasons. Produces: `USER_CONFIRMED` or `USER_REJECTED` |
| Notifications | Notification | `notification-bff` | Consumes: all notification types (see §11.2.1). Produces: `NOTIFICATION_READ` |
| Settings | Identity, Compliance, Notification | `identity-bff`, `compliance-bff`, `notification-bff` | Produces: `GOAL_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_UPDATED`, `MANDATE_REVOKED`, `BROKER_AUTHORIZATION_REVOKED` |
| Deposit Flow | Identity, Execution | `identity-bff` | Produces: `DEPOSIT_INITIATED`. Consumes: `DEPOSIT_DETECTED` |
| Withdrawal Flow | Identity, Execution | `identity-bff` | Produces: `WITHDRAWAL_REQUESTED`. Consumes: `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED` |
| Account Closure | Identity, Execution | `identity-bff` | Produces: `ACCOUNT_CLOSURE_REQUESTED`, `USER_DELETION_REQUESTED`, `MANDATE_REVOKED`, `ACCOUNT_CLOSED` |
| How Nestfolio Works | Identity, Compliance | `identity-bff`, `compliance-bff` | Consumes: profile, guardrail policy, audit summary |

---

## 25. Open Questions

- What is the exact IBKR OAuth flow UX? (Depends on IBKR integration contract — to be refined in implementation.)
- Should the monthly report include a downloadable PDF for record-keeping?
- Will dark mode ship at launch or be a fast-follow?
- Should beta/early-access users see a banner indicating limited-functionality phase and per-tenant capital limits?
- Should model version updates (e.g., "We've improved our investment reasoning") be communicated to all users or only surfaced in the "How Nestfolio Works" screen?
- How should the UI indicate that an explanation is deterministic (stored factors) vs. enhanced (LLM-generated) — or should this distinction remain invisible?
