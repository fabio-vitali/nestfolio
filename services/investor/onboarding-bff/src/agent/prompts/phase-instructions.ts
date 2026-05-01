export const PHASE_INSTRUCTIONS: Record<string, string> = {
  goal: `PHASE: investment goal.
TITLE (Italian): "Qual è il tuo obiettivo principale di investimento?"
ON ENTRY: call render_options with the title above.
OPTIONS (tool args only — never list these in the assistant message):
  - { id: "growth",      emoji: "📈", label: "Far crescere il capitale" }
  - { id: "real_estate", emoji: "🏠", label: "Acquistare un immobile" }
  - { id: "family",      emoji: "👨‍👩‍👧", label: "Pianificare per la famiglia" }
  - { id: "education",   emoji: "🎓", label: "Finanziare studi/formazione" }
  - { id: "retirement",  emoji: "🏖️", label: "Prepararsi alla pensione" }
  - { id: "other",       emoji: "💼", label: "Altro" }
ON RESPONSE: call commit_phase with { phase: "goal", data: { goal: "<id>" } }. If the user replies with free text instead of clicking, map it to the closest id.`,

  operating_mode: `PHASE: operating mode.
TITLE (Italian): "Come vuoi che Nestfolio gestisca il tuo portafoglio?"
ON ENTRY: call render_mode_cards with the title above.
OPTIONS (tool args only — never list these in the assistant message):
  - { id: "conservative", title: "Conservativo", details: ["Bassa volatilità", "Rendimenti moderati", "Ribilanciamento raro"] }
  - { id: "balanced",     title: "Bilanciato",   badge: "Più scelto", details: ["Volatilità media", "Buoni rendimenti", "Ribilanciamento periodico"] }
  - { id: "aggressive",   title: "Aggressivo",   details: ["Alta volatilità", "Potenziali alti rendimenti", "Ribilanciamento frequente"] }
ON RESPONSE: call commit_phase with { phase: "operating_mode", data: { operatingMode: "conservative" | "balanced" | "aggressive" } }.`,

  horizon: `PHASE: investment horizon.
TITLE (Italian): "Per quanti anni intendi investire?"
ON ENTRY: call render_slider with the title above.
OPTIONS (tool args only): { min: 1, max: 30, step: 1, unit: "anni" }
ON RESPONSE: call commit_phase with { phase: "horizon", data: { horizonYears: <N> } }.`,

  capital: `PHASE: initial capital.
TITLE (Italian): "Quanto vuoi investire inizialmente?"
ON ENTRY: call render_amount with the title above.
OPTIONS (tool args only): { currency: "EUR", presets: [5000, 10000, 25000, 50000] }
ON RESPONSE: call commit_phase with { phase: "capital", data: { capitalAmount: <N> } }. The user may type a custom amount instead of clicking a preset.`,

  mandate_summary: `PHASE: mandate summary.
TITLE (Italian): "Riepilogo"
ON ENTRY: call render_summary with the title above.
OPTIONS (tool args only — populate rows from prior phase choices):
  - { label: "Obiettivo", value: "<Italian label of chosen goal>" }
  - { label: "Modalità",  value: "<Italian label of chosen operating mode>" }
  - { label: "Orizzonte", value: "<N> anni" }
  - { label: "Capitale",  value: "€ <amount>" }
ON RESPONSE: the user message will be exactly "Confermo". Call commit_phase with { phase: "mandate_summary", data: { confirmed: true } }.`,

  mandate_consent: `PHASE: mandate consent.
TITLE (Italian): "Autorizzo Nestfolio a gestire il mio portafoglio secondo le preferenze indicate"
ON ENTRY: call render_consent with the title above as the label.
ON RESPONSE: the user message will be "Accetto". Call commit_phase with { phase: "mandate_consent", data: { mandateAccepted: true }, allPhases: <accumulated phases> }. allPhases is an object: { goal: { objective: "<id>" }, horizon: { years: <N> }, capital: { amount: <N>, currency: "EUR" }, operatingMode: { mode: "<UPPERCASE>" }, mandate: { accepted: true } }.`,

  mandate_cta: `PHASE: dashboard CTA.
TITLE (Italian): "Vai alla Dashboard"
ON ENTRY: call render_cta with { label: "Vai alla Dashboard", action: "navigate:/dashboard" }.
DO NOT call commit_phase — the session was completed in the prior phase. The user's CTA click is handled by the browser to navigate to the dashboard.`,
};
