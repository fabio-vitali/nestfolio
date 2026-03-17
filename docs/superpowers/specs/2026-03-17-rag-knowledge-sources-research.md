# RAG Knowledge Sources for Robo-Advisory AI Agents — Research Findings

> Date: 2026-03-17 | Status: Research complete

---

## 1. RAG in Robo-Advisory / Wealth Management — Production Corpora

Production robo-advisory systems typically use these knowledge layers:

| Corpus Type | Used By | Notes |
|---|---|---|
| Fund prospectuses & factsheets | Wealthfront, Betterment, Vanguard Digital Advisor | Core for portfolio construction — expense ratios, holdings, risk profiles |
| SEC filings (10-K, 10-Q, 8-K) | Morgan Stanley (AI @ Morgan Stanley), JPMorgan IndexGPT | Fundamental analysis, earnings, risk factors sections |
| Regulatory docs (SEC, FINRA, MiFID II) | All regulated advisors | Suitability rules, disclosure requirements, compliance checks |
| Market commentary & research | BlackRock Aladdin, Morgan Stanley Wealth Management | Proprietary research + curated external sources |
| Client profile / risk questionnaire data | All robo-advisors | Stored in service DBs, not RAG — used for personalization |
| Economic indicators (FRED, BLS) | Wealthfront, Betterment | Macro data for rebalancing triggers |
| Tax code / IRS publications | Wealthfront (tax-loss harvesting) | IRS Pub 550, wash sale rules |

**Key insight**: Morgan Stanley's "AI @ Morgan Stanley" (built on OpenAI) uses ~100K internal research documents as its RAG corpus. JPMorgan's IndexGPT focuses on SEC filings + proprietary research. BlackRock Aladdin integrates structured risk models, not just text RAG. Most production systems combine structured data APIs with unstructured document RAG.

---

## 2. Financial News Feeds for AI Agents

### Tier 1: Affordable / Free

| Source | Format | Cost | RAG Suitability |
|---|---|---|---|
| **Alpha Vantage News & Sentiment** | JSON (REST API) | Free: 25 req/day; Premium: $49.99–$249.99/mo (75–1200 req/min) | HIGH — returns title, summary, sentiment scores per ticker, topic tags. Covers 50+ news outlets. Filter by ticker/topic. |
| **Alpha Vantage Earnings Call Transcripts** | JSON | Same plans as above | HIGH — full earnings call text, queryable by ticker+quarter |
| **Alpha Vantage MCP Server** | MCP protocol | Same key | Direct LLM integration via `mcp.alphavantage.co` |
| **SEC EDGAR EFTS (Full-Text Search)** | JSON (REST) | FREE, no API key | MEDIUM — search filings by keyword, form type, date range. URL: `efts.sec.gov/LATEST/search-index` |
| **FRED (Federal Reserve Economic Data)** | JSON/XML (REST) | FREE (API key required, no cost) | HIGH for macro data — GDP, CPI, interest rates, treasury yields. 800K+ time series. |
| **Yahoo Finance** | Unofficial APIs / yfinance Python lib | Free (unofficial, may break) | LOW reliability — no official API, scraping risk |

### Tier 2: Professional

| Source | Format | Cost | RAG Suitability |
|---|---|---|---|
| **Benzinga** | REST API, WebSocket, TCP, Webhooks | Enterprise pricing (contact sales) | HIGH — real-time news, analyst ratings, SEC filings, options activity. OpenAPI spec available. |
| **Polygon.io** | REST + WebSocket | $29–$199/mo (stocks); enterprise for news | HIGH — ticker news, market data, reference data |
| **Finnhub** | REST + WebSocket | Free tier + $50–$500/mo | MEDIUM — company news, SEC filings, earnings calendars |
| **Intrinio** | REST | $75–$500/mo | HIGH — financial data + news feeds |

### Tier 3: Enterprise

| Source | Format | Cost | RAG Suitability |
|---|---|---|---|
| **Bloomberg B-PIPE / BLPAPI** | Proprietary | $20K+/yr | HIGHEST — gold standard, but overkill for robo-advisory POC |
| **Reuters/Refinitiv Eikon** | REST + Streaming | $10K+/yr | HIGH — news, fundamentals, estimates |
| **S&P Capital IQ** | REST | Enterprise | HIGH — deep fundamentals + research |

### Recommendation for Nestfolio
Start with **Alpha Vantage** ($49.99/mo) for news + sentiment + earnings transcripts + fundamentals. Supplement with **FRED** (free) for macro indicators. Add **SEC EDGAR** (free) for filings. This gives broad coverage for <$50/mo total.

---

## 3. SEC EDGAR Filings as RAG Corpus

### Is it practical? YES — highly practical and free.

**API Access (no authentication required):**
- `data.sec.gov/submissions/CIK{10-digit}.json` — filing history per entity, updated real-time
- `data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json` — structured XBRL financial data
- `data.sec.gov/api/xbrl/companyconcept/` — specific accounting concepts across companies
- `efts.sec.gov/LATEST/search-index` — full-text search across all filings
- Bulk ZIP download updated nightly at 3:00 AM ET

**Most useful filing types for RAG:**

| Filing | Use Case | RAG Value |
|---|---|---|
| **10-K** (Annual Report) | Business description, risk factors, financial statements, MD&A | HIGHEST — comprehensive company overview |
| **10-Q** (Quarterly) | Quarterly financials, interim risk updates | HIGH — timely financial data |
| **8-K** (Current Events) | Material events: M&A, leadership changes, earnings | HIGH — event-driven analysis |
| **DEF 14A** (Proxy) | Executive compensation, governance, shareholder proposals | MEDIUM — governance analysis |
| **13F-HR** | Institutional holdings | MEDIUM — who owns what |
| **S-1** | IPO prospectus | MEDIUM — new company analysis |

**Open-source tools for EDGAR RAG:**

| Project | Stars | What it does |
|---|---|---|
| `jadchaar/sec-edgar-downloader` | 667 | Python library to download any filing type by ticker/CIK. Supports ALL SEC form types. |
| `alphanome-ai/sec-parser` | 277 | Parses EDGAR HTML into semantic tree structure — ideal for chunking into RAG. Handles 10-K, 10-Q section extraction. |
| LlamaIndex `SECFilingsLoader` | (part of llama_index) | Built-in loader for SEC filings, integrates directly with LlamaIndex RAG pipelines |
| `nlpaueb/sec-bert` | ~200 | Pre-trained BERT model on SEC filings (for NER, classification) |
| 60+ repos on GitHub topic `sec-edgar` | — | Python (35), Jupyter Notebook (8), R (3), TypeScript (1) |

**Practical pipeline**: `sec-edgar-downloader` (fetch) --> `sec-parser` (parse/chunk) --> Bedrock KB (embed + index via S3 or custom connector)

---

## 4. Fund Factsheets / Prospectus Documents as RAG

### Are they useful? YES — essential for portfolio construction agents.

**What they contain:**
- Investment objective & strategy
- Top holdings and sector allocation
- Expense ratio, yield, turnover
- Risk/return statistics (Sharpe ratio, standard deviation, beta)
- Benchmark comparison
- Distribution history

**Where to get them:**

| Source | Access | Format | Notes |
|---|---|---|---|
| **Vanguard** (VTI, BND, etc.) | vanguard.com/pub/Pdf/ | PDF | Direct download per fund. No developer API (SSL blocks programmatic access). |
| **iShares/BlackRock** | ishares.com | PDF + API | Fund data API available for institutional clients |
| **Invesco** (QQQ) | invesco.com | PDF | Factsheets and prospectuses freely available |
| **SEC EDGAR N-1A filings** | data.sec.gov | HTML/XBRL | ETF/mutual fund registration statements — machine-readable |
| **Alpha Vantage ETF Profile & Holdings** | REST API | JSON | Returns ETF metadata, top holdings, sector weights, asset allocation. API endpoint: `function=ETF_PROFILE` |
| **Morningstar Open API** | morningstar.com | JSON | Some data available; mostly behind paywall |

**Recommended approach**: Use **Alpha Vantage ETF_PROFILE** API for structured fund data (JSON, easy to ingest). Supplement with **PDF factsheets** from fund providers, ingested into Bedrock KB via S3 (PDF is a supported format, max 50MB). For deeper analysis, use **SEC EDGAR N-1A filings** via the EDGAR API.

---

## 5. Regulatory Knowledge Bases for Compliance

### Available structured/semi-structured sources:

| Source | URL | Format | Coverage |
|---|---|---|---|
| **SEC Rules & Regulations** | sec.gov/rules | HTML, PDF | Investment Advisers Act, Securities Act, all SEC rules |
| **FINRA Rules** | finra.org/rules-guidance/rulebooks/finra-rules | HTML | Suitability (Rule 2111), Know-Your-Customer (Rule 2090), communications |
| **FINRA Regulatory Notices** | finra.org/rules-guidance/notices | HTML, PDF | Interpretive guidance, enforcement actions |
| **CFR Title 17** (Securities) | ecfr.gov | XML, JSON API | Machine-readable federal securities regulations |
| **MiFID II texts** | eur-lex.europa.eu | HTML, PDF, XML (Akoma Ntoso) | Full directive + delegated acts; EUR-Lex has structured XML |
| **ESMA Guidelines** | esma.europa.eu | PDF | MiFID II implementation guidelines, Q&As |
| **IRS Publications** | irs.gov/publications | PDF, HTML | Tax rules relevant to investment advice (Pub 550, 590, etc.) |

**Key insight for Nestfolio compliance agent**: The most practical approach is to curate a focused corpus:
1. **FINRA Rules 2090 + 2111** (KYC + Suitability) — these are the core rules for robo-advisory
2. **SEC Reg BI** (Regulation Best Interest) — the standard for broker-dealer advice
3. **SEC Investment Advisers Act of 1940** — fiduciary duty rules
4. **MiFID II Articles 24-25** (if EU scope) — investor protection, suitability assessment
5. **ESMA MiFID II Suitability Guidelines** (ESMA35-43-3172)

These are all publicly available as HTML/PDF. Ingest into Bedrock KB via S3. Total corpus: ~500 pages of focused regulatory text.

---

## 6. Market Commentary / Research Reports — Free or Affordable

| Source | Cost | Format | Quality |
|---|---|---|---|
| **FRED Blog** (fredblog.stlouisfed.org) | Free | HTML/RSS | HIGH — Fed economists' macro analysis |
| **Alpha Vantage News & Sentiment** | Free–$49.99/mo | JSON API | MEDIUM — aggregated from 50+ outlets with sentiment scores |
| **Alpha Vantage Earnings Call Transcripts** | Same | JSON API | HIGH — full transcripts, searchable by ticker |
| **Federal Reserve speeches & reports** | Free | PDF/HTML | HIGH — FOMC minutes, Beige Book, governor speeches |
| **IMF World Economic Outlook** | Free | PDF | HIGH — global macro analysis |
| **World Bank Open Data** | Free | API (JSON) | MEDIUM — development indicators |
| **Seeking Alpha** | Free tier + $239/yr premium | HTML/RSS | MEDIUM — crowdsourced analysis, variable quality |
| **Morningstar articles** | Free tier | HTML | MEDIUM-HIGH — fund analysis, market outlook |
| **Reuters free news** | Free (limited) | RSS/HTML | HIGH quality, limited volume |
| **Financial Times (free articles)** | Free (limited) | HTML | HIGHEST quality, very limited free access |

**Recommended for Nestfolio**: Alpha Vantage news API (already paying for it) + FRED Blog RSS + Federal Reserve publications. These give macro + micro coverage at near-zero cost.

---

## 7. AWS Bedrock Knowledge Base — Data Source Connectors

### Supported connectors (from AWS docs):

| Connector | Type | Notes |
|---|---|---|
| **Amazon S3** | File store | PDF, TXT, MD, HTML, DOC/DOCX, CSV, XLS/XLSX. Max 50MB/file. **Supports multimodal** (images, tables). |
| **Confluence** | SaaS | Ingests Confluence pages/spaces |
| **Microsoft SharePoint** | SaaS | Ingests SharePoint documents |
| **Salesforce** | SaaS | Ingests Salesforce knowledge articles, cases |
| **Web Crawler** | Web | Crawls and indexes web pages (URL seed list) |
| **Custom Data Source** | Programmatic | **KEY FOR NESTFOLIO** — `KnowledgeBaseDocuments` API for direct document ingestion. No sync needed. Supports inline content + metadata. Multimodal supported (up to 10MB base64). |

### Can it ingest from RSS/API feeds?
**Not directly.** There is no native RSS or REST API connector. However:

1. **Web Crawler** can crawl RSS-linked pages if they are HTML
2. **Custom Data Source** is the intended solution — you write a Lambda that fetches from APIs/RSS, then calls `KnowledgeBaseDocuments` API to ingest
3. **S3** is the traditional approach — Lambda fetches data, writes to S3, triggers KB sync

### Recommended architecture for Nestfolio:

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Scheduled Lambda │────>│ S3 Bucket    │────>│ Bedrock KB          │
│ (EventBridge)   │     │ /rag-corpus/ │     │ (auto-sync on S3    │
│                 │     │              │     │  change or schedule) │
│ Fetches:        │     │ Stores:      │     │                     │
│ - AV News API   │     │ - news.json  │     │ Indexes:            │
│ - EDGAR filings │     │ - filings/   │     │ - All S3 docs       │
│ - FRED data     │     │ - macro/     │     │ - Fund factsheets   │
│ - Fund PDFs     │     │ - funds/     │     │ - Regulatory docs   │
│ - Reg docs      │     │ - regs/      │     │                     │
└─────────────────┘     └──────────────┘     └─────────────────────┘
```

**Alternative**: Use Custom Data Source connector with `KnowledgeBaseDocuments` API for real-time ingestion without S3 intermediary. Better for frequently-updated content (news, 8-K filings).

---

## Summary: Practical Stack for Nestfolio RAG

| Layer | Source | Cost | Connector |
|---|---|---|---|
| **News + Sentiment** | Alpha Vantage NEWS_SENTIMENT API | $49.99/mo | Lambda -> S3 -> Bedrock KB |
| **Earnings Transcripts** | Alpha Vantage EARNINGS_CALL_TRANSCRIPT | included | Lambda -> S3 -> Bedrock KB |
| **SEC Filings** | EDGAR API (data.sec.gov) | FREE | Lambda -> sec-parser -> S3 -> Bedrock KB |
| **Fund Data** | Alpha Vantage ETF_PROFILE + PDF factsheets | included + manual | S3 -> Bedrock KB |
| **Macro Indicators** | FRED API | FREE | Lambda -> S3 -> Bedrock KB |
| **Regulatory Docs** | SEC.gov, FINRA.org, EUR-Lex | FREE | Manual upload or Web Crawler -> Bedrock KB |
| **Market Commentary** | FRED Blog + Fed speeches | FREE | Web Crawler -> Bedrock KB |

**Total recurring cost: ~$50/mo** (Alpha Vantage premium plan) + AWS Bedrock KB costs.

---

## Source URLs

- SEC EDGAR API: https://www.sec.gov/edgar/sec-api-documentation
- Alpha Vantage API: https://www.alphavantage.co/documentation/
- Alpha Vantage MCP Server: https://mcp.alphavantage.co/
- Alpha Vantage Pricing: https://www.alphavantage.co/premium/
- Benzinga API Docs: https://docs.benzinga.io/benzinga/getting-started
- FRED API: https://fred.stlouisfed.org/docs/api/fred/
- Bedrock KB Data Sources: https://docs.aws.amazon.com/bedrock/latest/userguide/data-source-connectors.html
- Bedrock Custom Connector: https://docs.aws.amazon.com/bedrock/latest/userguide/custom-data-source-connector.html
- sec-edgar-downloader: https://github.com/jadchaar/sec-edgar-downloader (667 stars)
- sec-parser: https://github.com/alphanome-ai/sec-parser (277 stars)
- LlamaIndex: https://github.com/run-llama/llama_index
- GitHub SEC-EDGAR topic: https://github.com/topics/sec-edgar (60 repos)
- FINRA Rules: https://www.finra.org/rules-guidance/rulebooks/finra-rules
- eCFR Title 17: https://www.ecfr.gov/current/title-17
- EUR-Lex MiFID II: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0065
