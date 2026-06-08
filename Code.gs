// =====================================================================
// PSA Plant Live Dashboard — Derive Step
// Google Apps Script  |  Spec: PSA_Dashboard_Spec_LiveSheets.md v2.4
// Reference date: 17-Apr-2026
// =====================================================================
//
// HOW TO USE
// ----------
// 1. Create a new Google Apps Script project (script.google.com).
// 2. Paste this file as Code.gs.
// 3. Fill in all PASTE_... values in CONFIG below.
// 4. Run installTriggers() once to set up the auto-rebuild schedule.
// 5. Deploy as Web App (Execute as: Me, Who can access: Anyone) for the
//    Refresh button's on-demand rebuild path.
//
// SOURCE SHEET SETUP
// ------------------
// Upload each Excel file as its own Google Sheet:
//   gs_registry   ← stockOnHandReport.xlsx       (tab: sheet1)
//   gs_ona        ← ONA_MockDrill.xlsx            (tab: data)
//   gs_eupkaran   ← e-upkaran_MockDrill.xlsx      (tab: sheet1)
//   gs_complaints ← ComplaintsData.xlsx           (tab: Complaints  — CMC + AMC merged into one tab)
//   gs_mapping    ← ONA_Stock_in_Hand_Matching_vApr08.xlsx (tab: Final Matched)
//
// Create one more blank spreadsheet for output: gs_dashboard_data.
// Share all source sheets + gs_dashboard_data as "Anyone with link can view".
// =====================================================================

// ---- CONFIGURATION ----
const CONFIG = {
  // Paste each spreadsheet's ID from its URL (/d/<ID>/edit)
  registry:   '1fnUdcqFIq0xn7zB2YowV0L5ggU6kZ3A0d8d1CTq97CU',
  ona:        '1VKJL8bqEpiqnMuNsq91sJ4AGzN34xfurabouXS-IpHs',
  eupkaran:   '1_q3eXx0ezZ4L0SybAxlMWuWaSdUlUomDjVf0rBoNX84',
  complaints: '1jwzifzH5t7lnl9bp_9A64D9E3RvVhuLBa8lmrpwrjHg',
  mapping:    '15r1z5jMugN1oyLxvMyZX58IkNf9H7sAuvG2-foV-aYo',
  dashboard:  '1oW1AhEUIZemPSye08cqvolW6j2WLhXXQ5jGpQ0KTJh4',

  // Tab names within each spreadsheet
  tabs: {
    registry:   'sheet1',
    ona:        'data',
    eupkaran:   'sheet1',
    complaints: 'Complaints',
    mapping:    'Final Matched',
  },

  // Secret token for Web App endpoint (choose any string, set same in DASH_CONFIG)
  webAppToken: 'psa-refresh-2026',
};


// =====================================================================
// §3  NORMALIZATION HELPERS
// =====================================================================

function normName(s) {
  if (s == null) return '';
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normDist(d) {
  return normName(districtDisplay(d));
}

function districtDisplay(d) {
  if (!d) return '';
  const s   = String(d).trim();
  const low = s.toLowerCase();
  if (low === 'jaipur1' || low === 'jaipur 1' || low === 'jaipur-1') return 'Jaipur';
  if (low === 'jaipur2' || low === 'jaipur 2' || low === 'jaipur-2') return 'Jaipur';
  if (low === 'jhunjhunun')                                           return 'Jhunjhunu';
  if (low === 'phalodi')                                              return 'Jodhpur';
  if (low === 'churu')                                                return 'Churu';
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function parseCap(v) {
  if (v == null || String(v).trim() === '' || String(v).trim() === '--') return null;
  const m = String(v).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const MFR_STRIP = new Set([
  'pvt','private','ltd','limited','llp','india','indai','co','company',
  'the','inc','system','systems','advance','advanced','and'
]);

function normMfr(s) {
  if (!s || String(s).trim() === '' || String(s).trim() === '#N/A') return '';
  return String(s).toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !MFR_STRIP.has(t))
    .join(' ')
    .trim();
}

function qrSuffix(s) {
  if (!s) return '';
  const m = String(s).match(/(\d{6,9})\s*$/);
  return m ? m[1] : '';
}

function fromExcel(serial) {
  if (serial == null || serial === '') return null;
  // Google Sheets getValues() returns Date objects for date-formatted cells
  if (serial instanceof Date) return serial;
  if (isNaN(Number(serial))) return null;
  const n = Number(serial);
  if (n < 1) return null;
  return new Date((n - 25569) * 86400 * 1000);
}

function fromDMY(str) {
  if (!str) return null;
  // Case 1: Sheets getValues() already returned a JS Date object
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  var s = String(str).trim();
  if (!s || s === '--') return null;

  // Case 2: ISO format  YYYY-MM-DD  (e.g. from text cells or direct entry)
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    var d = new Date(parseInt(iso[1],10), parseInt(iso[2],10)-1, parseInt(iso[3],10));
    return isNaN(d.getTime()) ? null : d;
  }

  // Case 3: DD-Mon-YYYY  or  DD Mon YYYY  (original Excel format)
  var MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  var named = s.match(/(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})/);
  if (named) {
    var mon = MONTHS[named[2].slice(0,3).toLowerCase()];
    if (mon !== undefined) return new Date(parseInt(named[3],10), mon, parseInt(named[1],10));
  }

  // Case 4: DD/MM/YYYY  (Indian locale entered manually)
  var slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    var a = parseInt(slash[1],10), b = parseInt(slash[2],10), y = parseInt(slash[3],10);
    // If first part > 12 it must be day (D/M/Y); otherwise assume D/M/Y (Indian default)
    var d2 = a > 12
      ? new Date(y, b-1, a)   // D/M/Y
      : new Date(y, b-1, a);  // treat as D/M/Y for Indian locale
    return isNaN(d2.getTime()) ? null : d2;
  }

  // Case 5: Generic JS Date parse as last resort
  var d3 = new Date(s);
  return isNaN(d3.getTime()) ? null : d3;
}

function toISO(dt) {
  if (!dt) return '';
  const y  = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const d  = String(dt.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + d;
}

function parsePurity() {
  const readings = Array.prototype.slice.call(arguments);
  const valid = readings
    .map(r => { const n = parseFloat(r); return (!isNaN(n) && n > 0) ? Math.min(n, 100) : null; })
    .filter(n => n !== null);
  if (!valid.length) return null;
  return valid.reduce(function(a, b) { return a + b; }, 0) / valid.length;
}

// Parse ONA facility string:  "Hospital Name (Scheme) (LPM LPM)_ID"
function parseONAFacility(facility) {
  if (!facility) return { name: '', osc: '', lpm: null };
  var s = String(facility).replace(/_\w+$/, '').trim(); // strip _ID suffix

  var lpm = null, osc = '';
  var lpmM = s.match(/\((\d+)\s*(?:LPM|lpm)?\)\s*$/);
  if (lpmM) { lpm = parseInt(lpmM[1], 10); s = s.slice(0, lpmM.index).trim(); }

  var schM = s.match(/\(([^)]+)\)\s*$/);
  if (schM) { osc = schM[1].trim(); s = s.slice(0, schM.index).trim(); }

  return { name: s.trim(), osc: osc, lpm: lpm };
}


// =====================================================================
// SHEET READER — returns array of {header: value} objects
// bannerRows: number of rows to skip before the header row
// =====================================================================

function readSheetAsObjects(spreadsheetId, tabName, bannerRows) {
  bannerRows = bannerRows || 0;
  const ss    = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Sheet not found: "' + tabName + '" in ' + spreadsheetId);

  const all     = sheet.getDataRange().getValues();
  const headers = all[bannerRows]; // 0-indexed
  const rows    = [];

  for (var i = bannerRows + 1; i < all.length; i++) {
    const row = all[i];
    if (row.every(function(c) { return c === '' || c == null; })) continue;
    const obj = {};
    headers.forEach(function(h, j) { obj[String(h).trim()] = row[j]; });
    // Also expose positional keys for columns whose names we can't guess
    row.forEach(function(v, j) { obj['_col' + j] = v; });
    rows.push(obj);
  }
  Logger.log('  Read ' + rows.length + ' rows from "' + tabName + '"');
  return rows;
}


// =====================================================================
// §4  DERIVE STEP — main function
// =====================================================================

function deriveDashboard() {
  const t0 = new Date();
  Logger.log('=== PSA Derive Step  ' + t0.toISOString() + ' ===');

  // ------------------------------------------------------------------
  // STEP A — Read registry; build byDHC and byQR indexes
  // ------------------------------------------------------------------
  Logger.log('Reading gs_registry…');
  const regRows = readSheetAsObjects(CONFIG.registry, CONFIG.tabs.registry, 3);

  // Log registry headers to help with column-name debugging
  if (regRows.length) Logger.log('Registry headers: ' + Object.keys(regRows[0]).filter(function(k) { return !k.startsWith('_col'); }).join(' | '));

  const byDHC = {}; // "normDist|normHosp|cap" → [asset]
  const byDH  = {}; // "normDist|normHosp"    → [asset]  (ignores capacity — used for Step B fallbacks)
  const byQR  = {}; // qrSuffix → asset

  regRows.forEach(function(r) {
    // Use normDist (= normName∘districtDisplay) so "Jaipur1"/"Jaipur2" keys
    // in byDHC/byDH match the sihDist computed the same way in Step B.
    const dist = normDist(r['District Name']     || r['_col1'] || '');
    const hosp = normName(r['Hospital Name']     || r['_col2'] || '');
    const cap  = parseCap(r['Capacity of PSA Plant (in LPM)'] || r['_col22'] || '');
    const qr   = qrSuffix(r['QR Code']          || r['_col9'] || '');
    const key  = dist + '|' + hosp + '|' + cap;

    const asset = {
      dd:       districtDisplay(r['District Name'] || r['_col1'] || ''),
      sf:       String(r['Hospital Name'] || r['_col2'] || '').trim(),
      cap:      cap,
      eq:       qr,
      sei:      String(r['Equipment Status']   || r['_col18'] || '').trim(),
      sii:      String(r['Inventory Status']   || r['_col17'] || '').trim(),
      smd:      toISO(fromDMY(r['MOIC Verified Date'] || r['_col14'] || '')),
      supplier: normMfr(r['Supplier'] || r['_col19'] || ''),
      hq:       !!qr,
      iv:       String(r['Inventory Status'] || r['_col17'] || '').trim() === 'Verified Inventory',
    };

    if (!byDHC[key]) byDHC[key] = [];
    byDHC[key].push(asset);
    const dhKey = dist + '|' + hosp;
    if (!byDH[dhKey]) byDH[dhKey] = [];
    byDH[dhKey].push(asset);
    if (qr) {
      if (byQR[qr]) Logger.log('WARN Step A: duplicate QR suffix "' + qr + '" — ' + asset.dd + '/' + asset.sf + ' vs existing ' + byQR[qr].dd + '/' + byQR[qr].sf + ' (keeping first)');
      else byQR[qr] = asset;
    }
  });
  Logger.log('Registry: ' + regRows.length + ' rows | ' + Object.keys(byDHC).length + ' DHC keys | ' + Object.keys(byQR).length + ' QR keys');

  // BUILD registry_plants tab — ALL 515 assets for Page 3 funnel
  const registryPlantsHeaders = ['district','hospital','capacity','qr_suffix','has_qr','equipment_status','inventory_status','moic_verified_date','is_verified'];
  const registryPlantsRows = regRows.map(function(r) {
    var qr  = qrSuffix(r['QR Code'] || r['_col9'] || '');
    var sii = String(r['Inventory Status'] || r['_col17'] || '').trim();
    return [
      districtDisplay(r['District Name'] || r['_col1'] || ''),
      String(r['Hospital Name'] || r['_col2'] || '').trim(),
      parseCap(r['Capacity of PSA Plant (in LPM)'] || r['_col22'] || '') || '',
      qr,
      qr ? 'true' : 'false',
      String(r['Equipment Status'] || r['_col18'] || '').trim(),
      sii,
      toISO(fromDMY(r['MOIC Verified Date'] || r['_col14'] || '')),
      (sii === 'Verified Inventory') ? 'true' : 'false',
    ];
  });
  Logger.log('Registry all-plants: ' + registryPlantsRows.length + ' rows');

  // ------------------------------------------------------------------
  // STEP B — Mapping Code → registry asset
  // ------------------------------------------------------------------
  Logger.log('Reading gs_mapping…');
  const mapRows = readSheetAsObjects(CONFIG.mapping, CONFIG.tabs.mapping, 0);
  if (mapRows.length) Logger.log('Mapping headers: ' + Object.keys(mapRows[0]).filter(function(k) { return !k.startsWith('_col'); }).join(' | '));

  const codeMap   = {}; // code → {asset, of, onaDistrict, onaFacRaw, co, sf, cs, dd}
  const missesB   = [];
  var resolvedB = 0, totalB = 0;

  // Codes where DHC bucket resolution was ambiguous (multiple plants, no unique manufacturer match).
  // Complaint data for these codes is excluded from outputs — linkage cannot be verified.
  // Recalculates automatically on every derive as registry/mapping data changes.
  const ambiguousCodes = new Set();
  const ambiguityReasons = {}; // code → 'DHC_MULTI' | 'DHC_COLLISION' | 'DHC_MULTI+DHC_COLLISION'
  const codeMatchMethod  = {}; // code → 'QR' | 'DHC' | 'F1' | 'F2' | 'F3' | 'F4' | 'MISS'
  const codeRawInfo      = {}; // code → {onaFac, onaDist, sihFac, sihDist, sihCap}

  // Resolve an asset from a bucket using manufacturer tiebreak.
  // codeRef: if provided and resolution is ambiguous, the code is added to ambiguousCodes.
  function resolveBucket_(bucket, sihMfr, codeRef) {
    if (!bucket || !bucket.length) return null;
    if (bucket.length === 1) return bucket[0];
    if (sihMfr) {
      var exact = bucket.filter(function(a){ return a.supplier === sihMfr; });
      if (exact.length === 1) return exact[0];
      var tok = sihMfr.split(' ')[0];
      if (tok) {
        var part = bucket.filter(function(a){ return a.supplier && a.supplier.indexOf(tok) !== -1; });
        if (part.length === 1) return part[0];
      }
    }
    // Ambiguous — log and mark code so its complaints are excluded
    if (codeRef != null) {
      ambiguousCodes.add(String(codeRef));
      if (!ambiguityReasons[String(codeRef)]) ambiguityReasons[String(codeRef)] = 'DHC_MULTI';
    }
    Logger.log('WARN resolveBucket_: ' + bucket.length + ' assets share the same DHC key, picking first. Caps: ' + bucket.map(function(a){return a.cap;}).join(',') + ' Suppliers: ' + bucket.map(function(a){return a.supplier||'?';}).join(','));
    return bucket[0];
  }

  // Strip trailing tokens from a normalized hospital name if they normalize to the same district.
  // E.g. "bdm hospital kotputali dh jaipur2" with dist "jaipur" → "bdm hospital kotputali dh"
  // Returns stripped string if any tokens were removed, otherwise null.
  function stripDistSuffix_(hospNorm, distNorm) {
    var parts = hospNorm.split(' ');
    var changed = false;
    while (parts.length > 1) {
      var last = parts[parts.length - 1];
      if (normDist(last) === distNorm) { parts.pop(); changed = true; }
      else break;
    }
    return changed ? parts.join(' ') : null;
  }

  mapRows.forEach(function(m) {
    // Code is col 1 (0-indexed); try named key first
    const code = m['Code'] != null ? m['Code'] : m['_col1'];
    if (code == null || code === '') return;
    totalB++;

    // ONA side: cols 3-6
    const onaDistRaw = String(m['ONA District']          || m['_col3'] || '').trim();
    const onaFacRaw  = String(m['ONA Health Facility']   || m['_col4'] || '').trim();
    const onaCapRaw  = m['ONA Capacity']                 != null ? m['ONA Capacity']  : m['_col5'];
    const onaMfrRaw  = String(m['ONA Manufacturer']      || m['_col6'] || '').trim();

    // SIH side: cols 7-11 (col 11 = SIH QR Code — optional column for disambiguation)
    const sihDistRaw = String(m['SIH District']          || m['_col7']  || '').trim();
    const sihHospRaw = String(m['SIH Health Facility']   || m['_col8']  || '').trim();
    const sihCapRaw  = m['SIH Capacity']                 != null ? m['SIH Capacity']  : m['_col9'];
    const sihMfrRaw  = String(m['SIH Manufacturer']      || m['_col10'] || '').trim();
    const sihQRRaw   = String(m['SIH QR Code']           || m['_col11'] || '').trim();

    // Use normDist (= normName∘districtDisplay) so "Jaipur1"/"Jaipur2" → "jaipur"
    const sihDist = normDist(sihDistRaw);
    const sihHosp = normName(sihHospRaw);
    const sihCap  = parseCap(sihCapRaw);
    const sihMfr  = normMfr(sihMfrRaw);
    const sihQR   = qrSuffix(sihQRRaw);

    // Store raw info for all codes (resolved or not) for the mapping_report tab
    codeRawInfo[String(code)] = {
      onaFac:  onaFacRaw,
      onaDist: onaDistRaw,
      onaCap:  onaCapRaw != null ? String(onaCapRaw) : '',
      onaMfr:  onaMfrRaw,
      sihFac:  sihHospRaw,
      sihDist: sihDistRaw,
      sihCap:  sihCapRaw != null ? String(sihCapRaw) : '',
      sihMfr:  sihMfrRaw,
    };

    var asset = null;
    var fallbackUsed = '';
    var matchedViaQR = false;

    // ── QR lookup: highest priority — exact match when SIH QR Code is provided ──
    // Add "SIH QR Code" column (col 11) to the mapping Excel to resolve ambiguous cases.
    if (sihQR && byQR[sihQR]) {
      asset = byQR[sihQR];
      matchedViaQR = true;
      fallbackUsed = '';  // QR match is the primary — not a fallback
    }

    // ── DHC lookup: district + hospital + capacity (when QR not specified) ──
    if (!asset) asset = resolveBucket_(byDHC[sihDist + '|' + sihHosp + '|' + sihCap], sihMfr, code);

    // ── F1: strip trailing district-suffix from hospital name, same capacity ──
    if (!asset) {
      var stripped = stripDistSuffix_(sihHosp, sihDist);
      if (stripped) {
        asset = resolveBucket_(byDHC[sihDist + '|' + stripped + '|' + sihCap], sihMfr, code);
        if (asset) fallbackUsed = 'F1:strip-hosp-suffix';
      }
    }

    // ── F2: original hospital, any capacity (handles capacity mismatch / null cap) ──
    if (!asset) {
      asset = resolveBucket_(byDH[sihDist + '|' + sihHosp], sihMfr, code);
      if (asset) fallbackUsed = 'F2:any-cap';
    }

    // ── F3: stripped hospital, any capacity ──
    if (!asset) {
      var stripped2 = stripped || stripDistSuffix_(sihHosp, sihDist);
      if (stripped2) {
        asset = resolveBucket_(byDH[sihDist + '|' + stripped2], sihMfr, code);
        if (asset) fallbackUsed = 'F3:strip+any-cap';
      }
    }

    // ── F4: last token of hospital name as alternative district ──
    if (!asset) {
      var hospParts = sihHosp.split(' ');
      if (hospParts.length > 1) {
        var altDist = hospParts[hospParts.length - 1];
        if (altDist !== sihDist) {
          // Try with the alternative district and the full hospital name
          asset = resolveBucket_(byDH[altDist + '|' + sihHosp], sihMfr, code);
          if (!asset) {
            // Also try stripping the alt-dist token from the hospital name
            asset = resolveBucket_(byDH[altDist + '|' + hospParts.slice(0, -1).join(' ')], sihMfr, code);
          }
          if (asset) fallbackUsed = 'F4:alt-dist(' + altDist + ')';
        }
      }
    }

    if (asset) {
      resolvedB++;
      var matchMethod = matchedViaQR ? 'QR' : (!fallbackUsed ? 'DHC' : fallbackUsed.split(':')[0].toUpperCase());
      codeMatchMethod[String(code)] = matchMethod;
      if (fallbackUsed) Logger.log('Step B ' + fallbackUsed + ': code ' + code + ' → ' + asset.dd + ' / ' + asset.sf);
      codeMap[String(code)] = {
        asset:       asset,
        of:          parseONAFacility(onaFacRaw).name || onaFacRaw,
        onaDistrict: onaDistRaw,
        onaFacRaw:   onaFacRaw,
        onaCap:      parseCap(onaCapRaw),
        onaMfr:      normMfr(onaMfrRaw),
        sf:          asset.sf,
        cs:          asset.cap,
        dd:          asset.dd,
        dept:        String(m['Department'] || '').trim(),
      };
    } else {
      codeMatchMethod[String(code)] = 'MISS';
      missesB.push({ code: code, key: sihDist + '|' + sihHosp + '|' + sihCap });
    }
  });

  Logger.log('Step B: ' + resolvedB + '/' + totalB + ' codes resolved (target ≥441/450)');
  if (missesB.length) Logger.log('Step B misses (' + missesB.length + '): ' + JSON.stringify(missesB.slice(0, 20)));

  // ------------------------------------------------------------------
  // STEP C — ONA drills → Code
  // ------------------------------------------------------------------
  Logger.log('Reading gs_ona…');
  const onaRows = readSheetAsObjects(CONFIG.ona, CONFIG.tabs.ona, 0);
  if (onaRows.length) Logger.log('ONA headers sample: ' + Object.keys(onaRows[0]).filter(function(k) { return !k.startsWith('_col'); }).slice(0, 10).join(' | '));

  // Parse all ONA drill rows once
  const onaParsed = [];
  onaRows.forEach(function(r) {
    const facStr  = String(r['Gen_Information/Facility'] || r['Facility'] || '');
    const facParsed = parseONAFacility(facStr);

    // Prefer _submission_time for date; fall back to date_of_assessment
    var drillDate = null;
    const subTime   = r['Gen_Information/_submission_time']   || r['_submission_time'];
    const assessDate = r['Gen_Information/date_of_assessment'] || r['date_of_assessment'];
    if (subTime   && !isNaN(Number(subTime)))   drillDate = fromExcel(subTime);
    else if (assessDate && !isNaN(Number(assessDate))) drillDate = fromExcel(assessDate);

    const op = parsePurity(
      r['PSA_plant/Oxygen_Purity_displayed_1']   || r['Oxygen_Purity_displayed_1']   || '',
      r['PSA_plant/Oxygen_Purity_displayed_12']  || r['Oxygen_Purity_displayed_12']  || '',
      r['PSA_plant/Oxygen_Purity_displayed_123'] || r['Oxygen_Purity_displayed_123'] || ''
    );

    const distRaw = String(r['Gen_Information/District'] || r['District'] || '').trim();
    if (!distRaw && !facParsed.name) return;

    onaParsed.push({
      distNorm: normName(distRaw),
      distDisp: normDist(distRaw),
      facNorm:  normName(facParsed.name),
      osc:      facParsed.osc,
      lpm:      facParsed.lpm,
      mfr:      normMfr(r['Gen_Information/vendorManufacturingHF_1'] || r['vendorManufacturingHF_1'] || ''),
      os:       String(r['Gen_Information/Wheather_fn']   || r['Wheather_fn']   || '').trim(),
      or_:      String(r['Gen_Information/Wheather_fn_1'] || r['Wheather_fn_1'] || '').trim(),
      op:       op,
      od:       toISO(drillDate),
      date:     drillDate,
    });
  });
  Logger.log('ONA: ' + onaParsed.length + ' parsed drills');

  // ------------------------------------------------------------------
  // BUILD ona_all_plants  (ALL ONA drills — not limited to 441 matched)
  // Groups by unique district+facility+lpm identity; keeps latest drill.
  // ------------------------------------------------------------------
  const onaAllByIdent = {}; // "distNorm|facNorm|lpm" → {drills[], distDisplay, osc, lpm}
  onaParsed.forEach(function(d) {
    const key = d.distNorm + '|' + d.facNorm + '|' + (d.lpm != null ? d.lpm : '');
    if (!onaAllByIdent[key]) {
      onaAllByIdent[key] = { drills: [], distDisplay: districtDisplay(d.distNorm), osc: d.osc, lpm: d.lpm, facNorm: d.facNorm };
    }
    onaAllByIdent[key].drills.push(d);
    if (!onaAllByIdent[key].osc && d.osc) onaAllByIdent[key].osc = d.osc;
  });

  const onaAllPlantsHeaders = ['district','facility','scheme','capacity','latest_status','latest_purity','latest_date','nf_reason','drill_count'];
  const onaAllPlantsRows = Object.values(onaAllByIdent).map(function(g) {
    var sorted = g.drills.filter(function(d){return d.date;}).sort(function(a,b){return a.date > b.date ? -1 : 1;});
    var latest = sorted[0] || g.drills[0];
    return [
      g.distDisplay,
      g.facNorm,
      g.osc || '',
      g.lpm != null ? g.lpm : '',
      latest ? latest.os  : '',
      latest && latest.op != null ? Number(latest.op).toFixed(1) : '',
      latest ? latest.od  : '',
      latest ? latest.or_ : '',
      g.drills.length,
    ];
  });
  Logger.log('ONA all-plants: ' + onaAllPlantsRows.length + ' unique identities');

  // ------------------------------------------------------------------
  // BUILD ona_monthly_all  (ALL ONA drills aggregated by month+district)
  // Used for ONA timeline and purity overview — not limited to 441 matched.
  // ------------------------------------------------------------------
  const onaMonthMap = {}; // "month|district" → {total, f, n, purs:[]}
  onaParsed.forEach(function(d) {
    if (!d.od) return;
    var m    = d.od.slice(0, 7);
    var dist = districtDisplay(d.distNorm);
    var key  = m + '|' + dist;
    if (!onaMonthMap[key]) onaMonthMap[key] = { month: m, district: dist, total: 0, f: 0, n: 0, purs: [] };
    onaMonthMap[key].total++;
    if (d.os === 'Functional' || d.os === 'Functional Installed') onaMonthMap[key].f++;
    else onaMonthMap[key].n++;
    if (d.op != null) onaMonthMap[key].purs.push(d.op);
  });

  const onaMonthlyHeaders = ['month','district','total','functional','not_functional','avg_purity'];
  const onaMonthlyRows = Object.values(onaMonthMap).sort(function(a,b) {
    var ka = a.month + '|' + a.district, kb = b.month + '|' + b.district;
    return ka < kb ? -1 : 1;
  }).map(function(s) {
    var avgP = s.purs.length ? (s.purs.reduce(function(a,b){return a+b;},0)/s.purs.length).toFixed(1) : '';
    return [s.month, s.district, s.total, s.f, s.n, avgP];
  });
  Logger.log('ONA monthly-all: ' + onaMonthlyRows.length + ' month×district rows');

  const onaDrillsByCode = {}; // code → [drill]
  const onaTimeline     = []; // flat rows for ona_timeline tab
  var matchedC = 0;

  Object.keys(codeMap).forEach(function(code) {
    const cm = codeMap[code];

    const matchDist = normName(cm.onaDistrict);
    const matchFac  = normName(parseONAFacility(cm.onaFacRaw).name || cm.onaFacRaw);
    const matchCap  = cm.onaCap;
    const matchMfr  = cm.onaMfr;

    const hits = onaParsed.filter(function(d) {
      // District (normalized + display-normalized)
      if (matchDist && d.distNorm !== matchDist && d.distDisp !== normName(cm.dd)) return false;

      // Facility name: require ≥70% overlap via substring
      if (matchFac) {
        const a = matchFac, b = d.facNorm;
        if (!a.includes(b) && !b.includes(a)) {
          // First-word fallback — require ≥5 chars to avoid short-name false positives
          // (e.g. "SMS", "Max", "BVM" are 3 chars and match too broadly)
          const fw = a.split(' ')[0];
          if (fw.length >= 5 && !b.includes(fw)) return false;
        }
      }

      // Capacity (if both known)
      if (matchCap && d.lpm && d.lpm !== matchCap) return false;

      // Manufacturer (blank/empty = wildcard per spec)
      if (matchMfr && d.mfr && d.mfr !== matchMfr) return false;

      return true;
    });

    if (hits.length > 0) {
      matchedC++;
      onaDrillsByCode[code] = hits;
    }
  });
  Logger.log('Step C: ' + matchedC + ' codes have ONA drills (of ' + Object.keys(codeMap).length + ' codes)');

  // ------------------------------------------------------------------
  // STEP D — e-Upkaran drills → Code
  // ------------------------------------------------------------------
  Logger.log('Reading gs_eupkaran…');
  const euRows = readSheetAsObjects(CONFIG.eupkaran, CONFIG.tabs.eupkaran, 3);
  if (euRows.length) Logger.log('EU headers: ' + Object.keys(euRows[0]).filter(function(k) { return !k.startsWith('_col'); }).join(' | '));
  // Diagnostic: show raw date value from first row to confirm format
  if (euRows.length > 0) {
    var sampleDate = euRows[0]['Date of Mockdrill'];
    Logger.log('EU sample date raw: ' + JSON.stringify(sampleDate) + ' | type: ' + typeof sampleDate + ' | isDate: ' + (sampleDate instanceof Date));
    Logger.log('EU sample date parsed: ' + toISO(fromDMY(sampleDate)));
  }

  const euParsed = [];
  euRows.forEach(function(r) {
    const drillDate = fromDMY(r['Date of Mockdrill'] || r['_col8'] || '');
    const ep    = parseFloat(r['Purity(in percent)']            || r['_col12'] || '');
    const hours = parseFloat(r['Total running hours']           || r['_col11'] || '');

    const distRaw = String(r['District Name'] || r['_col1'] || '').trim();
    const hospRaw = String(r['Hospital Name'] || r['_col2'] || '').trim();
    if (!distRaw || !hospRaw) return;

    euParsed.push({
      distNorm: normName(distRaw),
      distDisp: normDist(distRaw),
      hospNorm: normName(hospRaw),
      cap:      parseCap(r['Capacity of PSA Plant (in LPM)'] || r['_col10'] || ''),
      mfr:      normMfr(String(r['Manufacturer'] || r['Supplier'] || r['_col6'] || '')),
      euQR:     qrSuffix(String(r['QR Code'] || r['_col5'] || '')),
      es:       String(r['Equipment Status'] || r['_col4'] || '').trim(),
      ep:       (!isNaN(ep) && ep > 0) ? Math.min(ep, 100) : null,
      epr:      !isNaN(hours) ? hours : null,
      el:       String(r['Any leakage observed'] || r['_col19'] || '').toLowerCase().startsWith('y'),
      ef:       String(r['Fire Safety measures in the hospital'] || r['_col17'] || '').trim(),
      ed:       toISO(drillDate),
      date:     drillDate,
      notRunning: (ep === 0 && hours === 0),
    });
  });
  Logger.log('EU: ' + euParsed.length + ' parsed drills');

  // Note: EU data stores QR codes as large integers (~20 digits) which Google Sheets
  // returns in scientific notation ("8E+20"). JavaScript loses precision on these, making
  // EU QR-based matching unreliable. eu_direct_cross uses district+hospital+capacity instead.

  const euDrillsByCode = {}; // code → [drill]
  const euTimeline     = []; // flat rows for eu_timeline tab
  const matchedDIdents = new Set();

  Object.keys(codeMap).forEach(function(code) {
    const cm    = codeMap[code];
    const asset = cm.asset;

    const regDist = normName(asset.dd);
    const regHosp = normName(asset.sf);
    const regCap  = asset.cap;
    const regMfr  = asset.supplier;

    const hits = euParsed.filter(function(d) {
      // District: accept raw-normalized OR display-normalized match
      if (d.distNorm !== regDist && d.distDisp !== regDist) return false;

      // Hospital: exact first, then substring, then first-word fallback
      if (d.hospNorm !== regHosp) {
        if (!d.hospNorm.includes(regHosp) && !regHosp.includes(d.hospNorm)) {
          const fw = regHosp.split(' ')[0];
          if (fw.length < 4 || !d.hospNorm.includes(fw)) return false;
        }
      }

      // Capacity: only filter when both are known
      if (regCap && d.cap && d.cap !== regCap) return false;
      return true;
    });

    if (hits.length > 0) {
      const ident = regDist + '|' + regHosp + '|' + regCap;
      matchedDIdents.add(ident);
      euDrillsByCode[code] = hits;
    }
  });
  const unmatchedD = Object.keys(codeMap).filter(function(code) { return !euDrillsByCode[code]; });
  Logger.log('Step D: ' + matchedDIdents.size + ' identities matched | ' + unmatchedD.length + ' codes have no EU drill (reporting gap — expected)');

  // BUILD eu_all_plants — ALL EU drills, one row per unique district+hospital+cap identity
  const euAllByIdent = {};
  euParsed.forEach(function(d) {
    const key = d.distNorm + '|' + d.hospNorm + '|' + (d.cap != null ? d.cap : '');
    if (!euAllByIdent[key]) {
      euAllByIdent[key] = { drills: [], distDisplay: districtDisplay(d.distNorm), hosp: d.hospNorm, cap: d.cap };
    }
    euAllByIdent[key].drills.push(d);
  });
  const euAllPlantsHeaders = ['district','hospital','capacity','latest_status','latest_purity','latest_hours','latest_date','eu_leakage','eu_fire_safety','drill_count'];
  const euAllPlantsRows = Object.values(euAllByIdent).map(function(g) {
    var sorted = g.drills.filter(function(d){ return d.date; }).sort(function(a,b){ return a.date > b.date ? -1 : 1; });
    var latest = sorted[0] || g.drills[0];
    return [
      g.distDisplay,
      g.hosp,
      g.cap != null ? g.cap : '',
      latest ? latest.es  : '',
      latest && latest.ep  != null ? Number(latest.ep).toFixed(1)  : '',
      latest && latest.epr != null ? Number(latest.epr).toFixed(1) : '',
      latest ? latest.ed  : '',
      latest ? String(latest.el) : '',
      latest ? latest.ef  : '',
      g.drills.length,
    ];
  });
  Logger.log('EU all-plants: ' + euAllPlantsRows.length + ' unique identities');

  // BUILD eu_monthly_all — ALL EU drills aggregated by month+district
  const euMonthMap = {};
  euParsed.forEach(function(d) {
    if (!d.ed) return;
    var m    = d.ed.slice(0, 7);
    var dist = districtDisplay(d.distNorm);
    var key  = m + '|' + dist;
    if (!euMonthMap[key]) euMonthMap[key] = { month: m, district: dist, total: 0, f: 0, n: 0, purs: [] };
    euMonthMap[key].total++;
    if (d.es === 'Functional' || d.es === 'Functional Installed') euMonthMap[key].f++;
    else euMonthMap[key].n++;
    if (d.ep != null && d.ep > 0) euMonthMap[key].purs.push(d.ep);
  });
  const euMonthlyHeaders = ['month','district','total','functional','not_functional','avg_purity'];
  const euMonthlyRows = Object.values(euMonthMap).sort(function(a,b) {
    return (a.month+'|'+a.district) < (b.month+'|'+b.district) ? -1 : 1;
  }).map(function(s) {
    var avgP = s.purs.length ? (s.purs.reduce(function(a,b){return a+b;},0)/s.purs.length).toFixed(1) : '';
    return [s.month, s.district, s.total, s.f, s.n, avgP];
  });
  Logger.log('EU monthly-all: ' + euMonthlyRows.length + ' month×district rows');

  // ------------------------------------------------------------------
  // STEP E — Complaints → Code via QR → registry
  // ------------------------------------------------------------------
  Logger.log('Reading gs_complaints…');
  const allComps = readSheetAsObjects(CONFIG.complaints, CONFIG.tabs.complaints, 0);
  if (allComps.length) Logger.log('Complaints headers: ' + Object.keys(allComps[0]).filter(function(k){ return !k.startsWith('_col'); }).join(' | '));

  // Pre-parse complaint rows: extract District, Hospital, Capacity, QR once.
  // Reused for ONA complaint matching (Step E) and EU direct cross-reference.
  const compParsed = allComps.map(function(c) {
    return {
      raw:  c,
      dist: normDist(c['District Name']                    || ''),   // col0 — confirmed
      hosp: normName(c['Hospital Name']                    || ''),   // col2 — confirmed
      cap:  null,  // complaints data has no capacity column; DH fallback handles matching
      qr:   qrSuffix(String(c['Service Provider QR Code'] || c['_col4'] || '')),  // col4 — confirmed
      mfr:  normMfr(c['Supplier Name'] || c['Service Provider Name'] || ''),  // col14/col16 — confirmed from headers
    };
  });
  Logger.log('Complaints pre-parsed: ' + compParsed.filter(function(c){ return !!c.dist; }).length + ' rows with district');

  const complaintsByCode = {}; // code → [complaint]
  var matchedE = 0, totalE = 0;
  const missesE = [];

  Logger.log('Step B ambiguous codes: ' + ambiguousCodes.size + ' — complaint data excluded for these (mapping resolves to multiple plants)');

  // Build DHC-key → [codes] map for DHC-based complaint attribution.
  // Complaints are matched to ONA codes by District+Hospital+Capacity of the resolved
  // registry asset. When multiple codes share the same DHC key, QR is used as tiebreaker.
  const codesByAssetDHC = {};
  Object.keys(codeMap).forEach(function(code) {
    var asset = codeMap[code].asset;
    var key = normName(asset.dd) + '|' + normName(asset.sf) + '|' + (asset.cap != null ? String(asset.cap) : '');
    if (!codesByAssetDHC[key]) codesByAssetDHC[key] = [];
    codesByAssetDHC[key].push(String(code));
  });

  // Detect DHC collisions — multiple codes resolving to the same registry location+capacity.
  // If all colliding codes have distinct QR codes: complaints are tiebroken per-record (clean).
  // If QRs are missing or shared: complaints cannot be attributed — mark all codes ambiguous.
  Object.keys(codesByAssetDHC).forEach(function(key) {
    var codes = codesByAssetDHC[key];
    if (codes.length < 2) return;
    var qrs = codes.map(function(c) { return codeMap[c].asset.eq || ''; });
    var distinctQRs = new Set(qrs.filter(Boolean));
    if (distinctQRs.size === codes.length) {
      Logger.log('INFO DHC collision (QR-tiebreakable): ' + key + ' → codes ' + codes.join(',') + ' QRs=' + qrs.join(','));
    } else {
      codes.forEach(function(c) {
        ambiguousCodes.add(c);
        if (!ambiguityReasons[c]) ambiguityReasons[c] = 'DHC_COLLISION';
        else if (ambiguityReasons[c].indexOf('DHC_COLLISION') === -1) ambiguityReasons[c] += '+DHC_COLLISION';
      });
      Logger.log('WARN DHC collision (ambiguous): ' + key + ' → codes ' + codes.join(',') + ' — complaints excluded');
    }
  });
  Logger.log('Step E: ' + ambiguousCodes.size + ' total ambiguous codes — complaint data excluded');

  compParsed.forEach(function(comp) {
    if (!comp.dist && !comp.hosp) return;
    totalE++;

    // Primary: District + Hospital + Capacity
    var dhcKey = comp.dist + '|' + comp.hosp + '|' + (comp.cap != null ? String(comp.cap) : '');
    var candidates = (codesByAssetDHC[dhcKey] || []).slice();

    // Fallback: District + Hospital only (handles null or mismatched capacity)
    if (!candidates.length && comp.hosp) {
      Object.keys(codesByAssetDHC).forEach(function(k) {
        var parts = k.split('|');
        if (parts[0] !== comp.dist) return;
        if (parts[1] === comp.hosp || parts[1].indexOf(comp.hosp) !== -1 || comp.hosp.indexOf(parts[1]) !== -1) {
          codesByAssetDHC[k].forEach(function(c) { if (candidates.indexOf(c) === -1) candidates.push(c); });
        }
      });
    }

    if (!candidates.length) { missesE.push(comp.dist + '|' + comp.hosp); return; }

    // Progressive tiebreaker: Manufacturer → QR
    if (candidates.length > 1 && comp.mfr) {
      var mfrTok = comp.mfr.split(' ')[0];
      var byMfr = candidates.filter(function(c) {
        var assetMfr = codeMap[c] ? codeMap[c].asset.supplier : '';
        return assetMfr && assetMfr.indexOf(mfrTok) !== -1;
      });
      if (byMfr.length > 0 && byMfr.length < candidates.length) candidates = byMfr;
    }

    var ownerCode = null;
    if (candidates.length === 1) {
      ownerCode = candidates[0];
    } else if (comp.qr) {
      var qrMatch = candidates.filter(function(c) { return codeMap[c] && codeMap[c].asset.eq === comp.qr; });
      if (qrMatch.length === 1) ownerCode = qrMatch[0];
    }

    if (!ownerCode) return;
    if (ambiguousCodes.has(ownerCode)) return;

    matchedE++;
    var raw = comp.raw;
    var raiseD  = fromExcel(raw['Complaint Raise Date']     || raw['_col6']  || '');
    var attendD = fromExcel(raw['Complaint Attend date']     || raw['_col9']  || '');
    var closeD  = fromExcel(raw['Complaint Close date']      || raw['_col10'] || '');
    var moicD   = fromExcel(raw['Complaint Close by MOIC']   || raw['_col11'] || '');

    function daysDiff(a, b) { return (a && b) ? Math.round((b - a) / 86400000) : null; }

    var status;
    if (moicD)        status = 'Resolved';
    else if (closeD)  status = 'Pending MOIC Verification';
    else if (attendD) status = 'Under Repair';
    else              status = 'Pending Attendance';

    if (!complaintsByCode[ownerCode]) complaintsByCode[ownerCode] = [];
    complaintsByCode[ownerCode].push({
      rd: toISO(raiseD),
      st: status,
      rs: daysDiff(raiseD,  attendD),
      rp: daysDiff(attendD, closeD),
      vr: daysDiff(closeD,  moicD),
      tr: daysDiff(raiseD,  moicD),
      dh: parseFloat(raw['Total Downtime'] || raw['_col12'] || '') || null,
    });
  });
  Logger.log('Step E: ' + matchedE + '/' + totalE + ' complaints matched by District+Hospital+Capacity');
  if (missesE.length) Logger.log('Step E unmatched (' + missesE.length + '): ' + missesE.slice(0, 10).join(', '));

  // ------------------------------------------------------------------
  // DIRECT CROSS-REFERENCE: EU × Registry × Complaints
  // No ONA mapping needed — EU drills, Complaints, and Registry all share
  // the same district/hospital/capacity/QR identifiers from the same portal.
  // Iterates ALL 515 registry assets; matches EU drills and complaints directly.
  // ------------------------------------------------------------------
  const euDirectCrossHeaders = [
    'district','hospital','capacity','qr_suffix','has_qr',
    'equipment_status','inventory_status','moic_verified_date','is_verified',
    'eu_status','eu_purity','eu_hours','eu_date','eu_leakage','eu_fire_safety','eu_drill_count',
    'complaint_count','has_active_complaint','complaints',
  ];

  function daysDiff2(a, b) { return (a && b) ? Math.round((b - a) / 86400000) : null; }

  const euDirectCrossRows = [];
  var euDirectMatched = 0;

  var euDCMatchedByDHC = 0;

  regRows.forEach(function(r) {
    var regDist = normName(districtDisplay(r['District Name'] || r['_col1'] || ''));
    var regHosp = normName(r['Hospital Name'] || r['_col2'] || '');
    var regCap  = parseCap(r['Capacity of PSA Plant (in LPM)'] || r['_col22'] || '');
    var qr      = qrSuffix(r['QR Code'] || r['_col9'] || '');
    var sii     = String(r['Inventory Status'] || r['_col17'] || '').trim();
    var regMfr  = normMfr(r['Supplier'] || r['_col19'] || '');

    // Match EU drills by district + hospital + capacity (manufacturer tiebreak for ambiguous cases).
    // QR-based matching is not possible: EU stores QR as large integers (~20 digits) that
    // JavaScript truncates to scientific notation, losing the digits needed for suffix matching.
    var euHits = [];
    var candidates = euParsed.filter(function(d) {
      if (d.distNorm !== regDist && d.distDisp !== regDist) return false;
      if (d.hospNorm !== regHosp) {
        if (!d.hospNorm.includes(regHosp) && !regHosp.includes(d.hospNorm)) {
          var fw = regHosp.split(' ')[0];
          if (fw.length < 4 || !d.hospNorm.includes(fw)) return false;
        }
      }
      if (regCap && d.cap && d.cap !== regCap) return false;
      return true;
    });
    if (candidates.length) {
      if (candidates.length > 1 && regMfr) {
        var mfrMatch = candidates.filter(function(d){ return d.mfr && d.mfr.indexOf(regMfr.split(' ')[0]) !== -1; });
        if (mfrMatch.length) candidates = mfrMatch;
      }
      euHits = candidates;
      euDCMatchedByDHC++;
    }

    var sortedEU = euHits.filter(function(d){return d.date;}).sort(function(a,b){return a.date>b.date?-1:1;});
    var latestEU = sortedEU[0] || euHits[0];

    // Match complaints by District+Hospital+Capacity+Manufacturer, with QR as final tiebreaker.
    // Progressive narrowing only applies when the registry has multiple assets at the same
    // DHC key — for unique locations the D+H+C match is sufficient.
    var regComps = [];
    var isDHCShared = (byDHC[regDist + '|' + regHosp + '|' + regCap] || []).length > 1;

    var compMatches = compParsed.filter(function(comp) {
      if (!comp.dist) return false;
      if (comp.dist !== regDist) return false;
      if (comp.hosp !== regHosp) {
        if (comp.hosp.indexOf(regHosp) === -1 && regHosp.indexOf(comp.hosp) === -1) return false;
      }
      if (regCap && comp.cap && comp.cap !== regCap) return false;
      return true;
    });

    if (isDHCShared && compMatches.length > 1) {
      // Tiebreaker 1: Manufacturer
      if (regMfr) {
        var mfrTok = regMfr.split(' ')[0];
        var byMfr2 = compMatches.filter(function(comp) { return comp.mfr && comp.mfr.indexOf(mfrTok) !== -1; });
        if (byMfr2.length > 0) compMatches = byMfr2;
      }
      // Tiebreaker 2: QR (only if still ambiguous after manufacturer)
      if (compMatches.length > 1 && qr) {
        var byQR2 = compMatches.filter(function(comp) { return comp.qr === qr; });
        if (byQR2.length > 0) compMatches = byQR2;
      }
    }

    compMatches.forEach(function(comp) {
      var c = comp.raw;
      var raiseD  = fromExcel(c['Complaint Raise Date']   || c['_col6'] || '');
      var attendD = fromExcel(c['Complaint Attend date']  || c['_col9'] || '');
      var closeD  = fromExcel(c['Complaint Close date']   || c['_col10'] || '');
      var moicD   = fromExcel(c['Complaint Close by MOIC']|| c['_col11'] || '');
      var status;
      if (moicD) status = 'Resolved';
      else if (closeD) status = 'Pending MOIC Verification';
      else if (attendD) status = 'Under Repair';
      else status = 'Pending Attendance';
      regComps.push({
        rd: toISO(raiseD), st: status,
        rs: daysDiff2(raiseD, attendD), rp: daysDiff2(attendD, closeD),
        vr: daysDiff2(closeD, moicD),  tr: daysDiff2(raiseD, moicD),
        dh: parseFloat(c['Total Downtime'] || c['_col12'] || '') || null,
      });
    });

    var hasActive = regComps.some(function(c){ return c.st !== 'Resolved'; });
    if (euHits.length > 0 || regComps.length > 0) euDirectMatched++;

    euDirectCrossRows.push([  // one row per registry asset
      districtDisplay(r['District Name'] || r['_col1'] || ''),
      String(r['Hospital Name'] || r['_col2'] || '').trim(),
      regCap != null ? regCap : '',
      qr,
      qr ? 'true' : 'false',
      String(r['Equipment Status']   || r['_col18'] || '').trim(),
      sii,
      toISO(fromDMY(r['MOIC Verified Date'] || r['_col14'] || '')),
      (sii === 'Verified Inventory') ? 'true' : 'false',
      latestEU ? latestEU.es  : '',
      latestEU && latestEU.ep  != null ? Number(latestEU.ep).toFixed(1)  : '',
      latestEU && latestEU.epr != null ? Number(latestEU.epr).toFixed(1) : '',
      latestEU ? latestEU.ed  : '',
      latestEU ? String(latestEU.el) : '',
      latestEU ? latestEU.ef  : '',
      euHits.length,
      regComps.length,
      hasActive ? 'true' : 'false',
      JSON.stringify(regComps),
    ]);
  });
  var euDCEUOnly   = euDirectCrossRows.filter(function(r){ return r[15] > 0 && r[16] === 0; }).length;
  var euDCCompOnly = euDirectCrossRows.filter(function(r){ return r[15] === 0 && r[16] > 0; }).length;
  var euDCBoth     = euDirectCrossRows.filter(function(r){ return r[15] > 0 && r[16] > 0; }).length;
  var euDCNeither  = euDirectCrossRows.filter(function(r){ return r[15] === 0 && r[16] === 0; }).length;
  Logger.log('EU direct cross: ' + euDirectMatched + '/' + regRows.length + ' registry assets have EU or complaint data');
  Logger.log('  EU matched via DHC: ' + euDCMatchedByDHC);
  Logger.log('  EU drill only (no complaints): ' + euDCEUOnly);
  Logger.log('  Complaints only (no EU drill): ' + euDCCompOnly);
  Logger.log('  BOTH EU drill AND complaint:   ' + euDCBoth + '  ← cross-source matched plants');
  Logger.log('  Neither (registry asset only): ' + euDCNeither);

  // ------------------------------------------------------------------
  // STEP F — Reporting flags (per spec §4)
  // ------------------------------------------------------------------
  const REF_DATE      = new Date('2026-04-17T00:00:00Z');
  const NINETY_DAY_MS = 90 * 24 * 60 * 60 * 1000;

  // ------------------------------------------------------------------
  // BUILD plants ROWS  (§5.1)
  // ------------------------------------------------------------------
  Logger.log('Building plant rows…');
  const plantHeaders = [
    'code','district','department','ona_facility','sih_facility','ona_capacity','sih_capacity',
    'ona_status','ona_scheme','ona_purity','ona_drill_date','ona_nf_reason','ona_functional_reason',
    'eu_status','eu_purity','eu_running_hours','eu_drill_date','eu_leakage','eu_fire_safety',
    'qr_suffix','equipment_status','inventory_status','moic_verified_date',
    'has_qr','is_verified','reporting_ever','reporting_recent','days_since_drill',
    'complaint_clean','complaints',
  ];

  const plantRows = [];

  Object.keys(codeMap).sort(function(a, b) { return Number(a) - Number(b); }).forEach(function(code) {
    const cm    = codeMap[code];
    const asset = cm.asset;

    const onaDrills = onaDrillsByCode[code] || [];
    const euDrills  = euDrillsByCode[code]  || [];
    const comps     = complaintsByCode[code] || [];

    // Latest ONA drill (by date)
    const latestONA = onaDrills.reduce(function(best, d) {
      return (!best || (d.date && best.date && d.date > best.date)) ? d : best;
    }, null);

    // Latest EU drill (by date)
    const latestEU = euDrills.reduce(function(best, d) {
      return (!best || (d.date && best.date && d.date > best.date)) ? d : best;
    }, null);

    // Step F flags
    const re         = euDrills.length > 0;
    const latestEUDt = latestEU ? latestEU.date : null;
    const ds         = latestEUDt ? Math.round((REF_DATE - latestEUDt) / 86400000) : null;
    const rr         = latestEUDt ? ((REF_DATE - latestEUDt) <= NINETY_DAY_MS) : false;

    function fmt(n, places) { return (n != null && !isNaN(n)) ? Number(n).toFixed(places || 1) : ''; }

    plantRows.push([
      code,                                            // c
      cm.dd,                                           // dd
      cm.dept || '',                                   // department
      cm.of,                                           // of (ONA facility name)
      cm.sf,                                           // sf (SIH facility name)
      cm.onaCap   != null ? cm.onaCap   : '',          // co (ONA capacity)
      cm.cs       != null ? cm.cs       : '',          // cs (SIH capacity)
      latestONA ? latestONA.os  : '',                  // os
      latestONA ? latestONA.osc : '',                  // osc
      latestONA ? fmt(latestONA.op)    : '',           // op
      latestONA ? latestONA.od         : '',           // od
      latestONA ? latestONA.or_        : '',           // or_
      '',                                              // ofr (unused — null per spec)
      latestEU  ? latestEU.es          : '',           // es
      latestEU  ? fmt(latestEU.ep)     : '',           // ep
      latestEU  ? fmt(latestEU.epr)    : '',           // epr
      latestEU  ? latestEU.ed          : '',           // ed
      latestEU  ? String(latestEU.el)  : '',           // el
      latestEU  ? latestEU.ef          : '',           // ef
      asset.eq,                                        // eq
      asset.sei,                                       // sei
      asset.sii,                                       // sii
      asset.smd,                                       // smd
      String(asset.hq),                                // hq
      String(asset.iv),                                // iv
      String(re),                                      // re
      String(rr),                                      // rr
      ds != null ? ds : '',                            // ds
      String(!ambiguousCodes.has(code)),               // complaint_clean
      JSON.stringify(comps),                           // cl
    ]);
  });
  Logger.log('Plant rows: ' + plantRows.length);

  // ONA × Complaints cross-reference breakdown (within the 441 mapped plants)
  var onaOnly   = 0, compOnly441 = 0, both441 = 0, neither441 = 0;
  Object.keys(codeMap).forEach(function(code) {
    var hasONA  = !!(onaDrillsByCode[code] && onaDrillsByCode[code].length > 0);
    var hasComp = !!(complaintsByCode[code] && complaintsByCode[code].length > 0);
    if (hasONA && hasComp)  { both441++; }
    else if (hasONA)        { onaOnly++; }
    else if (hasComp)       { compOnly441++; }
    else                    { neither441++; }
  });
  Logger.log('ONA × Complaints (within 441 mapped plants):');
  Logger.log('  ONA drill only (no complaints):     ' + onaOnly);
  Logger.log('  Complaints only (no ONA drill):     ' + compOnly441);
  Logger.log('  BOTH ONA drill AND complaint:       ' + both441 + '  ← cross-source matched plants');
  Logger.log('  Neither ONA nor complaint data:     ' + neither441);

  // ------------------------------------------------------------------
  // BUILD ona_timeline ROWS  (§5.3)
  // Includes ALL ONA drills — matched plants use their integer code;
  // unmatched plants get a stable synthetic string code ("U0", "U1", …).
  // This allows drill-downs to show every ONA plant, not just 441 matched.
  // ------------------------------------------------------------------

  // Step 1: collect all drills belonging to matched plants (by reference)
  const matchedDrillSet = new Set();
  Object.values(onaDrillsByCode).forEach(function(drills) {
    drills.forEach(function(d) { matchedDrillSet.add(d); });
  });

  // Step 2: write matched-plant drills (existing logic)
  Object.keys(onaDrillsByCode).forEach(function(code) {
    const cm = codeMap[code];
    onaDrillsByCode[code].forEach(function(d) {
      onaTimeline.push([
        code,
        cm ? cm.dd : '',
        cm ? cm.sf : '',
        cm ? (cm.cs != null ? cm.cs : '') : '',
        d.od,
        d.op != null ? Number(d.op).toFixed(2) : '',
        d.os === 'Functional' || d.os === 'Functional Installed' ? 1 : 0,
      ]);
    });
  });

  // Step 3: write unmatched-plant drills with synthetic codes
  // Group unmatched drills by plant identity so all drills for the same
  // plant share one synthetic code → purity trend shows full history.
  const unmatchedSynCodes = {};
  var uIdx = 0;
  onaParsed.forEach(function(d) {
    if (matchedDrillSet.has(d)) return;
    const identKey = d.distNorm + '|' + d.facNorm + '|' + (d.lpm != null ? d.lpm : '');
    if (!unmatchedSynCodes[identKey]) {
      unmatchedSynCodes[identKey] = 'U' + (uIdx++);
    }
    onaTimeline.push([
      unmatchedSynCodes[identKey],
      districtDisplay(d.distNorm),
      d.facNorm,
      d.lpm != null ? d.lpm : '',
      d.od,
      d.op != null ? Number(d.op).toFixed(2) : '',
      d.os === 'Functional' || d.os === 'Functional Installed' ? 1 : 0,
    ]);
  });

  const onaTimelineHeaders = ['code','district','facility','capacity','date','purity','status'];

  // ------------------------------------------------------------------
  // BUILD eu_timeline ROWS — ALL EU drills (matched + unmatched)
  // Matched plants use integer code; unmatched use synthetic "V0","V1",…
  // ------------------------------------------------------------------
  const matchedEUDrillSet = new Set();
  Object.values(euDrillsByCode).forEach(function(drills) {
    drills.forEach(function(d) { matchedEUDrillSet.add(d); });
  });

  // Matched EU drills
  Object.keys(euDrillsByCode).forEach(function(code) {
    const cm = codeMap[code];
    euDrillsByCode[code].forEach(function(d) {
      euTimeline.push([
        code,
        cm ? cm.dd : '',
        cm ? cm.sf : '',
        cm ? (cm.cs != null ? cm.cs : '') : '',
        d.ed,
        d.ep != null ? Number(d.ep).toFixed(2) : '',
        (d.es === 'Functional' || d.es === 'Functional Installed') ? 1 : 0,
      ]);
    });
  });

  // Unmatched EU drills — synthetic codes (V prefix to distinguish from ONA's U prefix)
  const unmatchedEUSynCodes = {};
  var vIdx = 0;
  euParsed.forEach(function(d) {
    if (matchedEUDrillSet.has(d)) return;
    const identKey = d.distNorm + '|' + d.hospNorm + '|' + (d.cap != null ? d.cap : '');
    if (!unmatchedEUSynCodes[identKey]) {
      unmatchedEUSynCodes[identKey] = 'V' + (vIdx++);
    }
    euTimeline.push([
      unmatchedEUSynCodes[identKey],
      districtDisplay(d.distNorm),
      d.hospNorm,
      d.cap != null ? d.cap : '',
      d.ed,
      d.ep != null ? Number(d.ep).toFixed(2) : '',
      (d.es === 'Functional' || d.es === 'Functional Installed') ? 1 : 0,
    ]);
  });

  const euTimelineHeaders = ['code','district','facility','capacity','date','purity','status'];

  // ------------------------------------------------------------------
  // BUILD dist_p1 ROWS  (§5.3)
  // ------------------------------------------------------------------
  const distStats = {};
  Object.keys(codeMap).forEach(function(code) {
    const cm    = codeMap[code];
    const asset = cm.asset;
    const sei   = asset.sei;
    const isNF  = (sei === 'Non Functional Repairable' || sei === 'Non Functional Non Repairable' || sei === 'In Complaint');
    if (!isNF) return;

    const comps       = complaintsByCode[code] || [];
    const hasActiveComp = comps.some(function(c) { return c.st !== 'Resolved'; });
    const dd = cm.dd;

    if (!distStats[dd]) distStats[dd] = { nf_comp: 0, nf_nocomp: 0, total_nf: 0 };
    distStats[dd].total_nf++;
    if (hasActiveComp) distStats[dd].nf_comp++;
    else               distStats[dd].nf_nocomp++;
  });
  const distP1Headers = ['district','nf_with_complaint','nf_without_complaint','total_non_functional'];
  const distP1Rows = Object.keys(distStats).map(function(d) {
    return [d, distStats[d].nf_comp, distStats[d].nf_nocomp, distStats[d].total_nf];
  });

  // ------------------------------------------------------------------
  // WRITE to gs_dashboard_data
  // ------------------------------------------------------------------
  Logger.log('Writing gs_dashboard_data…');
  const dashSS = SpreadsheetApp.openById(CONFIG.dashboard);

  writeTab_(dashSS, 'plants',            plantHeaders,          plantRows);
  writeTab_(dashSS, 'ona_timeline',      onaTimelineHeaders,    onaTimeline);
  writeTab_(dashSS, 'eu_timeline',       euTimelineHeaders,     euTimeline);
  writeTab_(dashSS, 'dist_p1',           distP1Headers,         distP1Rows);
  writeTab_(dashSS, 'ona_all_plants',    onaAllPlantsHeaders,   onaAllPlantsRows);
  writeTab_(dashSS, 'ona_monthly_all',   onaMonthlyHeaders,     onaMonthlyRows);
  writeTab_(dashSS, 'eu_all_plants',      euAllPlantsHeaders,    euAllPlantsRows);
  writeTab_(dashSS, 'eu_monthly_all',     euMonthlyHeaders,      euMonthlyRows);
  writeTab_(dashSS, 'registry_plants',    registryPlantsHeaders, registryPlantsRows);
  writeTab_(dashSS, 'eu_direct_cross',    euDirectCrossHeaders,  euDirectCrossRows);

  const builtAt = new Date().toISOString();
  var cleanComplaintCodes = Object.keys(codeMap).filter(function(c) { return !ambiguousCodes.has(c); }).length;
  writeMeta_(dashSS, {
    built_at:     builtAt,
    coverage_B:   resolvedB + '/' + totalB,
    coverage_D:   matchedDIdents.size + ' identities',
    coverage_E:   matchedE + '/' + totalE,
    plant_count:      plantRows.length,
    ona_drills:       onaTimeline.length,
    ona_all_plants:   onaAllPlantsRows.length,
    eu_drills:        euTimeline.length,
    misses_B:         missesB.length,
    complaint_clean_plants:     cleanComplaintCodes,
    complaint_ambiguous_plants: ambiguousCodes.size,
    mapping_report_codes:       Object.keys(codeRawInfo).length,
  });

  // BUILD mapping_report — one row per mapping code (resolved + unresolved)
  const mappingReportHeaders = [
    'code','ona_district','ona_facility','ona_capacity','ona_manufacturer',
    'sih_district','sih_facility','sih_capacity','sih_manufacturer',
    'match_method','matched_district','matched_hospital','matched_capacity',
    'complaint_clean','ambiguity_reason',
  ];
  const mappingReportRows = Object.keys(codeRawInfo).sort(function(a,b){ return Number(a)-Number(b); }).map(function(code) {
    var info   = codeRawInfo[code];
    var method = codeMatchMethod[code] || 'MISS';
    var cm     = codeMap[code];
    var asset  = cm ? cm.asset : null;
    var clean  = method !== 'MISS' && !ambiguousCodes.has(code);
    var reason = ambiguityReasons[code] || (method === 'MISS' ? 'NO_REGISTRY_MATCH' : '');
    return [
      code,
      info.onaDist,
      info.onaFac,
      info.onaCap,
      info.onaMfr,
      info.sihDist,
      info.sihFac,
      info.sihCap,
      info.sihMfr,
      method,
      asset ? asset.dd : '',
      asset ? asset.sf : '',
      asset && asset.cap != null ? String(asset.cap) : '',
      String(clean),
      reason,
    ];
  });
  writeTab_(dashSS, 'mapping_report', mappingReportHeaders, mappingReportRows);
  Logger.log('Mapping report: ' + mappingReportRows.length + ' codes written');

  const elapsed = ((new Date() - t0) / 1000).toFixed(1);
  Logger.log('=== Derive complete in ' + elapsed + 's  built_at=' + builtAt + ' ===');
  return builtAt;
}


// =====================================================================
// SHEET WRITER HELPERS
// =====================================================================

function writeTab_(ss, tabName, headers, rows) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  } else {
    sheet.clearContents();
    sheet.clearFormats(); // remove any stale date/number formats from previous runs
  }

  const data = [headers].concat(rows);
  if (data.length > 1) {
    var range = sheet.getRange(1, 1, data.length, headers.length);
    // Force plain-text format BEFORE writing.
    // Without this, Sheets auto-detects strings like '2026-04-17' as dates,
    // converts them to date values, and the Sheets API returns them in locale
    // format ('4/17/2026') instead of ISO — breaking every date in the dashboard.
    range.setNumberFormat('@');
    range.setValues(data);
  }
  Logger.log('  Wrote ' + rows.length + ' rows → ' + tabName);
}

function writeMeta_(ss, kvs) {
  var sheet = ss.getSheetByName('meta');
  if (!sheet) sheet = ss.insertSheet('meta');
  else sheet.clearContents();
  const rows = Object.keys(kvs).map(function(k) { return [k, kvs[k]]; });
  if (rows.length) sheet.getRange(1, 1, rows.length, 2).setValues(rows);
}


// =====================================================================
// §6A  WEB APP — on-demand rebuild endpoint
// Usage: GET <webAppUrl>   (no token required — URL is the secret)
// =====================================================================

function doGet(e) {
  try {
    // ── Upload via GET (base64-encoded data in query param) ────────
    // Used by data-uploader.html — GET avoids all CORS issues
    if (e && e.parameter && e.parameter.action === 'upload') {
      var dataset  = e.parameter.dataset;
      var chunkIdx = parseInt(e.parameter.chunk || '0', 10);
      var dataB64  = e.parameter.data;
      // Decode base64 → UTF-8 string → JSON array
      var decoded  = Utilities.newBlob(Utilities.base64Decode(dataB64)).getDataAsString('UTF-8');
      var data     = JSON.parse(decoded);
      return handleUpload_({ action:'upload', dataset:dataset, data:data, chunk:chunkIdx });
    }

    // ── Default: run derive ────────────────────────────────────────
    const built_at = deriveDashboard();
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', built_at: built_at }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    // ── Upload action: replace data on a source sheet ──────────────
    if (payload.action === 'upload') {
      return handleUpload_(payload);
    }

    // ── Default: run derive (same as GET) ─────────────────────────
    var built_at = deriveDashboard();
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', built_at: built_at }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Upload handler ─────────────────────────────────────────────────
// Configs for the 4 uploadable source sheets
var UPLOAD_SHEET_CONFIG_ = {
  ona: {
    spreadsheetId: '1VKJL8bqEpiqnMuNsq91sJ4AGzN34xfurabouXS-IpHs',
    tabName:       'data',
    bannerRows:    0,
  },
  eupkaran: {
    spreadsheetId: '1_q3eXx0ezZ4L0SybAxlMWuWaSdUlUomDjVf0rBoNX84',
    tabName:       'sheet1',
    bannerRows:    3,
  },
  complaints: {
    spreadsheetId: '1jwzifzH5t7lnl9bp_9A64D9E3RvVhuLBa8lmrpwrjHg',
    tabName:       'Complaints',
    bannerRows:    0,
  },
  registry: {
    spreadsheetId: '1fnUdcqFIq0xn7zB2YowV0L5ggU6kZ3A0d8d1CTq97CU',
    tabName:       'sheet1',
    bannerRows:    3,
  },
};

function handleUpload_(payload) {
  var dataset = payload.dataset;
  var data    = payload.data;   // array of arrays (header row + data rows)

  var cfg = UPLOAD_SHEET_CONFIG_[dataset];
  if (!cfg) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unknown dataset: ' + dataset }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!data || data.length < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'No data provided' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss    = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sheet = ss.getSheetByName(cfg.tabName);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Tab not found: ' + cfg.tabName }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var chunkIdx = payload.chunk || 0;  // 0 = first chunk (clear entire sheet + write), >0 = append
  var numCols  = data[0].length;

  if (chunkIdx === 0) {
    // First chunk: clear the ENTIRE sheet from row 1 (including banner/metadata rows)
    // so print-date and report-title rows from the new file are written too.
    var lastRow = sheet.getLastRow();
    var lastCol = Math.max(sheet.getLastColumn(), numCols);
    if (lastRow >= 1) {
      sheet.getRange(1, 1, lastRow, lastCol).clearContent();
      sheet.getRange(1, 1, lastRow, lastCol).clearFormats();
    }
    var range = sheet.getRange(1, 1, data.length, numCols);
    range.setNumberFormat('@');
    range.setValues(data);
  } else {
    // Subsequent chunks: append after whatever was already written
    var appendRow = sheet.getLastRow() + 1;
    var range2 = sheet.getRange(appendRow, 1, data.length, numCols);
    range2.setNumberFormat('@');
    range2.setValues(data);
  }

  Logger.log('Upload: wrote ' + data.length + ' rows to ' + cfg.tabName + ' in ' + dataset);
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', rows: data.length, tab: cfg.tabName }))
    .setMimeType(ContentService.MimeType.JSON);
}


// =====================================================================
// TRIGGERS  — run installTriggers() once from the Apps Script editor
// =====================================================================

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // Rebuild every 30 minutes (adjust as needed)
  ScriptApp.newTrigger('deriveDashboard')
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log('Time-driven trigger installed (every 30 min).');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('All triggers removed.');
}


// =====================================================================
// MANUAL TEST ENTRY POINT — run this from the editor to test the derive
// =====================================================================
function runDerive() {
  deriveDashboard();
}


// =====================================================================
// CONFLICT REPORT — run this to identify QR conflicts and ambiguous
// mappings so you know exactly what to fix in the mapping Excel.
// =====================================================================
function runConflictReport() {
  Logger.log('=== CONFLICT REPORT ===');

  // ── Read registry ──────────────────────────────────────────────────
  const regRows = readSheetAsObjects(CONFIG.registry, CONFIG.tabs.registry, 3);
  const byQR_ = {}, byDHC_ = {}, byDH_ = {};
  regRows.forEach(function(r) {
    const dist = normDist(r['District Name'] || '');
    const hosp = normName(r['Hospital Name'] || '');
    const cap  = parseCap(r['Capacity of PSA Plant (in LPM)'] || '');
    const qr   = qrSuffix(r['QR Code'] || '');
    const asset = { dd: districtDisplay(r['District Name']||''), sf: String(r['Hospital Name']||'').trim(), cap, supplier: normMfr(r['Supplier']||''), eq: qr };
    const dhcKey = dist+'|'+hosp+'|'+cap;
    if (!byDHC_[dhcKey]) byDHC_[dhcKey] = []; byDHC_[dhcKey].push(asset);
    if (!byDH_[dist+'|'+hosp]) byDH_[dist+'|'+hosp] = []; byDH_[dist+'|'+hosp].push(asset);
    if (qr) { if (!byQR_[qr]) byQR_[qr] = asset; }
  });

  // ── Read mapping ───────────────────────────────────────────────────
  const mapRows = readSheetAsObjects(CONFIG.mapping, CONFIG.tabs.mapping, 0);
  const codeToQR = {};  // code → QR suffix it resolved to
  const codeToInfo = {}; // code → {onaFac, onaDist, sihHosp, sihDist, sihCap}

  mapRows.forEach(function(m) {
    const code = m['Code'] != null ? m['Code'] : m['_col1'];
    if (!code) return;
    const onaFac     = String(m['ONA Health Facility'] || m['_col4'] || '').trim();
    const onaDist    = String(m['ONA District']        || m['_col3'] || '').trim();
    const sihDistRaw = String(m['SIH District']        || m['_col7'] || '').trim();
    const sihHospRaw = String(m['SIH Health Facility'] || m['_col8'] || '').trim();
    const sihCapRaw  = m['SIH Capacity'] != null ? m['SIH Capacity'] : m['_col9'];
    const sihQRRaw   = String(m['SIH QR Code']         || m['_col11'] || '').trim();

    const sihDist = normDist(sihDistRaw);
    const sihHosp = normName(sihHospRaw);
    const sihCap  = parseCap(sihCapRaw);
    const sihMfr  = normMfr(String(m['SIH Manufacturer'] || m['_col10'] || ''));
    const sihQR   = qrSuffix(sihQRRaw);

    codeToInfo[code] = { onaFac, onaDist, sihHosp: sihHospRaw, sihDist: sihDistRaw, sihCap: sihCapRaw||'?', sihQR: sihQRRaw||'' };

    // Resolve asset (same logic as Step B)
    var asset = null;
    if (sihQR && byQR_[sihQR]) { asset = byQR_[sihQR]; }
    if (!asset) {
      var bucket = byDHC_[sihDist+'|'+sihHosp+'|'+sihCap];
      if (bucket && bucket.length) {
        if (bucket.length === 1) { asset = bucket[0]; }
        else {
          var ex = bucket.filter(function(a){ return a.supplier === sihMfr; });
          asset = ex.length ? ex[0] : bucket[0];
        }
      }
    }
    if (!asset) {
      var dh = byDH_[sihDist+'|'+sihHosp];
      if (dh && dh.length) asset = dh[0];
    }
    if (asset) codeToQR[code] = asset.eq || '(no QR)';
  });

  // ── Find QR conflicts (multiple codes → same QR) ───────────────────
  const qrToConflictCodes = {};
  Object.keys(codeToQR).forEach(function(code) {
    const qr = codeToQR[code];
    if (!qr || qr === '(no QR)') return;
    if (!qrToConflictCodes[qr]) qrToConflictCodes[qr] = [];
    qrToConflictCodes[qr].push(code);
  });

  var conflictCount = 0;
  Object.keys(qrToConflictCodes).forEach(function(qr) {
    const codes = qrToConflictCodes[qr];
    if (codes.length < 2) return;
    conflictCount++;
    const asset = byQR_[qr] || {};
    Logger.log('─────────────────────────────────────────');
    Logger.log('CONFLICT QR: ' + qr + '  →  ' + (asset.dd||'?') + ' / ' + (asset.sf||'?') + '  ('+asset.cap+' LPM)');
    codes.forEach(function(code) {
      const info = codeToInfo[code] || {};
      Logger.log('  Code ' + code + ': ONA facility = "' + info.onaFac + '" (' + info.onaDist + ')');
      Logger.log('          SIH entry  = "' + info.sihHosp + '" (' + info.sihDist + ') ' + info.sihCap + ' LPM');
      Logger.log('          SIH QR col = "' + (info.sihQR||'(empty — add QR here)') + '"');
    });
    Logger.log('  FIX: In the mapping Excel, add the correct QR code in column "SIH QR Code" for each code above.');
    Logger.log('       OR delete duplicate rows if multiple codes refer to the same physical plant.');
  });

  // ── Ambiguous DHC buckets (same hospital+capacity → multiple plants) ──
  Logger.log('=== AMBIGUOUS DHC BUCKETS (registry has multiple plants at same location+capacity) ===');
  var ambigCount = 0;
  Object.keys(byDHC_).forEach(function(key) {
    var bucket = byDHC_[key];
    if (bucket.length < 2) return;
    ambigCount++;
    var parts = key.split('|');
    Logger.log('  ' + bucket[0].dd + ' / ' + bucket[0].sf + '  cap=' + parts[2] + '  (' + bucket.length + ' plants, QRs: ' + bucket.map(function(a){return a.eq||'?';}).join(', ') + ')');
  });

  Logger.log('=== SUMMARY ===');
  Logger.log('QR conflicts: ' + conflictCount + '  (codes mapped to same physical plant)');
  Logger.log('Ambiguous DHC buckets: ' + ambigCount + '  (registry entries sharing location+capacity)');
  Logger.log('=== END REPORT ===');
}
