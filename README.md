# PSA Plant Live Dashboard — Rajasthan

> Real-time monitoring of 440+ PSA oxygen plants across Rajasthan's public health facilities.

[![Live Dashboard](https://img.shields.io/badge/Live%20Dashboard-Open-blue?style=for-the-badge)](https://mchaurasiya.github.io/RJ-PSA-Dashboard/)

---

## What is this?

This is a **live operational dashboard** for tracking the health and reporting status of Pressure Swing Adsorption (PSA) oxygen plants installed across government hospitals in Rajasthan, India.

The dashboard consolidates data from four independent systems — ONA mock-drills, e-Upkaran equipment scans, the complaint management system, and the Stock on Hand asset registry — into a single, unified view that health administrators can use to:

- Know instantly which plants are functional and which are not
- Track complaint resolution timelines across districts
- Identify plants that have stopped submitting drill data
- Monitor oxygen purity trends over time
- Flag discrepancies between ONA and e-Upkaran reports

---

## Why does this exist?

PSA plant data is collected through multiple disconnected systems. Before this dashboard:

- ONA drill status lived in one system
- e-Upkaran equipment scans lived in another
- Complaints were tracked separately
- The asset registry (Stock on Hand) was a standalone Excel file
- No single view existed to cross-reference all four

District health officers had no easy way to answer questions like:
*"Which plants in Ajmer are non-functional AND have an open complaint?"*
or *"Which verified plants haven't submitted an e-Upkaran drill in 90 days?"*

This dashboard answers all of those questions in real time, with drill-down capability to the individual plant level.

---

## Dashboard Pages

### Page 1 — ONA × Complaints
Tracks ONA (Open Data Kit) mock-drill submissions and cross-references them with the complaint record.

**Key indicators:**
- Functional / Non-Functional status per plant (latest ONA drill)
- Oxygen purity trend over time (monthly average, drill-down to individual plant)
- Plants with active complaints broken down by district
- Average complaint resolution time (response → repair → MOIC verification)
- Discrepancy flags: plants self-reported as Functional but with an open complaint

**Filters:** District, Plant, Complaint date range

---

### Page 2 — e-Upkaran × Complaints
Tracks e-Upkaran equipment scan results and cross-references with complaints.

**Key indicators:**
- Equipment status breakdown (Functional / Functional Installed / In Complaint / NF Repairable)
- Equipment status trend over time (monthly bar chart, drill-down by month → by plant)
- EU purity trend (monthly average + per-plant drill history)
- ONA vs e-Upkaran discrepancy table (where the two systems disagree)

**Filters:** District, Plant, EU drill date range

---

### Page 3 — QR Code Coverage
Tracks how many plants are registered, QR-coded, verified, and actively reporting.

**Key indicators:**
- Coverage funnel: Total matched → Has QR → Verified inventory → Reporting (last 90 days)
- % of verified plants actively submitting drills
- Priority action list: verified plants that have stopped reporting
- Days since last drill per plant

**Filters:** District, Plant, Drill date range

---

### Page 4 — Methodology
Auto-updating reference guide explaining every KPI, formula, and data source.
All numbers (plant counts, reference dates, 90-day windows) update automatically when data refreshes.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              GOOGLE SHEETS (Source)              │
│                                                  │
│  PSA Registry      stockOnHandReport             │
│  PSA ONA Drills    ONA_MockDrill                 │
│  PSA EU Drills     e-upkaran_MockDrill           │
│  PSA Complaints    ComplaintsData (CMC + AMC)    │
│  PSA Mapping       ONA_Stock_in_Hand_Matching    │
└────────────────────┬────────────────────────────┘
                     │
                     │  Google Apps Script (Code.gs)
                     │  ┌─────────────────────────┐
                     │  │ 1. Normalise names       │
                     │  │ 2. Build registry index  │
                     │  │ 3. Join Code → Registry  │
                     │  │ 4. Join ONA → Code       │
                     │  │ 5. Join EU → Code        │
                     │  │ 6. Join Complaints → QR  │
                     │  │ 7. Compute reporting flags│
                     │  └────────────┬────────────┘
                     │               │ writes
                     ▼               ▼
┌─────────────────────────────────────────────────┐
│         PSA Dashboard Data (Google Sheet)        │
│                                                  │
│  plants          441 rows × 28 columns           │
│  ona_timeline    ~4,194 ONA drill records        │
│  eu_timeline     ~1,259 EU drill records         │
│  dist_p1         14 district aggregates          │
│  meta            build timestamp + coverage log  │
└────────────────────┬────────────────────────────┘
                     │
                     │  Google Sheets API v4
                     │  (read-only API key)
                     ▼
┌─────────────────────────────────────────────────┐
│            index.html (GitHub Pages)             │
│                                                  │
│  • Fetches all 5 tabs on load                    │
│  • Reassembles JS objects for render layer       │
│  • Renders charts, KPIs, tables                  │
│  • Refresh button → triggers re-derive + re-fetch│
└─────────────────────────────────────────────────┘
```

---

## Data Pipeline Detail

### Source Datasets

| Sheet | Rows | Role |
|---|---|---|
| PSA Registry | 515 assets | Master anchor — QR codes, inventory status, MOIC dates, equipment status |
| PSA ONA Drills | 5,287 drills | ONA functional status + purity history |
| PSA EU Drills | 950 drills | e-Upkaran equipment status + purity readings |
| PSA Complaints | 620 rows | Full complaint lifecycle with stage timestamps |
| PSA Mapping | 450 codes | ONA ↔ Registry plant identity matching |

### Join Pipeline (runs in Apps Script)

```
Step A  Build registry indexes: byDHC (district+hospital+capacity) and byQR (QR suffix)
Step B  Mapping Code → Registry asset  (manufacturer tiebreak for ambiguous hospitals)
Step C  ONA drills → Code              (facility name + LPM + manufacturer matching)
Step D  EU drills → Code               (district + hospital + capacity matching)
Step E  Complaints → Code              (by QR suffix → registry → code)
Step F  Compute reporting flags        (re/rr/ds — reporting ever/recent/days since drill)
```

### Join Coverage (validated against spec targets)

| Step | Coverage | Target |
|---|---|---|
| Code → Registry | 441 / 450 | ≥ 441 / 450 |
| EU drills → identities | 183 distinct | ~188–202 |
| Complaints → QR | 556 / 620 rows | 229 / 229 unique QRs |

The 9 unresolved codes in Step B are capacity-string mismatches in the source data.
The ~258 plants with no EU drill record are a genuine reporting gap surfaced on Page 3.

---

## AI Features

The dashboard has two AI-powered capabilities, both using **GPT-4o** via the OpenAI API. No data is stored — the API key is kept in the browser session only and requests go directly to `api.openai.com`.

To use either feature, click the **API Key** button in the top-right corner and enter your OpenAI API key.

---

### 1. Per-Chart AI Insights (Analyse button)

Every chart and table on all three pages has an **Analyse** button. Clicking it sends a structured data summary of exactly what is currently visible on screen — filtered by the active district, plant, and date selections — to GPT-4o and returns **4–6 sharp, specific, actionable insights**.

**What makes these insights useful:**

The system prompt instructs the model to act as a senior public health analyst and enforces three rules on every response:
- Always state the active filter context (date range, district) so the user knows the scope
- Every insight must cite specific numbers **and** specific facility or district names — no generic statements
- Clearly explain what each number means in plain language

**The 10 insight panels across the dashboard:**

| Panel | What it analyses |
|---|---|
| ONA functionality trend | Monthly functional/non-functional counts over time — spots declining trends by district |
| Functionality vs complaint status | Cross-tab of ONA status against complaint record — flags plants that are "functional" but have open complaints |
| ONA purity distribution | Monthly purity averages — identifies districts or months falling below the 93% WHO threshold |
| ONA vs complaint discrepancy | Plants where ONA status and complaint status contradict each other |
| e-Upkaran equipment trend | Monthly EU status over time — same as ONA trend but from the e-Upkaran scanning system |
| e-Upkaran vs complaint status | Cross-tab of EU equipment status against complaints |
| e-Upkaran purity trend | EU purity readings over time |
| ONA vs EU discrepancy | Plants where ONA and e-Upkaran report different functional states for the same plant |
| Coverage funnel | Why the reporting funnel narrows — which stage loses the most plants and where |
| Priority non-reporting plants | Which specific verified plants haven't reported in 90 days and what pattern emerges |

Each insight panel remembers its last result and shows a **Re-analyse** button so you can refresh after changing filters without re-opening the panel.

---

### 2. Conversational Analytics Chatbot

A floating **chat button** in the bottom-right corner opens a full conversational interface. The chatbot has complete context of the entire dataset including:

- Total plant counts and ONA/EU status breakdowns across all 33 districts
- Oxygen purity averages and below-threshold counts
- Complaint volumes, active complaint rates, and average resolution times by stage
- QR Code coverage: how many plants are barcoded, verified, and reporting
- Non-functional plant lists with and without active complaints
- Districts ranked by non-reporting plant count

**Example questions you can ask:**

```
Which districts have the highest proportion of non-functional plants?
How many plants in Jaipur have an open complaint right now?
What is the average complaint resolution time for AMC plants?
Which plants are verified but haven't submitted a drill in over 90 days?
Compare ONA and e-Upkaran purity trends — where do they diverge?
How many plants have no QR code and why does that matter?
```

The chatbot maintains conversation history within the session, so you can ask follow-up questions and it will remember earlier context. The conversation resets when the page is reloaded.

---

### Privacy & Security

- The OpenAI API key is stored **only in the browser session** — it is never sent to GitHub, Google Sheets, or any other server
- Data sent to OpenAI is a structured text summary of aggregated statistics — no patient data, no personally identifiable information
- The key is cleared automatically when the browser tab is closed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Dashboard UI | Vanilla HTML/CSS/JS — single file, no build step |
| Charts | [Chart.js 4.4](https://www.chartjs.org/) (CDN) |
| Data layer | Google Sheets API v4 (REST, read-only API key) |
| Derive pipeline | Google Apps Script |
| Hosting | GitHub Pages (static) |
| AI insights | OpenAI API (optional — requires user's own key) |

---

## Setup Guide

### Prerequisites
- A Google account with Google Sheets access
- A Google Cloud project with the Sheets API enabled
- A GitHub account

---

### Step 1 — Source Sheets

Upload each source Excel file as its own Google Sheet with these exact tab names:

| Google Sheet name | Tab name | Source file |
|---|---|---|
| PSA Registry | `sheet1` | stockOnHandReport.xlsx |
| PSA ONA Drills | `data` | ONA_MockDrill.xlsx |
| PSA EU Drills | `sheet1` | e-upkaran_MockDrill.xlsx |
| PSA Complaints | `Complaints` | ComplaintsData.xlsx (CMC + AMC merged into one tab) |
| PSA Mapping | `Final Matched` | ONA_Stock_in_Hand_Matching_vApr08.xlsx |

Create one more **blank** Google Sheet: **PSA Dashboard Data** (output sheet — Apps Script writes here).

Share all 6 sheets as **Anyone with the link → Viewer**.

---

### Step 2 — Apps Script

1. Go to [script.google.com](https://script.google.com) → **New project**
2. Paste the contents of `Code.gs` → replace `Code.gs` in the editor
3. Fill in the `CONFIG` block at the top with your spreadsheet IDs:

```javascript
const CONFIG = {
  registry:   'YOUR_REGISTRY_SHEET_ID',
  ona:        'YOUR_ONA_SHEET_ID',
  eupkaran:   'YOUR_EU_SHEET_ID',
  complaints: 'YOUR_COMPLAINTS_SHEET_ID',
  mapping:    'YOUR_MAPPING_SHEET_ID',
  dashboard:  'YOUR_DASHBOARD_DATA_SHEET_ID',
  webAppToken: 'choose-any-secret-string',
  ...
};
```

4. Select `runDerive` in the function dropdown → click **Run**
   - Authorise when prompted
   - Check the execution log — you should see coverage numbers appear
5. Select `installTriggers` → click **Run** (sets up 30-minute auto-rebuild)
6. **Deploy → New deployment → Web App**
   - Execute as: **Me**
   - Who can access: **Anyone**
   - Copy the Web App URL

---

### Step 3 — Google Sheets API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project → **APIs & Services → Library** → enable **Google Sheets API**
3. **APIs & Services → Credentials → Create Credentials → API Key**
4. Restrict the key to **Google Sheets API** only

---

### Step 4 — Dashboard Config

In `index.html`, find `DASH_CONFIG` near the top of the `<script>` block and fill in:

```javascript
const DASH_CONFIG = {
  spreadsheetId:   'YOUR_DASHBOARD_DATA_SHEET_ID',
  apiKey:          'YOUR_GOOGLE_SHEETS_API_KEY',
  deriveWebAppUrl: 'YOUR_APPS_SCRIPT_WEB_APP_URL',
  deriveToken:     'same-secret-string-as-webAppToken',
};
```

---

### Step 5 — GitHub Pages

```bash
git init
git add index.html Code.gs README.md .gitignore
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from branch → main → / (root) → Save**

Your dashboard is live at: `https://<your-username>.github.io/<repo-name>/`

---

## Refreshing Data

Clicking **Refresh Data** on the dashboard:

1. Calls the Apps Script Web App → runs the full derive pipeline (~15 seconds)
2. Re-reads all source sheets, re-runs all joins and aggregations
3. Rewrites `PSA Dashboard Data` with fresh results
4. Re-fetches all tabs and re-renders all charts and KPIs

Data also rebuilds automatically every 30 minutes via the Apps Script time trigger.

---

## Repository Structure

```
/
├── index.html       PSA Plant Dashboard (single-file app)
├── Code.gs          Google Apps Script derive pipeline
├── README.md        This file
└── .gitignore
```

---

## Contact

Developed for the Rajasthan health department PSA plant monitoring programme.
For issues or data queries, contact the dashboard administrator.
