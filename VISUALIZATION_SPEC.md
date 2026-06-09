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
   `EU_ALL_PLANTS`, `EU_MONTHLY_ALL`, `TL2`, `EU_CROSS`). They are now joined by a shared
   **`plant_uid`** (see §3 note, §10) instead of facility-name matching — so a plant is the
   same plant across KPI / trend / drill-down. Status semantics live once in **`DEFS`** (§10).
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
| `ona_all_plants` | **plant_uid**, district, facility, scheme, capacity, latest_status, latest_purity, latest_date, nf_reason, drill_count | `ONA_ALL_PLANTS` | **`plant_uid`** = `district\|facNorm\|lpm` (`onaUID`; `c:null`) |
| `ona_monthly_all` | month, **plant_uid**, district, **facility**, total, functional, not_functional, avg_purity | `ONA_MONTHLY_ALL` | `month\|plant_uid` |
| `ona_timeline` | code, **plant_uid**, district, facility, capacity, date, purity, status | `TL.history` | **keyed by `plant_uid`** (entry keeps `code`) |
| `eu_all_plants` | **plant_uid**, district, hospital, capacity, latest_status, latest_purity, latest_hours, latest_date, eu_leakage, eu_fire_safety, drill_count, **latest_not_running** | `EU_ALL_PLANTS` | **`plant_uid`** = `QR\|district\|hospital\|capacity\|manufacturer` (`euUID`; `c:null`) |
| `eu_monthly_all` | month, **plant_uid**, district, **facility**, total, functional, not_functional, avg_purity | `EU_MONTHLY_ALL` | `month\|plant_uid` |
| `eu_timeline` | code, **plant_uid**, district, facility, capacity, date, purity, status, **eq_status** | `TL2.history` | **keyed by `plant_uid`** (entry keeps `code`) |
| `eu_direct_cross` | district, hospital, capacity, qr_suffix, has_qr, equipment_status, inventory_status, moic_verified_date, is_verified, eu_status, eu_purity, eu_hours, eu_date, eu_leakage, eu_fire_safety, eu_drill_count, complaint_count, has_active_complaint, **complaints** (JSON) | `EU_CROSS` | **one row per registry asset** |
| `registry_plants` | district, hospital, capacity, qr_suffix, has_qr, equipment_status, inventory_status, moic_verified_date, is_verified | `REGISTRY_ALL` | one row per registry asset (511) |
| `dist_p1` | district, nf_with_complaint, nf_without_complaint, total_non_functional | — | district |
| `mapping_report` | code, ona_*, sih_*, match_method, matched_*, complaint_clean, ambiguity_reason | `MAPPING_REPORT` | mapping `code` (all 450) |
| `meta` | key/value (built_at, coverage_*, counts) | `window._lastBuiltAt`, `COMPLAINTS_TOTAL` | — |

> ✅ **The identity mismatch is now fixed by `plant_uid`.** Every ONA tab carries the same
> `onaUID` (`district\|facNorm\|lpm`) and every EU tab the same `euUID`
> (`QR\|district\|hospital\|capacity\|manufacturer`), stamped in `Code.gs`. So `*_ALL_PLANTS`
> (KPIs + dropdown), `*_MONTHLY_ALL` (trends), and `TL`/`TL2` (drill-downs) are now the **same
> grouping** of each source's drills — joined by id, not by facility-name matching. The plant
> dropdown emits `plant_uid` values; `applyFacFilter_` matches `r.uid`; per-plant drill-downs
> resolve by uid (`onaPlantByUID_` / `euPlantByUID_`). This retired the 120↔140 and
> matched-only-drilldown bugs.

---

## 4. Frontend data globals (quick glossary)

| Global | What it is | Per-plant fields you'll use |
|---|---|---|
| `RAW.slim_plants` | matched plants (~448), the join of ONA↔registry↔EU↔complaints | `c`(code) `dd` `of`(ONA fac) `sf`(SIH fac) `co`/`cs`(cap) `os`(ONA status) `op`(ONA purity) `od` `es`(EU status) `ep`(EU purity) `epr`(hours) `ed` `eq`(QR) `sei`/`sii` `hq` `iv` `re`/`rr`/`ds`(reporting) `cln`(complaint_clean) `cl`(complaints[]) |
| `ONA_ALL_PLANTS` | every ONA-drilled identity (~482) | **`uid`**(plant_uid) `dd` `sf`(facNorm) `osc` `co` `os` `op` `od` `or_` `cnt`; `c:null` |
| `EU_ALL_PLANTS` | every unique EU plant | **`uid`**(plant_uid) `dd` `sf`(hospNorm) `co` `es` `ep` `epr` `ed` `el` `ef` `cnt` `nr`(not_running); `c:null` |
| `ONA_MONTHLY_ALL` / `EU_MONTHLY_ALL` | month×plant aggregates | **`uid`** `m` `dist` `fac` `tot` `f` `n` `avgP` |
| `TL.history` / `TL2.history` | per-plant drill history (ONA / EU), **keyed by `plant_uid`** | `{uid,code,di,fa,ca,h:[{d,p,s,es}]}` |
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
| **KPIs** (`k1`) | `ONA_ALL_PLANTS` | Card1 **Total ONA plants = 541 (hardcoded)**; Card2 reporting = `onaAll.length`; Functional/Non-functional = count by `os`; Avg purity = mean `op` of functional with `op>0` | `plant_uid` | district, **plant (ms1p)**, dept, **date (od)** |
| **Functionality over time** (`tl-container`) | overview: `ONA_MONTHLY_ALL`; drill-down: `TL.history` | monthly stacked f vs n drill counts; dots = avg purity; month/plant drill-downs resolve by `plant_uid` (`TL.history[uid]`) | `plant_uid`; `applyFacFilter_` matches `r.uid` | district, plant, date |
| **Purity distribution** (`pur-container`) | `ONA_MONTHLY_ALL` + `TL.history` drill-downs | monthly weighted avg purity vs 90/93 thresholds | `plant_uid` | district, plant, date |
| **ONA Plant Intelligence** (`ona-intel-content`) | `ONA_ALL_PLANTS` (`onaIntelDraw(onaAll)`) | scheme breakdown, NF-reason categories (regex on `or_`), drill recency buckets (`od` vs ref); rows open per-plant purity trend via `p.uid` | `plant_uid` | district, plant, dept, date |

**Source columns:** `ona_all_plants` (latest_status/purity/date/scheme/capacity/nf_reason) ←
`gs_ona` (Facility, District, Wheather_fn, purity readings, vendorManufacturingHF_1).
`ona_monthly_all` ← all ONA drills grouped by month+district+facility.

### Page 2 — EU Mockdrill (`rp2`)  *pure EU*

| Viz (container) | Source | Calculation | Identity | Filters |
|---|---|---|---|---|
| **KPIs** (`k2`) | `EU_ALL_PLANTS` | Total = `euAll.length`; Functional / Functional Installed (`DEFS.euFunctional`) / In-Complaint+NF Repairable (`DEFS.euNonFunctional`) = count by `es`; Purity ≥93% = `ep>=93`; **Purity=0 (not running) = `DEFS.notRunningByPurity`** | `plant_uid` | district, **plant (ms2p)**, **date (ed)** |
| **Equipment status over time** (`eutl-container`) | overview `EU_MONTHLY_ALL`; **drill-down `TL2.history`** | monthly f/n drill counts; month drill-down lists every plant (matched+unmatched) by that-month status | `plant_uid`; `applyFacFilter_` matches `r.uid` | district, plant, date |
| **Purity trend** (`pur2-container`) | overview `EU_MONTHLY_ALL`; **month drill-down `TL2.history`**; per-plant trend `TL2.history` | monthly weighted avg purity; per-plant = full purity time-series | `plant_uid` | district, plant, date |
| **EU Mock-Drill Intelligence** (`eu-intel-content`) | `EU_ALL_PLANTS` (`euIntelDraw(euAll)`) | safety flags (`el`, `ef='2'`, not-running `DEFS.notRunningByHours`), running-hours buckets (`epr`), recency (`ed`); rows open per-plant purity trend via `p.uid` | `plant_uid` | district, plant, date |

**Source columns:** `eu_all_plants` (latest_status/purity/hours/date/leakage/fire/not_running)
and `eu_monthly_all`/`eu_timeline` all ← `gs_eupkaran` (Equipment Status, Purity, Total
running hours, Date of Mockdrill, leakage, fire safety).

> Note: per-plant trends resolve purely by `plant_uid`. `euPlantByUID_(uid)` reads `TL2.history[uid]`
> (falling back to the `EU_ALL_PLANTS` row); ONA's `purClickPlant`/`tlClickPlant` read `TL.history[uid]`.
> The old code-bridge helpers (`euPlantByCode_`, `euTL2CodeFor_`) are gone — there is no code↔facility
> matching left on these paths.

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

**Single basis = `EU_CROSS`** (registry-direct, one row per registry asset, carrying the
EU-drill linkage). Reporting flags `re`/`rr`/`ds` are computed in the `EU_CROSS` loader
(`re` = has ≥1 EU drill; `rr` = drilled in last 90 days; `ds` = days since last drill).
Reporting is computed over the **verified** subset so `reporting + not-reporting`
reconcile exactly to the verified pool. (Previously the funnel mixed `REGISTRY_ALL` for
stages with `slim_plants` for reporting, which made "Verified, not reporting" count the
entire verified pool — fixed.)

| Viz (container) | Source | Calculation | Identity | Filters |
|---|---|---|---|---|
| **KPIs** (`k3`) | `EU_CROSS` | total registry; has QR (`hq`); verified (`iv&&hq`); verified+reporting (`rr`); not-reporting = verified−reporting; % reporting | registry asset (`dd\|sf`) | district (`ms3d`), plant (`ms3p`), drill date (`f3`) |
| **Coverage funnel** (`funnel`) | `EU_CROSS` | registry → has QR → verified → ever reported (`re`) → reporting recent (`rr`); Trend view = monthly reporters by `ed` | registry asset | district, plant, date |
| **Priority action list** (`t3`) | `EU_CROSS` (`iv&&hq&&!rr`) | verified plants not reporting, sorted by `ds` (days since) | registry asset | district, plant, date |

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

## 6. Shared definitions — now collapsed into `DEFS` / `plant_uid`

Concepts that used to be re-implemented in many spots (the friction you described) are now
single-sourced. **Change the meaning once, in `DEFS` (frontend) or the identity helpers
(Code.gs), and every consumer updates together.**

| Concept | Single source now | Was |
|---|---|---|
| **"Functional"** (`es ∈ {Functional, Functional Installed}`) | **`DEFS.euFunctional(es)`** (~15 call sites) | duplicated ternary/`||` in ~6 places |
| **"Non-functional"** (`es ∈ {In Complaint, NF Repairable}`) | **`DEFS.euNonFunctional(es)`** | duplicated `.includes()` in ~6 places |
| **EU / ONA unique-plant identity** | **`plant_uid`** (`euUID` / `onaUID` in Code.gs), stamped on every tab | `euAllByIdent` + facility-name matching across shapes → the 120↔140 / matched-only-drilldown bugs |
| **"Not running"** | **`DEFS.notRunningByPurity`** (purity 0 → KPI) vs **`DEFS.notRunningByHours`** (run-hrs 0 → Intelligence) — *two deliberately-distinct, now named* defs | two *unnamed* defs that diverged silently |
| **Status → color / badge class** | **`DEFS.euStatusColor(es)` / `DEFS.euStatusClass(es)`** (~10 call sites) | repeated ternary in `eutl*`, `pur2*`, EU-intel (incl. one 3-way variant) |
| **Date range / period label** | `window.ONA_RANGE` / `EU_RANGE` / `COMP_RANGE` (centralized) + date-input min/max | — |
| **Filter application** | `fp()` (matched), inline filters in `rp1`/`rp2`/`rpC`/`rp3`, `applyFacFilter_` (matches `r.uid`) | *still per-page* — the one remaining duplication; lower risk now that all rows share `plant_uid` |

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

1. ✅ **Identity mismatch across EU/ONA shapes** — *resolved* by `plant_uid` stamped on every
   tab (§3 note). All shapes of a source now share one id; no facility-name matching on these paths.
2. ✅ **`c:null` lookups** — *resolved*; per-plant trends resolve by `plant_uid`
   (`euPlantByUID_` / `TL.history[uid]`). The `euPlantByCode_` / `euTL2CodeFor_` bridges are gone.
3. ✅ **Silent derive transforms** — now guarded by **`runChecks()`** (frontend) surfaced via the
   **`?debug=1`** overlay; e.g. the 0-purity→null trap is covered by the func+nonfunc≤total assertion.
4. ✅ **Two "not running" definitions** — *named & documented*, not merged: `DEFS.notRunningByPurity`
   (purity 0, the KPI) vs `DEFS.notRunningByHours` (run-hrs 0, Intelligence). They measure different
   things by design; callers now pick explicitly. *(If the product wants a single number, that's a
   deliberate decision to make — flagged, not silently chosen.)*
5. **Pre-re-derive fallbacks** — several frontend reads degrade gracefully when a new column
   (`plant_uid`, `eq_status`, `latest_not_running`, monthly `facility`) is missing; full accuracy
   needs a `runDerive()`. The `?debug=1` panel will flag missing `plant_uid` immediately.

---

## 9. How to debug a "wrong number"

1. **Locate the viz here** → note its source tab + render function.
2. **Open the tab in `gs_dashboard_data`** → is the raw aggregate right? If not → it's a
   `Code.gs` derive issue (check the matching builder + the source-sheet columns in §2).
3. **If the tab is right but the chart is wrong** → it's a frontend calc/filter issue in the
   render function (check §6 for a duplicated definition you may have changed in only one place).
4. **Check the change-impact matrix (§7)** for siblings that share the definition.
5. **Reconcile counts:** a KPI count should equal the distinct identities in its source tab.
   Divergence used to mean the identity-mismatch fragility — now run **`?debug=1`** (or
   `runChecks()` in the console) first; a failing invariant usually points straight at it.

---

## 10. Canonical identity (`plant_uid`), shared `DEFS`, and invariant checks

**`plant_uid` — one id per plant per source.** Stamped in `Code.gs` on every plant tab:
- `onaUID(d)` = `district\|facNorm\|lpm` → on `ona_all_plants`, `ona_monthly_all`, `ona_timeline`
- `euUID(d)`  = `QR\|district\|hospital\|capacity\|manufacturer` → on `eu_*` tabs

The frontend keys `TL.history` / `TL2.history` by `plant_uid`, the plant dropdown emits it
(`PLANTS_BY_PAGE['1'|'2']`), KPI filters match `p.uid`, `applyFacFilter_` matches `r.uid`, and
drill-downs resolve by uid (`euPlantByUID_(uid)` on EU; `TL.history[uid]` inline via
`purClickPlant`/`tlClickPlant` on ONA). Complaints stay registry-asset-keyed
(`EU_CROSS`, `plants`) — they are not drill identities.

**`DEFS` — single source of truth for status semantics** (defined next to `badge`/`pct`/`avg`):

| Helper | Meaning |
|---|---|
| `DEFS.euFunctional(es)` | `es ∈ {Functional, Functional Installed}` |
| `DEFS.euNonFunctional(es)` | `es ∈ {In Complaint, Non Functional Repairable}` |
| `DEFS.onaFunctional(os)` | `os === 'Functional'` |
| `DEFS.euStatusColor(es)` | Functional→green, Fn Installed→blue, In Complaint→red, other→amber, empty→grey |
| `DEFS.euStatusClass(es)` | same mapping as g/b/r/a (grey for empty) |
| `DEFS.notRunningByPurity(p)` | latest drill purity 0 (`p.nr`) — the EU **"Purity = 0" KPI** |
| `DEFS.notRunningByHours(p)`  | latest drill run-hours 0 (`p.epr===0`) — EU **Intelligence** group |

> Change a definition **here** and every chart/KPI/badge updates together. New code should use
> `DEFS.*` rather than re-inlining a status comparison.

**Invariant checks — `runChecks()` + `?debug=1`.** `runChecks()` (also `window.runChecks()` from
the console) asserts the structural facts the widgets depend on: `plant_uid` present + unique per
plant list, monthly/timeline uids resolve, timelines keyed by non-empty uid, KPI arithmetic
(func+nonfunc ≤ population), and that the dynamic date spans were derived. Opening the dashboard
with **`?debug=1`** runs them after every load/refresh and shows a green/red pass-fail panel
(also mirrored to the console). A red check is a real data/identity regression — fix it before shipping.

### Maintenance checklist (keep this file true)
- Added/changed a derive column or identity rule → update §2/§3 and re-run `runDerive()`.
- Added a status meaning or colour → add it to `DEFS` (§10), not inline.
- Added a structural assumption a widget relies on → add an assertion to `runChecks()`.
- Added a calc or viz → update `tools/impact_map.json` so the impact analyzer stays accurate.
