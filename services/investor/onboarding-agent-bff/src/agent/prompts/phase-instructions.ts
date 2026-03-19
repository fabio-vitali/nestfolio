export const PHASE_INSTRUCTIONS: Record<string, string> = {
  goal: `FASE: Obiettivo di investimento
Chiedi all'utente qual è il suo obiettivo principale. Usa render_options con queste opzioni:
- 📈 Far crescere il capitale
- 🏠 Acquistare un immobile
- 👨‍👩‍👧 Pianificare per la famiglia
- 🎓 Finanziare studi/formazione
- 🏖️ Prepararsi alla pensione
- 💼 Altro
Se l'utente scrive a testo libero, mappa al più vicino e conferma.
Dopo la conferma, chiama commit_phase con tool_input { phase: "goal", data: { goal: "<obiettivo>" } }.`,

  horizon: `FASE: Orizzonte temporale
Chiedi all'utente per quanti anni intende investire. Usa render_slider con min=1, max=30, step=1, unit="anni".
Dopo la scelta, conferma e chiama commit_phase con { phase: "horizon", data: { horizonYears: <N> } }.`,

  mode: `FASE: Modalità account
Chiedi se vuole iniziare in simulazione o con denaro reale. Usa render_mode_cards con:
- Simulazione: "Impara senza rischi", badge "Consigliato", details: ["Soldi virtuali", "Stesso algoritmo", "Passa al reale quando vuoi"]
- Reale: "Investi subito", details: ["Denaro reale", "Rendimenti reali", "Richiede verifica identità"]
Dopo la scelta, conferma e chiama commit_phase con { phase: "mode", data: { accountMode: "simulation"|"live" } }.`,

  capital: `FASE: Capitale iniziale
Chiedi quanto vuole investire inizialmente. Usa render_amount con currency="EUR" e presets=[5000, 10000, 25000, 50000].
L'utente può anche digitare un importo personalizzato.
Dopo la scelta, conferma e chiama commit_phase con { phase: "capital", data: { capitalAmount: <N> } }.`,

  risk: `FASE: Profilo di rischio
Raccogli il profilo di rischio con DUE domande separate:

1. Tolleranza al rischio — usa render_options:
   - 😌 Non faccio nulla e aspetto (hold)
   - 🤔 Osservo con attenzione (cautious)
   - 📊 Rivedo selettivamente (selective)
   - ⚡ Agisco rapidamente (aggressive)

2. Livello di esperienza — usa render_options:
   - 🌱 Principiante (novice)
   - 📚 Ho qualche nozione (beginner)
   - 📈 Investo da qualche anno (intermediate)
   - 🎯 Esperto (expert)

Se l'utente scrive a testo libero, interpreta e conferma la categoria prima di procedere.
Dopo entrambe le risposte, chiama compute_risk_profile con i due indici, poi commit_phase con { phase: "risk", data: { toleranceIdx, experienceIdx, riskProfile } }.`,

  operating_mode: `FASE: Modalità operativa
Chiedi la modalità operativa preferita. Usa render_mode_cards con:
- Conservativo: "Proteggi il capitale", details: ["Bassa volatilità", "Rendimenti moderati", "Ribilanciamento raro"]
- Bilanciato: "Equilibrio rischio-rendimento", badge "Più scelto", details: ["Volatilità media", "Buoni rendimenti", "Ribilanciamento periodico"]
- Aggressivo: "Massimizza i rendimenti", details: ["Alta volatilità", "Potenziali alti rendimenti", "Ribilanciamento frequente"]
Dopo la scelta, conferma e chiama commit_phase con { phase: "operating_mode", data: { operatingMode: "conservative"|"balanced"|"aggressive" } }.`,

  mandate: `FASE: Mandato
Mostra un riepilogo di tutte le scelte fatte usando render_summary. Poi mostra render_consent con il testo del mandato:
"Autorizzo Nestfolio a gestire il mio portafoglio secondo le preferenze indicate".
Se l'utente accetta, chiama commit_phase con { phase: "mandate", data: { mandateAccepted: true } }.
Dopo il commit, mostra render_cta con label="Vai alla Dashboard" e action="navigate:/dashboard".`,
};
