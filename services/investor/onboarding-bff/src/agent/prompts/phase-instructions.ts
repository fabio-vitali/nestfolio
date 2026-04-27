export const PHASE_INSTRUCTIONS: Record<string, string> = {
  goal: `PHASE: investment goal.
On this turn you MUST call render_options with these option items (labels MUST be in Italian, ids stay in English):
  - { id: "growth",      emoji: "📈", label: "Far crescere il capitale" }
  - { id: "real_estate", emoji: "🏠", label: "Acquistare un immobile" }
  - { id: "family",      emoji: "👨‍👩‍👧", label: "Pianificare per la famiglia" }
  - { id: "education",   emoji: "🎓", label: "Finanziare studi/formazione" }
  - { id: "retirement",  emoji: "🏖️", label: "Prepararsi alla pensione" }
  - { id: "other",       emoji: "💼", label: "Altro" }
Use an Italian title like "Qual è il tuo obiettivo principale di investimento?".
If the user replies with free text instead of clicking, map it to the closest id and confirm in Italian.
After confirmation call commit_phase with { phase: "goal", data: { goal: "<id>" } }.`,

  horizon: `PHASE: investment horizon.
On this turn you MUST call render_slider with min=1, max=30, step=1, unit="anni" and an Italian label such as "Per quanti anni intendi investire?".
After the user picks a value, confirm in Italian and call commit_phase with { phase: "horizon", data: { horizonYears: <N> } }.`,

  mode: `PHASE: account mode.
On this turn you MUST call render_mode_cards with these cards (Italian copy):
  - { id: "simulation", title: "Simulazione", badge: "Consigliato", details: ["Soldi virtuali", "Stesso algoritmo", "Passa al reale quando vuoi"] }
  - { id: "live",       title: "Reale",                            details: ["Denaro reale", "Rendimenti reali", "Richiede verifica identità"] }
After the user picks, confirm in Italian and call commit_phase with { phase: "mode", data: { accountMode: "simulation" | "live" } }.`,

  capital: `PHASE: initial capital.
On this turn you MUST call render_amount with currency="EUR", presets=[5000, 10000, 25000, 50000] and an Italian label such as "Quanto vuoi investire inizialmente?".
The user may also type a custom amount.
After the choice, confirm in Italian and call commit_phase with { phase: "capital", data: { capitalAmount: <N> } }.`,

  risk: `PHASE: risk profile (TWO sub-questions, ask them sequentially).

1. Risk tolerance — call render_options with these items (Italian labels):
   - { id: "hold",       emoji: "😌", label: "Non faccio nulla e aspetto" }
   - { id: "cautious",   emoji: "🤔", label: "Osservo con attenzione" }
   - { id: "selective",  emoji: "📊", label: "Rivedo selettivamente" }
   - { id: "aggressive", emoji: "⚡", label: "Agisco rapidamente" }

2. Experience level — call render_options with these items (Italian labels):
   - { id: "novice",       emoji: "🌱", label: "Principiante" }
   - { id: "beginner",     emoji: "📚", label: "Ho qualche nozione" }
   - { id: "intermediate", emoji: "📈", label: "Investo da qualche anno" }
   - { id: "expert",       emoji: "🎯", label: "Esperto" }

If the user types free text, interpret and confirm the category in Italian before continuing.
After both answers, call compute_risk_profile with the two indices, then commit_phase with { phase: "risk", data: { toleranceIdx, experienceIdx, riskProfile } }.`,

  operating_mode: `PHASE: operating mode.
On this turn you MUST call render_mode_cards with these cards (Italian copy):
  - { id: "conservative", title: "Conservativo", details: ["Bassa volatilità", "Rendimenti moderati", "Ribilanciamento raro"] }
  - { id: "balanced",     title: "Bilanciato",   badge: "Più scelto", details: ["Volatilità media", "Buoni rendimenti", "Ribilanciamento periodico"] }
  - { id: "aggressive",   title: "Aggressivo",   details: ["Alta volatilità", "Potenziali alti rendimenti", "Ribilanciamento frequente"] }
After the choice, confirm in Italian and call commit_phase with { phase: "operating_mode", data: { operatingMode: "conservative" | "balanced" | "aggressive" } }.`,

  mandate: `PHASE: mandate.
On this turn you MUST call render_summary with title="Riepilogo" and rows recapping all prior phase choices (Italian labels and values). Then call render_consent with the Italian mandate text "Autorizzo Nestfolio a gestire il mio portafoglio secondo le preferenze indicate".
If the user accepts, call commit_phase with { phase: "mandate", data: { mandateAccepted: true } }.
After commit, call render_cta with label="Vai alla Dashboard" and action="navigate:/dashboard".`,
};
