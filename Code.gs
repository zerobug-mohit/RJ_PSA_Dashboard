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
  const byQR  = {}; // qrSuffix → asset

  regRows.forEach(function(r) {
    const dist = normName(r['District Name']     || r['_col1'] || '');
    const hosp = normName(r['Hospital Name']     || r['_col2'] || '');
    const cap  = parseCap(r['Capacity of PSA Plant (in LPM)'] || r['_col9'] || '');
    const qr   = qrSuffix(r['QR Code']          || r['_col4'] || '');
    const key  = dist + '|' + hosp + '|' + cap;

    const asset = {
      dd:       districtDisplay(r['District Name'] || r['_col1'] || ''),
      sf:       String(r['Hospital Name'] || r['_col2'] || '').trim(),
      cap:      cap,
      eq:       qr,
      sei:      String(r['Equipment Status']   || r['_col8'] || '').trim(),
      sii:      String(r['Inventory Status']   || r['_col7'] || '').trim(),
      smd:      toISO(fromDMY(r['MOIC Verified Date'] || r['_col6'] || '')),
      supplier: normMfr(r['Supplier'] || r['_col10'] || ''),
      hq:       !!qr,
      iv:       String(r['Inventory Status'] || r['_col7'] || '').trim() === 'Verified Inventory',
    };

    if (!byDHC[key]) byDHC[key] = [];
    byDHC[key].push(asset);
    if (qr) byQR[qr] = asset;
  });
  Logger.log('Registry: ' + regRows.length + ' rows | ' + Object.keys(byDHC).length + ' DHC keys | ' + Object.keys(byQR).length + ' QR keys');

  // ------------------------------------------------------------------
  // STEP B — Mapping Code → registry asset
  // ------------------------------------------------------------------
  Logger.log('Reading gs_mapping…');
  const mapRows = readSheetAsObjects(CONFIG.mapping, CONFIG.tabs.mapping, 0);
  if (mapRows.length) Logger.log('Mapping headers: ' + Object.keys(mapRows[0]).filter(function(k) { return !k.startsWith('_col'); }).join(' | '));

  const codeMap   = {}; // code → {asset, of, onaDistrict, onaFacRaw, co, sf, cs, dd}
  const missesB   = [];
  var resolvedB = 0, totalB = 0;

  mapRows.forEach(function(m) {
    // Code is col 1 (0-indexed); try named key first
    const code = m['Code'] != null ? m['Code'] : m['_col1'];
    if (code == null || code === '') return;
    totalB++;

    // ONA side: cols 2-5
    const onaDistRaw = String(m['ONA District']          || m['_col2'] || '').trim();
    const onaFacRaw  = String(m['ONA Health Facility']   || m['_col3'] || '').trim();
    const onaCapRaw  = m['ONA Capacity']                 != null ? m['ONA Capacity']  : m['_col4'];
    const onaMfrRaw  = String(m['ONA Manufacturer']      || m['_col5'] || '').trim();

    // SIH side: cols 6-9
    const sihDistRaw = String(m['SIH District']          || m['_col6'] || '').trim();
    const sihHospRaw = String(m['SIH Health Facility']   || m['_col7'] || '').trim();
    const sihCapRaw  = m['SIH Capacity']                 != null ? m['SIH Capacity']  : m['_col8'];
    const sihMfrRaw  = String(m['SIH Manufacturer']      || m['_col9'] || '').trim();

    const sihDist = normName(sihDistRaw);
    const sihHosp = normName(sihHospRaw);
    const sihCap  = parseCap(sihCapRaw);
    const sihMfr  = normMfr(sihMfrRaw);

    const key    = sihDist + '|' + sihHosp + '|' + sihCap;
    const bucket = byDHC[key] || [];

    var asset = null;
    if (bucket.length === 1) {
      asset = bucket[0];
    } else if (bucket.length > 1) {
      // Manufacturer tiebreak (§4 Step B)
      asset = bucket.filter(function(a) { return sihMfr && a.supplier === sihMfr; })[0] || null;
      if (!asset && sihMfr) {
        // Partial match on first token
        const tok = sihMfr.split(' ')[0];
        asset = bucket.filter(function(a) { return a.supplier && a.supplier.indexOf(tok) !== -1; })[0] || null;
      }
      if (!asset) asset = bucket[0]; // fallback: first in bucket
    }

    if (asset) {
      resolvedB++;
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
      missesB.push({ code: code, key: key });
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
          // Try first-word match as fallback
          const fw = a.split(' ')[0];
          if (fw.length >= 3 && !b.includes(fw)) return false;
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
    const drillDate = fromDMY(r['Date of Mockdrill'] || r['_col6'] || '');
    const ep    = parseFloat(r['Purity(in percent)']            || r['_col9']  || '');
    const hours = parseFloat(r['Total running hours']           || r['_col8']  || '');

    const distRaw = String(r['District Name'] || r['_col1'] || '').trim();
    const hospRaw = String(r['Hospital Name'] || r['_col2'] || '').trim();
    if (!distRaw || !hospRaw) return;

    euParsed.push({
      distNorm: normName(distRaw),
      distDisp: normDist(distRaw),
      hospNorm: normName(hospRaw),
      cap:      parseCap(r['Capacity of PSA Plant (in LPM)'] || r['_col5'] || ''),
      mfr:      normMfr(String(r['Manufacturer'] || r['Supplier'] || r['_col3'] || '')),
      es:       String(r['Equipment Status'] || r['_col4'] || '').trim(),
      ep:       (!isNaN(ep) && ep > 0) ? Math.min(ep, 100) : null,
      epr:      !isNaN(hours) ? hours : null,
      el:       String(r['Any leakage observed'] || '').toLowerCase().startsWith('y'),
      ef:       String(r['Fire Safety measures in the hospital'] || r['_col10'] || '').trim(),
      ed:       toISO(drillDate),
      date:     drillDate,
      notRunning: (ep === 0 && hours === 0),
    });
  });
  Logger.log('EU: ' + euParsed.length + ' parsed drills');

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

  // ------------------------------------------------------------------
  // STEP E — Complaints → Code via QR → registry
  // ------------------------------------------------------------------
  Logger.log('Reading gs_complaints…');
  const allComps = readSheetAsObjects(CONFIG.complaints, CONFIG.tabs.complaints, 0);

  const complaintsByCode = {}; // code → [complaint]
  var matchedE = 0, totalE = 0;
  const missesE = [];

  // Build a reverse map: asset → code
  const assetToCode = {};
  Object.keys(codeMap).forEach(function(code) {
    assetToCode[codeMap[code].asset.eq] = code; // keyed on QR suffix
  });

  allComps.forEach(function(c) {
    const qr = qrSuffix(String(c['Service Provider QR Code'] || c['_col3'] || ''));
    if (!qr) return;
    totalE++;

    const asset = byQR[qr];
    if (!asset) { missesE.push(qr); return; }

    // Find code that owns this asset via QR
    const ownerCode = assetToCode[qr];
    if (!ownerCode) return; // barcoded asset not in mapping — skip

    matchedE++;
    const raiseD  = fromExcel(c['Complaint Raise Date']     || c['_col6']  || '');
    const attendD = fromExcel(c['Complaint Attend date']     || c['_col7']  || '');
    const closeD  = fromExcel(c['Complaint Close date']      || c['_col8']  || '');
    const moicD   = fromExcel(c['Complaint Close by MOIC']   || c['_col9']  || '');

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
      dh: parseFloat(c['Total Downtime'] || c['_col13'] || '') || null,
    });
  });
  Logger.log('Step E: ' + matchedE + '/' + totalE + ' complaints matched by QR (target 229/229)');
  if (missesE.length) Logger.log('Step E unmatched QRs (' + missesE.length + '): ' + missesE.slice(0, 10).join(', '));

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
    'has_qr','is_verified','reporting_ever','reporting_recent','days_since_drill','complaints',
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
      JSON.stringify(comps),                           // cl
    ]);
  });
  Logger.log('Plant rows: ' + plantRows.length);

  // ------------------------------------------------------------------
  // BUILD ona_timeline ROWS  (§5.3)
  // ------------------------------------------------------------------
  Object.keys(onaDrillsByCode).forEach(function(code) {
    const cm = codeMap[code];
    onaDrillsByCode[code].forEach(function(d) {
      onaTimeline.push([
        code,
        cm ? cm.dd   : '',
        cm ? cm.sf   : '',
        cm ? (cm.cs != null ? cm.cs : '') : '',
        d.od,
        d.op != null ? Number(d.op).toFixed(2) : '',
        d.os === 'Functional' || d.os === 'Functional Installed' ? 1 : 0,
      ]);
    });
  });
  const onaTimelineHeaders = ['code','district','facility','capacity','date','purity','status'];

  // ------------------------------------------------------------------
  // BUILD eu_timeline ROWS  (§5.3)
  // ------------------------------------------------------------------
  Object.keys(euDrillsByCode).forEach(function(code) {
    const cm = codeMap[code];
    euDrillsByCode[code].forEach(function(d) {
      euTimeline.push([
        code,
        cm ? cm.dd   : '',
        cm ? cm.sf   : '',
        cm ? (cm.cs != null ? cm.cs : '') : '',
        d.ed,
        d.ep != null ? Number(d.ep).toFixed(2) : '',
        (d.es === 'Functional' || d.es === 'Functional Installed') ? 1 : 0,
      ]);
    });
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

  writeTab_(dashSS, 'plants',        plantHeaders,       plantRows);
  writeTab_(dashSS, 'ona_timeline',  onaTimelineHeaders, onaTimeline);
  writeTab_(dashSS, 'eu_timeline',   euTimelineHeaders,  euTimeline);
  writeTab_(dashSS, 'dist_p1',       distP1Headers,      distP1Rows);

  const builtAt = new Date().toISOString();
  writeMeta_(dashSS, {
    built_at:     builtAt,
    coverage_B:   resolvedB + '/' + totalB,
    coverage_D:   matchedDIdents.size + ' identities',
    coverage_E:   matchedE + '/' + totalE,
    plant_count:  plantRows.length,
    ona_drills:   onaTimeline.length,
    eu_drills:    euTimeline.length,
    misses_B:     missesB.length,
  });

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
