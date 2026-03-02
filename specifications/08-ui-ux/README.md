# UI/UX

Design philosophy, constraints, accessibility standards, and localization strategy for the Nestfolio user experience.

> [Back to Index](../README.md)

## Documents in This Section

| Document | Description |
|----------|-------------|
| [Screen Inventory](./screen-inventory.md) | Complete screen specifications mapped to bounded contexts and BFF services, responsive layouts, and component specifications |
| [Interaction Patterns](./interaction-patterns.md) | User flows, real-time update behavior, and microfrontend architecture strategy |

---

## Design Philosophy

### Core Principles

| Principle | Manifestation |
|-----------|---------------|
| **Trust through transparency** | Every AI decision links to a plain-language "Why" explanation. Nothing feels hidden. |
| **Clarity over completeness** | Screens show the single most important insight first. Detail is available on demand, never forced. |
| **Hands-off by default** | The UI reinforces that Nestfolio is working for the user. Proactive status, not constant demands for input. |
| **Localized communication** | All copy, tone, date/currency formatting, and cultural framing adapt to the user's market. Italy is the launch market. |
| **Progressive disclosure** | Information is layered: headline, then summary, then full detail. Novice investors are never overwhelmed. |

### Target Personas

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Luca** (novice saver) | 28, first-time investor. Has savings but no market knowledge. Anxious about risk. | Reassurance that his money is safe and competently managed |
| **Giulia** (passive delegator) | 42, professional. Knows investing exists but does not want to learn. Values time. | Hands-off automation with results, not decisions |
| **Marco** (curious learner) | 35, reads financial news casually. Wants to understand decisions without making them. | Explainability -- ability to peek under the hood when curious |

All personas share novice-to-intermediate financial literacy, preference for Italian-language UI, and high sensitivity to trust signals.

---

## Design Constraints

- **Mobile-first, responsive**: The primary experience is a mobile web app. Desktop is a widened layout, not a separate product.
- **Accessible**: WCAG 2.1 AA minimum. High contrast, keyboard navigation, screen reader support.
- **Low cognitive load**: Screens contain a single primary action at most. Jargon-free copy with contextual glossary tooltips.
- **Offline-aware**: Graceful degradation when connectivity drops. Cached projections shown with a staleness indicator.

---

## Visual Design Language

### Color System

| Role | Usage |
|------|-------|
| **Primary** | CTAs, active states, positive indicators |
| **Neutral** | Backgrounds, borders, secondary text |
| **Positive** | Portfolio gains, "on track" states, completed actions |
| **Cautionary** | Confirmations needed, drift warnings |
| **Negative** | Errors, critical alerts, execution paused |

Colors are defined as design tokens. Light and dark modes are supported from launch.

### Typography

- **Headings**: System font (SF Pro / Roboto), semibold. Sized for scannability.
- **Body**: System font, regular. Minimum 16px for readability.
- **Numbers**: Tabular-lining figures for financial data alignment.
- **Labels**: Uppercase small text sparingly for section headers.

### Iconography

- Simple, line-based icon set. No filled icons to keep visual weight low.
- Consistent metaphors: house = home, pie = portfolio, bell = notifications, gear = settings.
- Status indicators use filled circles: green (ok), amber (attention), red (action needed).

### Motion

- Transitions are fast (200-300ms) and purposeful. No decorative animation.
- Chart animations render data progressively (left to right) on first load.
- Confirmation button has a brief press-and-hold (300ms) to prevent accidental taps.

---

## Accessibility

### Standards

WCAG 2.1 AA compliance minimum. Color is never the sole indicator of state -- always paired with an icon or text label.

### Requirements

| Requirement | Implementation |
|-------------|----------------|
| Screen readers | Semantic HTML, ARIA labels on charts and custom components |
| Keyboard navigation | Full tab navigation on all screens. Focus rings visible. |
| Touch targets | Minimum 44x44px tap targets |
| Font scaling | Respects system font size up to 200% without layout breakage |
| Color contrast | 4.5:1 minimum for body text, 3:1 for large text |
| Reduced motion | Respects `prefers-reduced-motion`. All animations skip when enabled. |

---

## Localization Strategy

### Architecture

- All user-facing strings are externalized into locale files.
- Locale is resolved from: user preference, then browser locale, then default (`it-IT`).
- Number formatting (`EUR 1.234,56`), date formatting (`28 feb 2026`), and percentage formatting (`3,2%`) follow locale conventions.
- Right-to-left layout support is not required for MVP (Italian + English only).

### Launch Locales

| Locale | Priority |
|--------|----------|
| `it-IT` (Italian) | Primary -- launch market |
| `en-GB` (English) | Secondary -- expat users, internal testing |

### Tone Localization

Italian financial communication norms:

- Formal "Lei" register for legal/mandate copy.
- Informal "tu" register for conversational onboarding and explanations.
- Avoid Anglicisms where Italian equivalents exist (e.g., "portafoglio" not "portfolio" in UI copy).

---

## Explainability UX Patterns

### "Why?" Links

Every autonomous action shown in the UI includes a tappable "Perche?" / "Why?" link that opens the Decision Detail view. See [Interaction Patterns](./interaction-patterns.md) for the full Decision Detail specification.

### Contextual Glossary

Financial terms throughout the UI are underlined with a dotted line. Tapping or hovering shows a tooltip with a plain-language definition.

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

### Status Explanations

The dashboard status banner always explains the current state in plain language.

| State | Copy |
|-------|------|
| On track, no action | "Your portfolio is on track. No action needed." |
| Recently rebalanced | "We just made a small adjustment. Tap to see why." |
| Confirmation pending | "We have a recommendation for you. Tap to review." |
| Execution paused (reconciliation) | "Trading is paused while we verify your portfolio. This is a normal safety check." |
| Execution paused (circuit breaker) | "Markets are volatile today. Your safety rules are active and protecting your portfolio." |
| Order staged | "A trade is scheduled for when markets open." |
| Deposit received | "New deposit received -- we're evaluating how to invest it." |
| Withdrawal processing | "Your withdrawal is being processed." |
| Reconciliation in progress | "We're verifying your portfolio -- routine safety check." |
| Incident resolved | "Everything is back to normal. Trading has resumed." |
| Cool-down active | "Your portfolio was recently adjusted. Next rebalance check in X days." |

---

## Error and Edge Case States

### Empty States

| Screen | Condition | Copy |
|--------|-----------|------|
| Dashboard | New user, no portfolio yet | "Your portfolio is being set up. We'll notify you when it's ready." |
| Portfolio Detail | No positions yet | "Once your first investment is placed, your holdings will appear here." |
| Notifications | No notifications | "You're all caught up. Nestfolio is working quietly in the background." |

### Error States

| Condition | User-Facing Message |
|-----------|---------------------|
| Network offline | "You're offline. Showing your last known portfolio data." |
| Trading service disruption | "We're experiencing a temporary issue with trading. We're working on it." |
| Stale data (>1h) | "Last updated 2 hours ago" (subtle timestamp) |
| Order rejected -- insufficient funds | "A trade could not be completed. Your account may need additional funds." |
| Order rejected -- invalid instrument | "A trade could not be completed. We're investigating the issue." |
| Order rejected -- permission | "A trade was blocked. We're investigating the issue." |
| Order partially filled | "A trade was partially completed. We're monitoring the remaining portion." |
| Order cancelled | "A pending trade was cancelled. Tap to see why." |
| Circuit breaker active | "Trading is temporarily paused for safety. Your portfolio is secure." |
| Reconciliation failed | "We're having trouble verifying your portfolio. Our team is looking into it." |
| Withdrawal rejected | "Your withdrawal could not be processed: [reason]." |
| Degraded explanations | "Simplified explanation shown. A detailed explanation will be available shortly." |

### Loading States

- Skeleton screens for all data-driven sections (no blank white screens, no spinners).
- Portfolio value shows the cached value immediately, updates when fresh data arrives.
- Charts show the last-known shape with a subtle pulse to indicate a refresh in progress.
