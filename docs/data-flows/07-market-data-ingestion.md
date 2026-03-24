# Feature #7 — Market Data Ingestion (Happy Path)

**Trigger**: EventBridge Scheduler invokes each adapter on a 24-hour cycle.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Scheduler"]
        S1["EventBridge Schedule"]
    end
    subgraph subGraph1["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        A1["alpha-vantage-adpt: News + Sentiment"]
        A2["fred-adpt: Treasury + Inflation"]
        A3["yahoo-finance-adpt: Quotes + Prices"]
        A4["marketwatch-adpt: Market News"]
        A5["sec-edgar-adpt: SEC Filings"]
        A6["Persist to DDB"]
        A7["CDC Publish"]
    end
    subgraph subGraph2["Consumer"]
        B1["advisory-ctrl: Agent Context"]
    end
    S1 --> A1 & A2 & A3 & A4 & A5
    A1 & A2 & A3 & A4 & A5 --> A6
    A6 --> A7
    A7 --> AB
    AB --> B1

    S1:::scheduler
    A1:::advisory
    A2:::advisory
    A3:::advisory
    A4:::advisory
    A5:::advisory
    A6:::advisory
    A7:::advisory
    AB:::bus
    B1:::advisory
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef scheduler fill:#E8D6FF,stroke:#6A3AB0,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | EventBridge Scheduler | — | Cron (rate 24h) | Invoke fetch-trigger Lambda per adapter | Service-specific FETCH_*_REQUESTED | AdvisoryBus |
| 2 | alpha-vantage-adpt | Advisory | FETCH_ALPHA_VANTAGE_REQUESTED | Fetch news + economic indicators from Alpha Vantage API | _(DDB persist)_ | — |
| 2 | fred-adpt | Advisory | FETCH_FRED_REQUESTED | Fetch treasury yields + inflation from FRED API | _(DDB persist)_ | — |
| 2 | yahoo-finance-adpt | Advisory | FETCH_YAHOO_FINANCE_REQUESTED | Fetch quotes + price history from Yahoo Finance | _(DDB persist)_ | — |
| 2 | marketwatch-adpt | Advisory | FETCH_MARKETWATCH_REQUESTED | Fetch market news from MarketWatch | _(DDB persist)_ | — |
| 2 | sec-edgar-adpt | Advisory | FETCH_SEC_EDGAR_REQUESTED | Fetch SEC filings from EDGAR | _(DDB persist)_ | — |
| 3 | Each adapter | Advisory | DDB Stream CDC | Publish materialized data events | MARKET_DATA_* events | AdvisoryBus |
| 4 | advisory-ctrl | Advisory | Market data events | Use as context for agent invocations (knowledge base) | _(consumed internally)_ | — |
