# Free Financial Knowledge Sources — Concrete Research Findings

> Date: 2026-03-17 | Status: Research complete | Scope: FREE sources ONLY (no paid APIs, no trials, no credit card)

---

## 1. Free Market News RSS Feeds

| Source | Feed URL | Format | Notes |
|---|---|---|---|
| **Yahoo Finance** | `https://feeds.finance.yahoo.com/rss/2.0/headline?s=TICKER&region=US&lang=en-US` | RSS 2.0 | Replace `TICKER` with stock symbol (e.g., `s=VTI,BND,QQQ`). Multiple tickers comma-separated. Unofficial but stable. |
| **MarketWatch** | `https://feeds.marketwatch.com/marketwatch/topstories/` | RSS 2.0 | Also: `/marketwatch/marketpulse/`, `/marketwatch/realtimeheadlines/` |
| **SEC RSS Feeds** | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-k&company=&dateb=&owner=include&start=0&count=40&output=atom` | Atom | Latest 10-K filings. Change `type=` for other form types (10-Q, 8-K, etc.). Also per-company feeds via Company Search. |
| **SEC RSS Hub** | `https://www.sec.gov/about/secrss.shtml` | Various | Index of all SEC RSS feeds |
| **FRED Blog** | `https://fredblog.stlouisfed.org/feed/` | RSS 2.0 | Fed economists' macro analysis articles |
| **Federal Reserve** | `https://www.federalreserve.gov/feeds/press_all.xml` | RSS 2.0 | Press releases, speeches, FOMC statements. Also: `/feeds/speeches.xml`, `/feeds/press_monetary.xml` |
| **CNBC** | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114` | RSS 2.0 | Finance section. Other IDs for different sections. |
| **Reuters** | No free RSS feed available since 2023 redesign | N/A | Reuters killed their public RSS feeds. No free tier API. |
| **Google Finance** | No RSS feed | N/A | Google News RSS works: `https://news.google.com/rss/search?q=finance` but not structured financial data |

### Programmatic Access Notes
- Yahoo Finance RSS is **unofficial** — no SLA, may change without notice. The `yfinance` Python package is more reliable for data but is also unofficial.
- SEC RSS feeds are **official** and **stable** — government-backed, Atom format, machine-parseable.
- All RSS feeds can be polled on a schedule via Lambda/EventBridge.

---

## 2. SEC EDGAR — Free Programmatic Access

### APIs (NO authentication, NO API key required)

| Endpoint | URL Pattern | Returns |
|---|---|---|
| **Submissions** | `https://data.sec.gov/submissions/CIK{10-digit}.json` | Filing history, metadata, ticker, exchanges. Updated real-time. |
| **Company Facts (XBRL)** | `https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json` | All structured financial data for a company |
| **Company Concept** | `https://data.sec.gov/api/xbrl/companyconcept/CIK{10-digit}/us-gaap/{concept}.json` | Specific accounting concept across filings (e.g., `Revenue`, `Assets`) |
| **XBRL Frames** | `https://data.sec.gov/api/xbrl/frames/us-gaap/{concept}/USD/CY2024Q1I.json` | Cross-company comparison for a concept in a specific period |
| **Full-Text Search** | `https://efts.sec.gov/LATEST/search-index?q=QUERY&forms=10-K&dateRange=custom&startdt=2024-01-01&enddt=2026-03-17` | Full-text search across all filings since 2001. JSON response. |
| **EDGAR Full-Text Search UI** | `https://efts.sec.gov/LATEST/search-index` | Same API, also exposed at `https://www.sec.gov/cgi-bin/srqsb` |

### Rate Limits
- **10 requests per second** per user (across all machines)
- **Must declare a User-Agent** header: `User-Agent: CompanyName admin@company.com`
- No API key required
- IP will be blocked if you exceed rate limits or use unidentified bots

### Bulk Downloads (nightly at ~3:00 AM ET)
- All company facts: `https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip`
- All submissions: `https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip`
- Daily index files: `https://www.sec.gov/Archives/edgar/daily-index/` (HTML, XML, JSON)
- Full archive: `https://www.sec.gov/Archives/edgar/full-index/`

### Filing Formats
- **HTML** — primary format for most filings (human-readable)
- **XBRL/iXBRL** — structured financial data, machine-parseable
- **Plain text** — older filings, SGML-based
- **PDF** — some filings include PDF exhibits

### ETF-Related CIKs for Vanguard, BlackRock, Invesco
| Issuer | CIK | Example URL |
|---|---|---|
| **Vanguard Group** | `0000102909` | `https://data.sec.gov/submissions/CIK0000102909.json` |
| **BlackRock (iShares)** | `0000088053` (BlackRock Fund Advisors) | `https://data.sec.gov/submissions/CIK0000088053.json` |
| **Invesco** | `0000914208` (Invesco QQQ Trust) | `https://data.sec.gov/submissions/CIK0000914208.json` |

### Open-Source Tools
| Tool | URL | Purpose |
|---|---|---|
| `sec-edgar-downloader` | https://github.com/jadchaar/sec-edgar-downloader | Download any filing type by ticker/CIK (Python) |
| `sec-parser` | https://github.com/alphanome-ai/sec-parser | Parse EDGAR HTML into semantic sections for RAG chunking |
| `edgartools` | https://github.com/dgunning/edgartools | Modern Python EDGAR client with rich display |

---

## 3. ETF Factsheets & Prospectuses — Free Downloads

### Vanguard ETFs

| Fund | Factsheet URL | Prospectus |
|---|---|---|
| **VTI** (Total Stock Market) | `https://personal.vanguard.com/us/FundsByName?FundType=ExchangeTradedShares&FundIntExt=INT&TableViewOption=ALL` then navigate | Prospectus on EDGAR: search CIK `0000102909`, form type `485BPOS` |
| **BND** (Total Bond Market) | Same navigation pattern | Same EDGAR approach |
| **VTIP** (Short-Term TIPS) | Same navigation pattern | Same EDGAR approach |

**Direct programmatic approach**: Vanguard blocks automated downloads (SSL/bot detection). Use **SEC EDGAR** instead:
- Fund prospectuses are filed as **Form 485BPOS** (post-effective amendments) or **N-1A** (registration statement)
- URL pattern: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000102909&type=485BPOS&dateb=&owner=include&count=10`
- These are HTML format, machine-parseable

### iShares/BlackRock ETFs

| Fund | Direct PDF | Notes |
|---|---|---|
| **IVV, AGG, etc.** | `https://www.ishares.com/us/literature/fact-sheet/` + fund-specific slug | iShares factsheets are freely downloadable PDFs |
| **Programmatic** | iShares.com blocks bots. Use EDGAR instead (CIK `0000088053`) | Form 485BPOS for prospectuses |

### Invesco QQQ

| Fund | URL | Notes |
|---|---|---|
| **QQQ** Factsheet | `https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&productId=ETF-QQQ` | Factsheet PDF link on product page |
| **Programmatic** | Use EDGAR CIK `0000914208`, form `485BPOS` | HTML prospectus |

### Best Free Programmatic Approach
All ETF prospectuses are **legally required** to be filed with the SEC. Use EDGAR API to access them — no bot-blocking, no scraping needed:
```
https://efts.sec.gov/LATEST/search-index?q="total stock market"&forms=485BPOS,N-1A&dateRange=custom&startdt=2025-01-01
```

---

## 4. Regulatory Documents — Free Access

### FINRA Rules

| Document | URL | Format |
|---|---|---|
| **Rule 2090 (KYC)** | `https://www.finra.org/rules-guidance/rulebooks/finra-rules/2090` | HTML (full text, free) |
| **Rule 2111 (Suitability)** | `https://www.finra.org/rules-guidance/rulebooks/finra-rules/2111` | HTML (full text, free) |
| **FINRA Rulebook API** | `https://developer.finra.org/docs#query_api-finra_content-finra_rulebook` | REST API (JSON) — free developer access |
| **FINRA Rules 2090+2111 SEC Filing** | `https://www.sec.gov/files/rules/sro/finra/2010/34-62718a.pdf` | PDF — original SEC approval order |
| **Regulatory Notice 11-25** | `https://www.finra.org/sites/default/files/NoticeDocument/p123701.pdf` | PDF — KYC+Suitability implementation guidance |
| **FIRST Search Tool** | `https://www.finra.org/rules-guidance/rulebooks/finra-rulebook-search-tool-first` | Interactive search across 40 FINRA rules |

### SEC Regulation Best Interest (Reg BI)

| Document | URL | Format |
|---|---|---|
| **Final Rule (Federal Register)** | `https://www.govinfo.gov/content/pkg/FR-2019-07-12/pdf/2019-12164.pdf` | PDF (770 pages, full text) |
| **SEC Reg BI Landing Page** | `https://www.sec.gov/resources-small-businesses/small-business-compliance-guides/regulation-best-interest` | HTML — summary + links |
| **Rule Text + Interpretations** | `https://www.sec.gov/about/divisions-offices/division-trading-markets/regulation-best-interest-form-crs-related-interpretations` | HTML — organized by topic |
| **Federal Register HTML** | `https://www.federalregister.gov/documents/2019/07/12/2019-12164/regulation-best-interest-the-broker-dealer-standard-of-conduct` | HTML (full text, structured) |

### Investment Advisers Act of 1940

| Document | URL | Format |
|---|---|---|
| **Full Text (SEC)** | `https://www.sec.gov/investment/laws-and-rules` | HTML + links to statute |
| **Full Text (GovInfo)** | `https://uscode.house.gov/view.xhtml?path=/prelim@title15/chapter2D/subchapter2&edition=prelim` | HTML — Title 15 USC Chapter 2D, Subchapter II |
| **eCFR (regulations)** | `https://www.ecfr.gov/current/title-17/chapter-II/part-275` | XML, JSON API — 17 CFR Part 275 (Investment Advisers Act rules) |

### MiFID II

| Document | URL | Format |
|---|---|---|
| **Directive 2014/65/EU (MiFID II)** | `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0065` | HTML, PDF, XML (Akoma Ntoso) |
| **Articles 24-25 (Investor Protection)** | Same URL, navigate to Articles 24-25 | HTML — suitability assessment, disclosure |
| **MiFIR (Regulation)** | `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014R0600` | HTML, PDF, XML |
| **ESMA Suitability Guidelines** | `https://www.esma.europa.eu/document/guidelines-certain-aspects-mifid-ii-suitability-requirements-0` | PDF |

### eCFR JSON API (Machine-Readable Federal Regulations)
The eCFR provides a **free REST API** for all federal regulations:
- Base URL: `https://www.ecfr.gov/api/versioner/v1/`
- Securities regulations: `https://www.ecfr.gov/api/versioner/v1/full/current/title-17.xml`
- No API key required. XML and JSON formats.

---

## 5. FRED API — Detailed Findings

### Access
- **Cost**: Completely FREE
- **API Key**: Required (free registration at `https://fredaccount.stlouisfed.org/apikey`)
- **No credit card** required, no trial period

### Rate Limits
- **120 requests per minute** (per API key)
- No daily limit documented
- Generous for any reasonable use case

### Data Format
- **JSON** and **XML** supported (specify via `file_type=json` or `file_type=xml`)
- RESTful API over HTTPS
- Base URL: `https://api.stlouisfed.org/fred/`

### Key Endpoints

| Endpoint | URL | Purpose |
|---|---|---|
| **Series Observations** | `/fred/series/observations?series_id=GDP&api_key=KEY&file_type=json` | Get data values for a series |
| **Series Search** | `/fred/series/search?search_text=inflation&api_key=KEY&file_type=json` | Search 800K+ series by keyword |
| **Categories** | `/fred/category/series?category_id=125&api_key=KEY` | Browse series by category |
| **Releases** | `/fred/releases?api_key=KEY` | All data releases |

### Key Macro Indicators Available (800K+ series)

| Series ID | Indicator | Frequency |
|---|---|---|
| `GDP` | Gross Domestic Product | Quarterly |
| `CPIAUCSL` | Consumer Price Index (All Urban) | Monthly |
| `UNRATE` | Unemployment Rate | Monthly |
| `FEDFUNDS` | Federal Funds Effective Rate | Daily/Monthly |
| `DGS10` | 10-Year Treasury Constant Maturity Rate | Daily |
| `DGS2` | 2-Year Treasury Rate | Daily |
| `T10Y2Y` | 10Y-2Y Treasury Spread (yield curve) | Daily |
| `VIXCLS` | CBOE Volatility Index (VIX) | Daily |
| `SP500` | S&P 500 Index | Daily |
| `DTWEXBGS` | Trade-Weighted US Dollar Index | Daily |
| `MORTGAGE30US` | 30-Year Fixed Mortgage Rate | Weekly |
| `UMCSENT` | University of Michigan Consumer Sentiment | Monthly |
| `PAYEMS` | Total Nonfarm Payrolls | Monthly |
| `HOUST` | Housing Starts | Monthly |
| `RSAFS` | Retail Sales (Total) | Monthly |

### Python Client
```bash
pip install fredapi
```
```python
from fredapi import Fred
fred = Fred(api_key='YOUR_KEY')
data = fred.get_series('GDP')  # Returns pandas Series
```

---

## 6. Free Financial Education Content (for Explainability RAG)

### Open Educational Resources (CC Licensed)

| Resource | License | URL | RAG Suitability |
|---|---|---|---|
| **"Personal Finance: Your Money, Your Life"** | CC BY 4.0 | `https://pressbooks.pub/personalfinance/` | HIGH — covers financial statements, budgeting, investing, risk management. Free to adapt and redistribute. HTML chapters, easy to chunk. |
| **"Principles of Finance" (OpenStax)** | CC BY 4.0 | `https://openstax.org/details/books/principles-finance` | HIGH — college textbook covering all finance fundamentals. Free PDF + web. Excellent for explainability. |
| **OER Commons Finance** | Various CC | `https://oercommons.org/browse?f.keyword=finance` | MEDIUM — aggregator of 50K+ OER resources, filter by finance. Mixed quality. |
| **Khan Academy Finance** | CC BY-NC-SA 3.0 | `https://www.khanacademy.org/economics-finance-domain` | HIGH — clear explanations. Caveat: NC license means no commercial use without permission. |
| **Saylor Academy Finance** | CC BY | `https://learn.saylor.org/course/index.php?categoryid=7` | MEDIUM — curated OER courses on finance, banking, investments |
| **FRED Blog** | Public (Fed publication) | `https://fredblog.stlouisfed.org/` | HIGH — economist-written macro analysis, government work = public domain |
| **SEC Investor.gov** | Public domain (government) | `https://www.investor.gov/` | HIGH — investor education from SEC. Plain language. Public domain = no license restrictions. |
| **FINRA Investor Education** | Public | `https://www.finra.org/investors` | HIGH — investing basics, warnings, tools. Authoritative. |

### License Implications for RAG
- **CC BY 4.0**: Can use commercially, must attribute. BEST for RAG.
- **CC BY-NC-SA**: Cannot use commercially (Khan Academy). Avoid for production RAG.
- **Public domain / Government works**: No restrictions at all. SEC, FRED, FINRA content is ideal.
- **Investopedia**: All Rights Reserved. CANNOT be used for RAG corpus without license agreement.

### Recommended Corpus for Explainability RAG
1. **SEC Investor.gov** articles (public domain) — "What is a mutual fund?", "How bonds work", etc.
2. **OpenStax Principles of Finance** textbook (CC BY 4.0) — comprehensive, citable
3. **FRED Blog** articles (public domain) — macro explainers
4. **FINRA Investor Education** (public) — regulatory context, investor protection

---

## 7. Alpha Vantage Free Tier — What's Actually Free

### Free Tier Details
- **Cost**: $0 (free API key at `https://www.alphavantage.co/support/#api-key`)
- **Rate limit**: **25 requests per day** (changed from previous 5/min + 500/day)
- **No credit card** required

### What's Available on Free Tier

| Category | Endpoints | Free? | Notes |
|---|---|---|---|
| **Core Stock Data** | TIME_SERIES_INTRADAY, DAILY, WEEKLY, MONTHLY | YES (25/day) | Historical + real-time prices |
| **Quote** | GLOBAL_QUOTE | YES | Latest price for a ticker |
| **Search** | SYMBOL_SEARCH | YES | Ticker lookup |
| **Fundamental Data** | OVERVIEW, INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW, EARNINGS | YES | Company financials |
| **ETF Profile** | ETF_PROFILE | YES | Holdings, sector weights, expense ratio |
| **News & Sentiment** | NEWS_SENTIMENT | YES | Aggregated news with sentiment scores per ticker. Covers 50+ outlets. |
| **Earnings Transcripts** | EARNINGS_CALL_TRANSCRIPT | YES | Full earnings call transcripts |
| **Economic Indicators** | REAL_GDP, CPI, INFLATION, FEDERAL_FUNDS_RATE, TREASURY_YIELD, UNEMPLOYMENT | YES | Macro data (sourced from FRED) |
| **Commodities** | WTI, BRENT, NATURAL_GAS, COPPER, etc. | YES | Commodity prices |
| **Crypto** | CRYPTO_EXCHANGE_RATE, DIGITAL_CURRENCY_DAILY | YES | Crypto prices |
| **Technical Indicators** | SMA, EMA, RSI, MACD, BBANDS, + 50 more | YES | All technical indicators |
| **Options** | REALTIME_OPTIONS, HISTORICAL_OPTIONS | NO (Premium only) | Requires paid plan |
| **Bulk Quotes** | REALTIME_BULK_QUOTES | NO (Premium only) | Requires paid plan |

### Key Limitation
At **25 requests/day**, the free tier is viable for:
- Manual testing and development
- Low-volume daily batch jobs (e.g., fetch 25 tickers' daily data)
- NOT viable for production real-time feeds

### Premium Plans (for reference)
| Plan | Price | Requests |
|---|---|---|
| Free | $0 | 25/day |
| Premium 75 | $49.99/mo | 75/min (no daily limit) |
| Premium 150 | $99.99/mo | 150/min |
| Premium 300 | $149.99/mo | 300/min |
| Premium 600 | $199.99/mo | 600/min |
| Premium 1200 | $249.99/mo | 1200/min |

---

## Summary: Genuinely Free Sources Stack

| Layer | Source | Cost | Access Method | Rate Limit |
|---|---|---|---|---|
| **SEC Filings** | EDGAR API (data.sec.gov) | FREE | REST, no auth | 10 req/sec |
| **Full-Text Filing Search** | EDGAR EFTS | FREE | REST, no auth | 10 req/sec |
| **Macro Economic Data** | FRED API | FREE | REST, free API key | 120 req/min |
| **News RSS** | Yahoo Finance, MarketWatch, SEC | FREE | RSS polling | No formal limit |
| **Stock/ETF Data** | Alpha Vantage free tier | FREE | REST, free API key | 25 req/day |
| **ETF Prospectuses** | EDGAR (Form 485BPOS, N-1A) | FREE | REST, no auth | 10 req/sec |
| **Fund Factsheets** | Direct from fund websites | FREE | Manual PDF download | N/A |
| **Regulatory Docs** | SEC.gov, FINRA.org, eCFR, EUR-Lex | FREE | HTML/PDF/XML/API | No formal limit |
| **Education Content** | OpenStax, SEC Investor.gov, FRED Blog | FREE | HTML/PDF (CC BY or public domain) | N/A |
| **Fed Communications** | Federal Reserve RSS | FREE | RSS/Atom | No formal limit |

**Total cost: $0/month** for all of the above.
