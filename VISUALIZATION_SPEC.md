# PSA Dashboard — Visualization & Data Spec

**Purpose.** A single reference for *what each visualization shows, where its data comes
from (down to the source-sheet columns), how it is calculated, which filters apply, and
what else is affected if you change it.* Use this before editing any calculation so you
know the full blast radius.

> Maintenance rule: when you change a calculation, identity rule, or data column, update
> the matching row(s) here in the same commit. This file is only useful if it stays true.

---

## 1. Architecture & data flow

```
Raw Google Sheets            Apps Script (Code.gs)              Output sheet
(one per source)             deriveDashboard()                 gs_dashboard_data (tabs)        Frontend (index.html)
─────────────────            ────────────────────              ────────────────────────       ─────────────────────
gs_registry      ┐                                         ┌─ plants            ──────────►  RAW.slim_plants
gs_ona           │  read → normalize → match → aggregate   ├─ ona_all_plants    ──────────►  ONA_ALL_PLANTS
gs_eupkaran      ├──────────────────────────────────────►  ├─ ona_monthly_all   ──────────►  ONA_MONTHLY_ALL
gs_complaints    │                                         ├─ ona_timeline      ──────────►  TL.history
gs_mapping       ┘                                         ├─ eu_all_plants     ──────────►  EU_ALL_PLANTS
                                                           ├─ eu_monthly_all    ──────────►  EU_MONTHLY_ALL
                                                           ├─ eu_timeline       ──────────►  TL2.history
                                                           ├─ eu_direct_cross   ──────────►  EU_CROSS
                                                           ├─ registry_plants   ──────────►  REGISTRY_ALL
                                                           ├─ dist_p1           ──────────►  (district NF stats)
                                                           ├─ mapping_report    ──────────►  MAPPING_REPORT
                                                           └─ meta              ──────────►  window._lastBuiltAt, COMPLAINTS_TOTAL
```

**Three things to internalize:**

1. **The frontend never touches raw sheets.** It only fetches the `gs_dashboard_data`
   tabs. So a "wrong number" is either (a) a derive/aggregation issue in `Code.gs`, or
   (b) a frontend calc/filter issue — never a raw-sheet read.
2. **Each source is exposed in *several different shapes*** (e.g. EU appears as
   `EU_ALL_PLANTS`, `EU_MONTHLY_ALL`, `TL2`, `EU_CROSS`). These are keyed differently and
   are **not** auto-consistent — see §6. This is the main source of "I changed it in one
   place and another broke."
3. **The page is rebuilt by per-page render functions** (`rp1` ONA, `rp2` EU, `rpC`
   Complaints, `rp3` QR, `rp4` Data Report). Filters call these; `switchTab` calls them.

---

## 2. Source sheets → key columns

| Sheet (`CONFIG`) | Banner rows | Columns the derive actually reads |
|---|---|---|
| `gs_registry` (Stock-in-Hand) | 3 | `District Name`(c1), `Hospital Name`(c2), `QR Code`(c9), `MOIC Verified Date`(c14), `Inventory Status`(c17), `Equipment Status`(c18), `Supplier`(c19), `Capacity of PSA Plant (in LPM)`(c22) |
| `gs_ona` (ONA mock-drill) | 0 | `Gen_Information/Facility`, `Gen_Information/District`, `_submission_time` / `date_of_assessment`, `PSA_plant/Oxygen_Purity_displayed_1/_12/_123`, `Gen_Information/Wheather_fn` (status), `Wheather_fn_1` (NF reason), `vendorManufacturingHF_1` (mfr) |
| `gs_eupkaran` (EU mock-drill) | 3 | `District Name`(c1), `Hospital Name`(c2), `Equipment Status`(c4), `QR Code`(c5 — *mangled to sci-notation, unusable*), `Manufacturer`(c6), `Date of Mockdrill`(c8), `Capacity…(LPM)`(c10), `Total running hours`(c11), `Purity(in percent)`(c12), `Fire Safety…`(c17), `Any leakage observed`(c19) |
| `gs_complaints` | 0 | `District Name`(c0), `Hospital Name`(c2), `Service Provider QR Code`(c4), `Complaint Raise Date`(c6), `Complaint Attend date`(c9), `Complaint Close date`(c10), `Complaint Close by MOIC`(c11), `Total Downtime`(c12), `Supplier Name`(c14), `Service Provider Name`(c16) |
| `gs_mapping` (Final Matched) | 0 | `Code`, `ONA District/Health Facility/Capacity/Manufacturer`, `SIH District/Health Facility/Capacity/Manufacturer`, `SIH QR Code` |

**Normalization helpers (Code.gs):** `normName` (lowercase+collapse spaces), `normDist`
(district display-normalized), `parseCap` (first integer; `--`/blank → null), `normMfr`
(lowercase, strip pvt/ltd/india/etc.), `qrSuffix` (last 6–9 digits; returns `''` for the
mangled EU QR).

---

## 3. `gs_dashboard_data` tabs → columns → frontend global

| Tab | Columns | Frontend global | Key it's grouped by |
|---|---|---|---|
| `plants` | code, district, department, ona_facility, sih_facility, ona_capacity, sih_capacity, ona_status, ona_scheme, ona_purity, ona_drill_date, ona_nf_reason, ona_functional_reason, eu_status, eu_purity, eu_running_hours, eu_drill_date, eu_leakage, eu_fire_safety, qr_suffix, equipment_status, inventory_status, moic_verified_date, has_qr, is_verified, reporting_ever, reporting_recent, days_since_drill, complaint_clean, **complaints** (JSON) | `RAW.slim_plants` | **mapping `code`** (the ~448 matched plants) |
| `ona_all_plants` | district, facility, scheme, capacity, latest_status, latest_purity, latest_date, nf_reason, drill_count | `ONA_ALL_PLANTS` | `district\|facNorm\|lpm` (no code; `c:null`) |
| `ona_monthly_all` | month, district, **facility**, total, functional, not_functional, avg_purity | `ONA_MONTHLY_ALL` | `month\|district\|facNorm` |
| `ona_timeline` | code, district, facility, capacity, date, purity, status | `TL.history` | `code` (matched) or `U#` (unmatched) |
| `eu_all_plants` | district, hospital, capacity, latest_status, latest_purity, latest_hours, latest_date, eu_leakage, eu_fire_safety, drill_count, **latest_not_running** | `EU_ALL_PLANTS` | **combined: QR\|district\|hospital\|capacity\|manufacturer** (no code; `c:null`) |
| `eu_monthly_all` | month, district, **facility**, total, functional, not_functional, avg_purity | `EU_MONTHLY_ALL` | `month\|district\|hospNorm` |
| `eu_timeline` | code, district, facility, capacity, date, purity, status, **eq_status** | `TL2.history` | `code` (matched) or `V#` (unmatched, by `district\|hosp\|cap`) |
| `eu_direct_cross` | district, hospital, capacity, qr_suffix, has_qr, equipment_status, inventory_status, moic_verified_date, is_verified, eu_status, eu_purity, eu_hours, eu_date, eu_leakage, eu_fire_safety, eu_drill_count, complaint_count, has_active_complaint, **complaints** (JSON) | `EU_CROSS` | **one row per registry asset** |
| `registry_plants` | district, hospital, capacity, qr_suffix, has_qr, equipment_status, inventory_status, moic_verified_date, is_verified | `REGISTRY_ALL` | one row per registry asset (511) |
| `dist_p1` | district, nf_with_complaint, nf_without_complaint, total_non_functional | — | district |
| `mapping_report` | code, ona_*, sih_*, match_method, matched_*, complaint_clean, ambiguity_reason | `MAPPING_REPORT` | mapping `code` (all 450) |
| `meta` | key/value (built_at, coverage_*, counts) | `window._lastBuiltAt`, `COMPLAINTS_TOTAL` | — |

> ⚠️ **The identity mismatch.** `EU_ALL_PLANTS` (KPI count, combined key, no code),
> `EU_MONTHLY_ALL` (trend bars, by `district\|hosp`), and `TL2` (drill-downs, by code/`V#`,
> grouped `district\|hosp\|cap`) are **three different groupings of the same EU drills.**
> They are reconciled today by *facility-name matching*, not a shared id. This is the #1
> structural fragility (see §6, and the `plant_uid` proposal in the reorg plan).

---

## 4. Frontend data globals (quick glossary)

| Global | What it is | Per-plant fields you'll use |
|---|---|---|
| `RAW.slim_plants` | matched plants (~448), the join of ONA↔registry↔EU↔complaints | `c`(code) `dd` `of`(ONA fac) `sf`(SIH fac) `co`/`cs`(cap) `os`(ONA status) `op`(ONA purity) `od` `es`(EU status) `ep`(EU purity) `epr`(hours) `ed` `eq`(QR) `sei`/`sii` `hq` `iv` `re`/`rr`/`ds`(reporting) `cln`(complaint_clean) `cl`(complaints[]) |
| `ONA_ALL_PLANTS` | every ONA-drilled identity (~482), **not** code-keyed | `dd` `sf`(facNorm) `osc` `co` `os` `op` `od` `or_` `cnt`; `c:null` |
| `EU_ALL_PLANTS` | every unique EU plant (combined key) | `dd` `sf`(hospNorm) `co` `es` `ep` `epr` `ed` `el` `ef` `cnt` `nr`(not_running); `c:null` |
| `ONA_MONTHLY_ALL` / `EU_MONTHLY_ALL` | month×district×facility aggregates | `m` `dist` `fac` `tot` `f` `n` `avgP` |
| `TL.history` / `TL2.history` | per-plant drill history (ONA / EU) keyed by code/synthetic | `{di,fa,ca,h:[{d,p,s,es}]}` |
| `EU_CROSS` | registry assets joined to EU drills + complaints | `dd` `sf` `cs` `eq` `hq` `sei`/`sii` `es` `ep` `epr` `ed` `eu_drill_count` `ct`(complaint_count) `ha`(active) `cl`(complaints[]) |
| `REGISTRY_ALL` | all 511 registry assets | `dd` `sf` `cs` `eq` `hq` `sei` `sii` `smd` `iv` |
| `MAPPING_REPORT` | mapping audit rows | `code` `ona_*` `sih_*` `match_method` `matched_*` `complaint_clean` `ambiguity_reason` |
| `FC` | precomputed ONA×complaint cross structure (built by `buildFC_`) | `.thresholds{low,high}`, `.plants[]{code,district,ona_status,active_count,comp_count,latest_status,latest_bucket,all_comps[]}` |

---

## 5. Per-page visualization spec

Tab order (see `TAB_PAGES` in `switchTab`): **0** User Guide · **1** ONA Mockdrill (`pg0`,
`rp1`) · **2** EU Mockdrill (`pg1`, `rp2`) · **3** Complaints Status (`pgComp`, `rpC`) ·
**4** QR Code Coverage (`pg2`, `rp3`) · **5** Data Report (`pg4`, `rp4`) · **6** Methodology (`pg3`).

### Page 1 — ONA Mockdrill (`rp1`)  *pure ONA, never match-filtered*

| Viz (container) | Source | Calculation | Identity | Filters |
|---|---|---|---|---|
| **KPIs** (`k1`) | `ONA_ALL_PLANTS` | Card1 **Total ONA plants = 541 (hardcoded)**; Card2 reporting = `onaAll.length`; Functional/Non-functional = count by `os`; Avg purity = mean `op` of functional with `op>0` | `dd\|sf` | district, **plant (ms1p)**, dept, **date (od)** |
| **Functionality over time** (`tl-container`) | overview: `ONA_MONTHLY_ALL`; drill-down: `TL.history` | monthly stacked f vs n drill counts; dots = avg purity | monthly agg; `applyFacFilter_` for plant | district, plant, date |
| **Purity distribution** (`pur-container`) | `ONA_MONTHLY_ALL` | monthly weighted avg purity vs 90/93 thresholds | monthly agg | district, plant, date |
| **ONA Plant Intelligence** (`ona-intel-content`) | `ONA_ALL_PLANTS` (`onaIntelDraw(onaAll)`) | scheme breakdown, NF-reason categories (regex on `or_`), drill recency buckets (`od` vs ref) | `dd\|sf` | district, plant, dept, date |

**Source columns:** `ona_all_plants` (latest_status/purity/date/scheme/capacity/nf_reason) ←
`gs_ona` (Facility, District, Wheather_fn, purity readings, vendorManufacturingHF_1).
`ona_monthly_all` ← all ONA drills grouped by month+district+facility.

### Page 2 — EU Mockdrill (`rp2`)  *pure EU*

| Viz (container) | Source | Calculation | Identity | Filters |
|---|---|---|---|---|
| **KPIs** (`k2`) | `EU_ALL_PLANTS` | Total = `euAll.length`; Functional / Functional Installed / In-Complaint+NF Repairable = count by `es`; Purity ≥93% = `ep>=93`; **Purity=0 (not running) = `nr`** | combined key | district, **plant (ms2p)**, **date (ed)** |
| **Equipment status over time** (`eutl-container`) | overview `EU_MONTHLY_ALL`; **drill-down `TL2.history`** | monthly f/n drill counts; month drill-down lists every plant (matched+unmatched) by that-month status | monthly agg; drill-down by `TL2` + `applyFacFilter_` | district, plant, date |
| **Purity trend** (`pur2-container`) | overview `EU_MONTHLY_ALL`; **month drill-down `TL2.history`**; per-plant trend `TL2.history` | monthly weighted avg purity; per-plant = full purity time-series | `TL2` | district, plant, date |
| **EU Mock-Drill Intelligence** (`eu-intel-content`) | `EU_ALL_PLANTS` (`euIntelDraw(euAll)`) | safety flags (`el`, `ef='2'`, not-running), running-hours buckets (`epr`), recency (`ed`); rows open per-plant purity trend via `euTL2CodeFor_` | combined key | district, plant, date |

**Source columns:** `eu_all_plants` (latest_status/purity/hours/date/leakage/fire/not_running)
and `eu_monthly_all`/`eu_timeline` all ← `gs_eupkaran` (Equipment Status, Purity, Total
running hours, Date of Mockdrill, leakage, fire safety).

> Note: the EU per-plant time-series helper `euPlantByCode_(code)` resolves matched plants
> from `RAW.slim_plants` and unmatched (`V#`) from `TL2`. `euTL2CodeFor_(dd,fac,cap)` maps an
> `EU_ALL_PLANTS` identity (no code) to a `TL2` code so Intelligence rows can open the trend.

### Page 3 — Complaints Status (`rpC`)  *the only cross-source page; inner sub-tabs*

| Sub-tab / Viz | Source | Calculation | Identity | Filters |
|---|---|---|---|---|
| **ONA × Complaints — KPIs** (`kC1`) | `RAW.slim_plants` (filtered `os && cln`) + `withMetrics` | Plants ≥1 complaint; Functional+open (`os='Functional' && ha`); Non-functional, no complaint; Avg resolution (`ar`) | code | district (`msC1d`), complaint date (`fc1`) |
| **Functionality vs complaint** (`fc-container`) | `FC.plants` (built from `plants` tab complaints JSON) | ONA latest status × complaint pipeline stage / resolution-time bucket | code | district, complaint date |
| **EU × Complaints — KPIs** (`kC2`) | `EU_CROSS` (`eu_drill_count>0`) | Plants ≥1 complaint; Functional+open; Non-functional no complaint; Avg resolution — all over EU-drilled registry assets | registry asset | district (`msC2d`), EU date (`fc2`) |
| **EU status vs complaint** (`eufc-container`) | `EU_CROSS` (`eufcDrawCross`) | EU equipment status × complaint pipeline | registry asset | district, EU date |

**Source columns:** complaint timing/status from `gs_complaints` (Raise/Attend/Close/MOIC
dates, Total Downtime) embedded as JSON in `plants.complaints` and `eu_direct_cross.complaints`.

### Page 4 — QR Code Coverage (`rp3`)  *registry / reporting; no complaints*

| Viz (container) | Source | Calculation | Identity | Filters |
|---|---|---|---|---|
| **KPIs** (`k3`) | `REGISTRY_ALL` + `RAW.slim_plants` | total registry; has QR (`hq`); verified (`iv&&hq`); verified+reporting (`rr`); % reporting | registry asset; reporting via slim by `dd\|sf` | district (`ms3d`), plant (`ms3p`), drill date (`f3`) |
| **Coverage funnel** (`funnel`) | `REGISTRY_ALL` (stages) + `RAW.slim_plants` (reporting) | registry → has QR → verified → ever reported (`re`) → reporting recent (`rr`); Trend view = monthly reporters | registry + `dd\|sf` | district, plant, date |
| **Priority action list** (`t3`) | `RAW.slim_plants` (`iv&&hq&&!rr`) | verified plants not reporting, sorted by `ds` (days since) | `dd\|sf` | district, plant, date |

### Page 5 — Data Report (`rp4`)  *transparency / matching audit*

| Section | Source | Calculation |
|---|---|---|
| Summary grid | `MAPPING_REPORT`, `REGISTRY_ALL`, `EU_CROSS`, `ONA_ALL_PLANTS`, `EU_ALL_PLANTS`, `COMPLAINTS_TOTAL` | counts/coverage |
| Section 1 ONA↔Registry | `MAPPING_REPORT` | matched / unmatched / ambiguous by `match_method`, `ambiguity_reason` |
| Sections 2–3 | `MAPPING_REPORT`, `RAW.slim_plants`, `EU_CROSS` | complaint-clean chain, EU×registry×complaints |
| Excel export | same as above | sheets per section |
| Subtitle | `window._lastBuiltAt` | "Last derive: …" |

### Page 6 — Methodology (`pg3`)  *static*

Static HTML; `updateMethodology()` fills `.meth-ref-date` / `.meth-plant-count` /
`.meth-window-start` from live `RAW.slim_plants` (max drill date, count, −90 days).

---

## 6. Shared definitions that are currently **duplicated** (the change-pain map)

These concepts are re-implemented in multiple spots. Changing one means hunting the rest —
this is the friction you described. (Reorg plan: collapse each into one helper / one `uid`.)

| Concept | Defined/used in… | Risk |
|---|---|---|
| **"Functional"** (`es ∈ {Functional, Functional Installed}`) | `rp2` KPIs, `eutlDrawAllEU`, `eutlDrawMonth`, `eu_monthly_all` (Code.gs), `eu_timeline` status, `EU_CROSS` | change the set → must edit ~6 places |
| **EU unique-plant identity** | `euAllByIdent` (Code.gs) + facility-name matching in `EU_MONTHLY_ALL`, `TL2`, dropdown dedup, drill-down `fnorm` | the 120↔140 / matched-only-drilldown class of bug |
| **"Not running"** | `nr` (Code.gs `epZero`), KPI `euNR`, EU-intel safety (`epr===0`) — *two different definitions!* | inconsistent counts |
| **Status → color** | repeated ternary in `eutlDrawMonth`, `eutlDrawPlant`, `pur2*`, EU-intel | cosmetic drift |
| **Date range / period label** | `window.ONA_RANGE` / `EU_RANGE` / `COMP_RANGE` (centralized ✓) + date-input min/max | mostly fixed already |
| **Filter application** | `fp()` (matched), inline filters in `rp1`/`rp2`/`rpC`/`rp3`, `applyFacFilter_` | uneven filter behavior across viz |

---

## 7. Change-impact matrix — "if you touch X, also check Y"

| If you change… | Re-verify… | Needs re-derive? |
|---|---|---|
| EU unique-plant identity (`euAllByIdent`) | EU KPIs count, dropdown options, `applyFacFilter_` matches, drill-down lists | **Yes** |
| `eu_monthly_all` / `ona_monthly_all` grouping | timeline + purity overviews, per-plant trend filtering | **Yes** |
| `eu_timeline` columns (e.g. `eq_status`) | `TL2` loader, `eutlDrawMonth`, `eutlDrawPlant`, `pur2DrawMonth/Plant` | **Yes** |
| "Functional" definition | every EU KPI + timeline + monthly aggregate | Yes (aggregates) |
| Nulling 0-purity (averages) | "Purity = 0" KPI (`nr`), purity-≥93 count | Yes |
| Complaint matching (Step E / DHC) | Complaints page KPIs + `fc`/`eufc` widgets, Data Report | **Yes** |
| Add a plant filter to a page | that page's KPIs, intel, **and** trend charts (`applyFacFilter_`) | No |
| Period label / date range | all period labels + date-input min/max | No |

---

## 8. Known fragilities (debug here first)

1. **Identity mismatch across EU shapes** (§3 warning) — facility-name matching between
   `EU_ALL_PLANTS` (combined key), `TL2` (dist\|hosp\|cap), and `EU_MONTHLY_ALL` is imperfect
   for matched plants whose registry name ≠ EU drill name. *Fix:* one `plant_uid` on every tab.
2. **`c:null` on `ONA_ALL_PLANTS` / `EU_ALL_PLANTS`** — these can't be looked up by code;
   per-plant trends need `euPlantByCode_` / `euTL2CodeFor_` bridges. *Fix:* `plant_uid`.
3. **Silent derive transforms** — e.g. 0-purity → null broke "Purity = 0" until `nr` was added.
   *Fix:* invariant checks (`runChecks()` in Code.gs + a `?debug=1` overlay).
4. **Two "not running" definitions** (purity-0 vs hours-0) — reconcile to one.
5. **Pre-re-derive fallbacks** — several frontend reads degrade gracefully when a new column
   (`eq_status`, `latest_not_running`, monthly `facility`) is missing; full accuracy needs a
   `runDerive()`.

---

## 9. How to debug a "wrong number"

1. **Locate the viz here** → note its source tab + render function.
2. **Open the tab in `gs_dashboard_data`** → is the raw aggregate right? If not → it's a
   `Code.gs` derive issue (check the matching builder + the source-sheet columns in §2).
3. **If the tab is right but the chart is wrong** → it's a frontend calc/filter issue in the
   render function (check §6 for a duplicated definition you may have changed in only one place).
4. **Check the change-impact matrix (§7)** for siblings that share the definition.
5. **Reconcile counts:** a KPI count should equal the distinct identities in its source tab.
   Divergence = the identity-mismatch fragility (§8.1).
