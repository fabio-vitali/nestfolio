export const PHASE_INSTRUCTIONS: Record<string, string> = {
  goal: `PHASE: investment goal.
On this turn you MUST call render_options with these option items (labels MUST be in Italian, ids stay in English lowercase):
  - { id: "growth",      emoji: "📈", label: "Far crescere il capitale" }
  - { id: "real_estate", emoji: "🏠", label: "Acquistare un immobile" }
  - { id: "family",      emoji: "👨‍👩‍👧", label: "Pianificare per la famiglia" }
  - { id: "education",   emoji: "🎓", label: "Finanziare studi/formazione" }
  - { id: "retirement",  emoji: "🏖️", label: "Prepararsi alla pensione" }
  - { id: "other",       emoji: "💼", label: "Altro" }
Use an Italian title like "Qual è il tuo obiettivo principale di investimento?".
If the user replies with free text instead of clicking, map it to the closest id and confirm in Italian.
After the user has chosen, call commit_phase with { phase: "goal", data: { goal: "<id>" } }.`,

  operating_mode: `PHASE: operating mode.
On this turn you MUST call render_mode_cards with these cards (Italian copy, ids stay lowercase English):
  - { id: "conservative", title: "Conservativo", details: ["Bassa volatilità", "Rendimenti moderati", "Ribilanciamento raro"] }
  - { id: "balanced",     title: "Bilanciato",   badge: "Più scelto", details: ["Volatilità media", "Buoni rendimenti", "Ribilanciamento periodico"] }
  - { id: "aggressive",   title: "Aggressivo",   details: ["Alta volatilità", "Potenziali alti rendimenti", "Ribilanciamento frequente"] }
After the choice, call commit_phase with { phase: "operating_mode", data: { operatingMode: "conservative" | "balanced" | "aggressive" } }.`,

  horizon: `PHASE: investment horizon.
On this turn you MUST call render_slider with min=1, max=30, step=1, unit="anni" and an Italian label such as "Per quanti anni intendi investire?".
After the user picks a value, call commit_phase with { phase: "horizon", data: { horizonYears: <N> } }.`,

  capital: `PHASE: initial capital.
On this turn you MUST call render_amount with currency="EUR", presets=[5000, 10000, 25000, 50000] and an Italian label such as "Quanto vuoi investire inizialmente?".
The user may also type a custom amount.
After the choice, call commit_phase with { phase: "capital", data: { capitalAmount: <N> } }.`,

  mandate_summary: `PHASE: mandate summary.
On this turn you MUST call render_summary with title="Riepilogo" and rows recapping all prior phase choices (Italian labels and values, e.g. "Obiettivo: Crescita", "Modalità: Bilanciato", "Orizzonte: 10 anni", "Capitale: € 50.000").
After the user clicks Confermo (the user message will be exactly "Confermo"), call commit_phase with { phase: "mandate_summary", data: { confirmed: true } }.`,

  mandate_consent: `PHASE: mandate consent.
On this turn you MUST call render_consent with the Italian mandate text "Autorizzo Nestfolio a gestire il mio portafoglio secondo le preferenze indicate".
After the user accepts (the user message will be "Accetto"), call commit_phase with { phase: "mandate_consent", data: { mandateAccepted: true }, allPhases: <accumulated phases> }. allPhases should be an object containing the prior phases keyed by their internal names: { goal: { objective: "<id>" }, horizon: { years: <N> }, capital: { amount: <N>, currency: "EUR" }, operatingMode: { mode: "<UPPERCASE>" }, mandate: { accepted: true } }.`,

  mandate_cta: `PHASE: dashboard CTA.
On this turn you MUST call render_cta with label="Vai alla Dashboard" and action="navigate:/dashboard".
Do NOT call commit_phase — the session has already been completed in the prior phase. The user's CTA click is handled by the browser to navigate to the dashboard.`,
};
