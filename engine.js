/* 월마감 입고 대사 엔진 — 브라우저/Node 공용. XLSX(SheetJS) 객체를 인자로 받음 */
(function (root) {
'use strict';

const DEFAULT_MASTER = {
  models: [
    // id, 표시명, 업체 명세서 표기, ERP 대표부품, 대당수량, 담당자 표기
    { id: 'Z45OSC', name: 'Z45 OSC DRIVE', vendor: 'Z45OSC DRIVE', key: '120027', per: 1, staff: 'Z45 OSC, Z45OSC' },
    { id: 'Z45DC', name: 'Z45 DC DRIVE', vendor: 'Z45DC DRIVE', key: '120030', per: 1, staff: 'Z45 DC, Z45DC' },
    { id: 'Z40', name: 'Z40 DC DRIVE', vendor: 'Z40DC DRIVE, Z40 DRIVE', key: '110550', per: 1, staff: 'Z40' },
    { id: 'S45XC', name: 'S45XC DRIVE', vendor: 'S45XC DRIVE', key: '1278974', per: 1, staff: 'S45XC, 1290073' },
    { id: 'S85XC', name: 'S85XC DRIVE', vendor: 'S85XC DRIVE', key: '121082', per: 1, staff: 'S85XC, 1268562' },
    { id: 'Z80DC', name: 'Z80 DRIVE', vendor: 'Z80 DRIVE', key: '237270', per: 1, staff: 'Z80 DC, 237329' },
    { id: 'Z80SA', name: 'Z80 AXLE STEER', vendor: '1268567, Z80 AXLE STEER', key: '121246', per: 1, staff: 'Z80 SA, 230980' },
    { id: 'Z80RA', name: 'Z80 AXLE REAR', vendor: '1268572, Z80 AXLE REAR', key: '121256', per: 1, staff: 'Z80 RA, 230989' },
    { id: 'GS4655DC', name: 'GS4655 DC', vendor: '1292085, GS4655 DC', key: '1292303', per: 1, staff: 'GS4655 DC, 1292085' },
    { id: 'HX63AH', name: 'HX63AH (ST/RT)', vendor: 'HX63AH, HX63AH(옵션)', key: '110408-00473B-1', per: 1, staff: 'HX63AH, HD' },
    { id: 'HX55ACR', name: 'HX55ACR', vendor: 'HX55ACR', key: '51MP-01252', per: 1, staff: 'HX55ACR, HD' },
    { id: 'R55', name: 'R55C', vendor: 'R55, R55C', key: '51M8-02031', per: 1, staff: 'R55, R55C, HD' },
    { id: '60CR', name: '60CR', vendor: '60CR', key: '', per: 1, staff: '60CR' },
    { id: '60MT', name: '60MT', vendor: '60MT', key: '', per: 1, staff: '60MT' }
  ],
  partAlias: [ { vendor: '132174', erp: 'CW01' } ],
  partGroups: [
    { name: 'CWT (GS1930E)', parts: 'CW01' },
    { name: 'GS1930E 단품', parts: '1301223, 1301224, 1299618, 1304856' },
    { name: 'GS4655 MD 롤러', parts: '1295865, 1295866' },
    { name: 'MX (B7) 단품', parts: '71136, 71137, 104285, 71107, 71109, 71133, 71192, 71194, 79238, 87698, 112105, T108148, 131613, 236374, 1254464, 50776, 107805, 131605, 120067, 120101, 120110, 824736, 42669, 74825, 42152, 56839, 36967, 36968, 36222, 36247, 36307, 36665' }
  ],
  settings: { dayWindow: 7, excludeSheetKw: '윤성, BS산업, 아도, 동서' }
};

const norm = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
const splitList = s => String(s || '').split(',').map(x => norm(x)).filter(Boolean);
const isPO = v => typeof v === 'string' && /^PO\d{8}$/.test(v.trim());
const r0 = n => Math.round(Number(n) || 0);

function toDateStr(v, XLSX) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}
const dayDiff = (a, b) => (a && b) ? Math.round((Date.parse(a) - Date.parse(b)) / 86400000) : null;

function sheetGrid(ws, XLSX) {
  if (!ws || !ws['!ref']) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

/* ---------- ERP 입고상세조회 ---------- */
function parseERP(wb, XLSX) {
  for (const sn of wb.SheetNames) {
    const g = sheetGrid(wb.Sheets[sn], XLSX);
    const hr = g.findIndex(r => r && r.some(c => norm(c) === 'P/ONO') && r.some(c => norm(c) === '입고번호'));
    if (hr < 0) continue;
    const H = g[hr].map(norm);
    const col = (...names) => { for (const n of names) { const i = H.indexOf(norm(n)); if (i >= 0) return i; } return -1; };
    const c = {
      part: col('품목'), pname: col('품목명'), spec: col('품목규격'), date: col('입고일'), qty: col('입고수량'),
      amt: col('입고금액(자국)', '입고금액'), po: col('P/O No'), grp: col('품목그룹명'), vendor: col('거래처명'),
      price: col('입고단가(자국)', '입고단가'), gr: col('입고번호'), unit: col('구매단위', '재고단위')
    };
    const lines = [];
    for (let i = hr + 1; i < g.length; i++) {
      const r = g[i]; if (!r) continue;
      const po = r[c.po]; if (!isPO(po)) continue;
      lines.push({
        po: po.trim(), part: String(r[c.part] ?? '').trim(), pname: r[c.pname], spec: r[c.spec], date: toDateStr(r[c.date], XLSX),
        qty: Number(r[c.qty]) || 0, amt: r0(r[c.amt]), grp: r[c.grp], unit: c.unit >= 0 ? String(r[c.unit] ?? '').trim() : '', vendor: r[c.vendor], price: Number(r[c.price]) || 0,
        gr: r[c.gr]
      });
    }
    return { sheet: sn, lines };
  }
  return null;
}

/* ---------- 업체 거래명세서 ---------- */
function findHeader(g, maxScan = 15) {
  for (let i = 0; i < Math.min(g.length, maxScan); i++) {
    const a = (g[i] || []).map(norm), b = (g[i + 1] || []).map(norm);
    const has = t => a.some(x => x.includes(t)) || b.some(x => x.includes(t));
    if (a.some(x => x === '날짜') && has('금액')) return i;
  }
  return -1;
}
function parseVendorSheet(g, XLSX) {
  const hr = findHeader(g); if (hr < 0) return null;
  const a = (g[hr] || []).map(norm), b = (g[hr + 1] || []).map(norm);
  const w = Math.max(a.length, b.length);
  const H = []; for (let j = 0; j < w; j++) H[j] = (a[j] || '') + '|' + (b[j] || '');
  const first = pred => H.findIndex(pred);
  const c = {
    date: first(h => h.split('|').includes('날짜')),
    code: first(h => h.includes('품번')), model: first(h => h.split('|').includes('모델')),
    price: first(h => h.includes('단가')),
    qty: first(h => h.split('|').includes('수량')),
    wt: first(h => h.includes('(티시)중량')),
    amt: first(h => h.includes('금액')),
    kind: first(h => h.split('|').includes('구분')),
    note: first(h => h.split('|').includes('비고'))
  };
  if (c.code < 0) c.code = c.model;
  if (c.qty < 0) c.qty = c.wt;
  if (c.code < 0 || c.amt < 0) return null;
  const rows = [];
  for (let i = hr + 1; i < g.length; i++) {
    const r = g[i]; if (!r) continue;
    const code = r[c.code]; const qty = Number(r[c.qty]) || 0;
    if (code == null || code === '' || !qty) continue;
    const kind = c.kind >= 0 ? r[c.kind] : '';
    if (norm(kind).includes('합계')) continue;
    const rawDate = r[c.date];
    rows.push({
      row: i + 1, kind: kind == null ? '' : String(kind), code: String(code).trim(), rawDate,
      date: toDateStr(rawDate, XLSX), price: Number(r[c.price]) || 0, qty, amt: r0(r[c.amt]),
      amtBlank: r[c.amt] == null || r[c.amt] === '', note: c.note >= 0 && r[c.note] != null ? String(r[c.note]) : ''
    });
  }
  return { rows, cols: c, header: hr };
}
function parseVendor(wb, XLSX) {
  const out = { index: [], sheets: [] };
  // INDEX 시트 (대림INDEX)
  for (const sn of wb.SheetNames) {
    if (!norm(sn).includes('INDEX') || norm(sn).includes('비정규')) continue;
    const g = sheetGrid(wb.Sheets[sn], XLSX);
    const title = (g[1] || []).filter(Boolean).join(' ');
    const items = [];
    for (let i = 0; i < Math.min(g.length, 14); i++) {
      const r = g[i] || [];
      for (let j = 0; j < r.length; j++) {
        if (typeof r[j] === 'string' && r[j].trim() && typeof r[j + 2] === 'number' && typeof r[j + 1] === 'number')
          items.push({ label: r[j].trim().replace(/\s+/g, ' '), amt: r0(r[j + 2]) });
      }
    }
    out.index.push({ sheet: sn, title, items });
  }
  for (const sn of wb.SheetNames) {
    const g = sheetGrid(wb.Sheets[sn], XLSX);
    const p = parseVendorSheet(g, XLSX); if (!p || !p.rows.length) continue;
    const title = String((g[0] || []).find(x => x != null && x !== '') || '');
    const sum = p.rows.reduce((s, r) => s + r.amt, 0);
    out.sheets.push({ sheet: sn, title, sum, rows: p.rows });
  }
  return out;
}
function autoSelectVendorSheets(v, monthNum) {
  const idxAmts = new Set(); v.index.forEach(ix => ix.items.forEach(it => idxAmts.add(it.amt)));
  const sel = v.sheets.filter(s => s.sum > 0 && idxAmts.has(s.sum)).map(s => s.sheet);
  if (sel.length) return sel;
  return v.sheets.filter(s => s.sum > 0 && new RegExp('(^|\\D)' + monthNum + '\\s*월|\\s' + monthNum + '\\s').test(s.title)).map(s => s.sheet);
}

/* ---------- 담당자 파일 (PO가 적힌 모든 시트 자동 인식) ---------- */
function parseStaffWorkbook(wb, XLSX, fileLabel, excludeKw) {
  const entries = [], skippedSheets = [];
  for (const sn of wb.SheetNames) {
    if (excludeKw.some(k => k && norm(sn).includes(k))) { skippedSheets.push(sn); continue; }
    const g = sheetGrid(wb.Sheets[sn], XLSX);
    const poCells = [];
    g.forEach((r, i) => (r || []).forEach((v, j) => { if (isPO(v)) poCells.push([i, j]); }));
    if (!poCells.length) continue;
    const cnt = {}; poCells.forEach(([, j]) => cnt[j] = (cnt[j] || 0) + 1);
    const poCol = +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const firstRow = Math.min(...poCells.filter(p => p[1] === poCol).map(p => p[0]));
    const H = [];
    for (let i = Math.max(0, firstRow - 6); i < firstRow; i++) (g[i] || []).forEach((v, j) => { if (typeof v === 'string') H[j] = (H[j] || '') + '|' + norm(v); });
    const nearest = (pred) => {
      let best = -1, bd = 1e9;
      H.forEach((h, j) => { if (h && pred(h) && j !== poCol) { const d = Math.abs(j - poCol); if (d < bd) { bd = d; best = j; } } });
      return best;
    };
    const c = {
      amt: nearest(h => h.includes('금액') && !h.includes('ERP') && !h.includes('매입') && !h.includes('차액')),
      date: nearest(h => /날짜|입고일/.test(h)),
      qty: nearest(h => /대수|입고수량|\|수량/.test(h) && !h.includes('대당')),
      model: nearest(h => h.includes('모델'))
    };
    for (const [i, j] of poCells) {
      if (j !== poCol) continue;
      const r = g[i];
      entries.push({
        file: fileLabel, sheet: sn, row: i + 1, po: r[j].trim(),
        amt: c.amt >= 0 ? r0(r[c.amt]) : null, date: c.date >= 0 ? toDateStr(r[c.date], XLSX) : null,
        qty: c.qty >= 0 && typeof r[c.qty] === 'number' ? r[c.qty] : null,
        model: c.model >= 0 && r[c.model] && !String(r[c.model]).startsWith('#') ? String(r[c.model]) : sn
      });
    }
  }
  return { entries, skippedSheets };
}

/* ---------- 대조 ---------- */
function reconcile(input, master) {
  const set = master.settings || {}; const W = Number(set.dayWindow) || 7;
  const hasVendor = (input.vendorSheets || []).length > 0, hasStaff = (input.staff || []).length > 0;
  const models = master.models.map(m => ({ ...m, vset: splitList(m.vendor), sset: splitList(m.staff), nkey: norm(m.key) }));
  const partAlias = {}; (master.partAlias || []).forEach(p => { if (p.vendor) partAlias[norm(p.vendor)] = norm(p.erp); });
  const pg = {}; (master.partGroups || []).forEach(g => splitList(g.parts).forEach(pt => { pg[pt] = g.name; }));
  const groupOf = code => pg[norm(code)] || '기타 단품';

  // ERP → PO
  const erp = input.erp.lines;
  const mcount = {}; erp.forEach(l => { const m = (l.date || '').slice(0, 7); mcount[m] = (mcount[m] || 0) + 1; });
  const month = Object.keys(mcount).sort((a, b) => mcount[b] - mcount[a])[0] || '';
  const poPrefix = 'PO' + month.slice(2, 4) + month.slice(5, 7);
  const POs = new Map();
  erp.forEach(l => {
    let p = POs.get(l.po);
    if (!p) { p = { po: l.po, lines: [], amt: 0, dates: new Set(), grps: new Set() }; POs.set(l.po, p); }
    p.lines.push(l); p.amt += l.amt; if (l.date) p.dates.add(l.date); if (l.grp) p.grps.add(String(l.grp).trim());
  });
  const units = []; // ERP 대조 단위
  for (const p of POs.values()) {
    p.date = [...p.dates].sort()[0] || null;
    let mdl = null, keyQty = 0;
    for (const m of models) { if (!m.nkey) continue; const ln = p.lines.filter(l => norm(l.part) === m.nkey); if (ln.length) { mdl = m; keyQty = ln.reduce((s, l) => s + l.qty, 0); break; } }
    p.model = mdl; p.units = [];
    if (mdl) {
      p.qty = keyQty / (Number(mdl.per) || 1); p.modelName = mdl.name; p.unit = '대';
      const u = { kind: 'erp', fam: 'M:' + mdl.id, po: p.po, date: p.date, amt: p.amt, qty: p.qty, label: mdl.name, ref: p };
      units.push(u); p.units.push(u);
    } else {
      p.groupName = [...new Set(p.lines.map(l => groupOf(l.part)))].join(' + ');
      const uSet = [...new Set(p.lines.map(l => l.unit || 'EA'))];
      p.unit = uSet.length === 1 ? uSet[0] : '';
      p.qty = p.unit ? p.lines.reduce((s, l) => s + l.qty, 0) : null;
      p.modelName = p.groupName + ' — ' + [...new Set(p.lines.map(l => l.part))].join(', ');
      // 품번별 단위
      const byPart = new Map();
      p.lines.forEach(l => { const k = norm(l.part); const x = byPart.get(k) || { amt: 0, qty: 0, date: l.date, part: l.part }; x.amt += l.amt; x.qty += l.qty; byPart.set(k, x); });
      for (const [k, x] of byPart) { const u = { kind: 'erp', fam: 'P:' + k, po: p.po, date: x.date, amt: x.amt, qty: x.qty, label: x.part, ref: p }; units.push(u); p.units.push(u); }
    }
    p.vendorMatches = []; p.staff = [];
  }

  // 업체 행
  const vRows = [], vExcluded = [], vChecks = [];
  for (const s of input.vendorSheets) {
    for (const r of s.rows) {
      const code = norm(r.code);
      let fam, label;
      const m = models.find(m => m.vset.includes(code));
      if (m) { fam = 'M:' + m.id; label = m.name; }
      else { fam = 'P:' + (partAlias[code] || code); label = r.code; }
      const v = { kind: 'vendor', sheet: s.sheet, row: r.row, fam, label, code: r.code, vkind: r.kind, date: r.date, rawDate: r.rawDate, price: r.price, qty: r.qty, amt: r.amt, note: r.note };
      if (r.amtBlank || !r.amt) { vExcluded.push({ ...v, why: (r.note || '금액 없음') + ' → 대조 제외' }); continue; }
      if (r.price && r.qty && Math.abs(r.price * r.qty - r.amt) > 1) vChecks.push({ ...v, why: `단가×수량(${r0(r.price * r.qty).toLocaleString()}) ≠ 금액` });
      if (!r.date) vChecks.push({ ...v, why: `입고일 없음 ("${r.rawDate ?? ''}") — 일자 무관 매칭` });
      else if (month && r.date.slice(0, 7) !== month) vChecks.push({ ...v, why: `대상월(${month}) 밖 날짜 ${r.date}` });
      vRows.push(v);
    }
  }

  // 매칭
  const fams = new Set([...units.map(u => u.fam), ...vRows.map(v => v.fam)]);
  const link = (eus, vs, how) => {
    const vsum = vs.reduce((t, v) => t + v.amt, 0);
    eus.forEach(u => { u.done = true; u.how = how; u.vs = vs; u.vAmt = eus.length === 1 ? vsum : u.amt; });
    vs.forEach(v => { v.done = true; v.how = how; v.eus = eus; });
    const pos = new Set(eus.map(u => u.ref));
    pos.forEach(p => vs.forEach(v => { if (!p.vendorMatches.includes(v)) p.vendorMatches.push(v); }));
    pos.forEach(p => { p.how = p.how ? p.how + ', ' + how : how; });
  };
  const near = (a, b) => a == null || b == null || Math.abs(dayDiff(a, b)) <= W;
  const dd = (a, b) => (a == null || b == null) ? 0 : Math.abs(dayDiff(a, b));
  const combos = (arr, k, start = 0, acc = [], out = []) => { if (acc.length === k) { out.push(acc.slice()); return out; } for (let i = start; i < arr.length && out.length < 20000; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); } return out; };
  for (const f of fams) {
    const E = units.filter(u => u.fam === f), V = vRows.filter(v => v.fam === f);
    const single = (sameDay) => {
      const pairs = [];
      E.filter(u => !u.done).forEach(u => V.filter(v => !v.done && v.amt === u.amt && (sameDay ? v.date === u.date : near(u.date, v.date))).forEach(v => pairs.push([dd(u.date, v.date), u, v])));
      pairs.sort((a, b) => a[0] - b[0]).forEach(([d, u, v]) => { if (!u.done && !v.done) link([u], [v], v.date === u.date ? '일치' : v.date ? `일자차이 ${dayDiff(v.date, u.date) > 0 ? '+' : ''}${dayDiff(v.date, u.date)}일` : '업체 일자없음'); });
    };
    const group = (sameDay) => {
      const ok = (a, b) => sameDay ? a === b : near(a, b);
      for (let k = 2; k <= 4; k++) {
        for (const u of E.filter(u => !u.done)) {
          const cand = V.filter(v => !v.done && ok(u.date, v.date) && v.amt < u.amt);
          if (cand.length < k || cand.length > 24) continue;
          const hit = combos(cand, k).filter(cb => cb.reduce((s, v) => s + v.amt, 0) === u.amt).sort((a, b) => a.reduce((s, v) => s + dd(u.date, v.date), 0) - b.reduce((s, v) => s + dd(u.date, v.date), 0))[0];
          if (hit) link([u], hit, `업체 ${k}행 합산`);
        }
        for (const v of V.filter(v => !v.done)) {
          const cand = E.filter(u => !u.done && ok(u.date, v.date) && u.amt < v.amt);
          if (cand.length < k || cand.length > 24) continue;
          const hit = combos(cand, k).filter(cb => cb.reduce((s, u) => s + u.amt, 0) === v.amt).sort((a, b) => a.reduce((s, u) => s + dd(u.date, v.date), 0) - b.reduce((s, u) => s + dd(u.date, v.date), 0))[0];
          if (hit) link(hit, [v], `PO ${k}건 합산`);
        }
      }
    };
    single(true); group(true); single(false); group(false);
    // 4) 남은 것: 가까운 날짜끼리 금액 불일치로 짝지음
    const rest = [];
    E.filter(u => !u.done).forEach(u => V.filter(v => !v.done && near(u.date, v.date)).forEach(v => rest.push([dd(u.date, v.date), u, v])));
    rest.sort((a, b) => a[0] - b[0]).forEach(([d, u, v]) => { if (!u.done && !v.done) { link([u], [v], '금액 불일치'); u.bad = v.bad = true; } });
  }

  // 담당자
  const staffAll = input.staff.flatMap(s => s.entries);
  const staffOther = staffAll.filter(e => !e.po.startsWith(poPrefix));
  const staffCur = staffAll.filter(e => e.po.startsWith(poPrefix));
  const staffNoERP = [];
  const sg = new Map();
  staffCur.forEach(e => {
    const k = e.file + '|' + e.sheet + '|' + e.po; let g = sg.get(k);
    if (!g) { g = { file: e.file, sheet: e.sheet, po: e.po, amt: 0, date: e.date, qty: 0, model: e.model, rows: [] }; sg.set(k, g); }
    g.amt += r0(e.amt); g.qty += Number(e.qty) || 0; g.rows.push(e.row); if (!g.date && e.date) g.date = e.date;
  });
  for (const g of sg.values()) { const p = POs.get(g.po); if (p) p.staff.push(g); else staffNoERP.push(g); }

  // PO 결과표
  const rows = [];
  for (const p of POs.values()) {
    const vAmt = p.units.reduce((s, u) => s + (u.done ? u.vAmt : 0), 0);
    const vDates = [...new Set(p.vendorMatches.map(v => v.date || String(v.rawDate ?? '일자없음')))].join(', ');
    const allUnitsDone = p.units.every(u => u.done);
    const st = p.staff;
    const stAmt = st.length ? st[0].amt : null;
    const issues = [], dateNotes = [];
    let status = 'ok';
    // 업체
    if (!hasVendor) { /* 업체 명세서 미사용 */ }
    else if (!p.vendorMatches.length) { issues.push('업체 명세서에 없음'); status = 'bad'; }
    else if (p.units.some(u => u.bad) || vAmt !== p.amt || !allUnitsDone) { issues.push(!allUnitsDone ? `일부 품번 업체 명세서에 없음 (차이 ${(vAmt - p.amt).toLocaleString()})` : `업체 금액 차이 ${(vAmt - p.amt).toLocaleString()}`); status = 'bad'; }
    // 담당자
    if (!hasStaff) { /* 담당자 파일 미사용 */ }
    else if (!st.length) { issues.push('담당자 파일 미기재'); status = hasVendor ? (status === 'ok' ? 'warn' : status) : 'bad'; }
    else {
      const amts = [...new Set(st.map(e => e.amt))];
      if (amts.length > 1) { issues.push('담당자 파일 간 금액 상이'); status = 'bad'; }
      if (stAmt !== p.amt) { issues.push(`담당자 금액 차이 ${(r0(stAmt) - p.amt).toLocaleString()}`); status = 'bad'; }
      const sd = st.find(e => e.date && e.date !== p.date);
      if (sd) dateNotes.push(`담당 ${sd.date.slice(5)}`);
      if (p.model) { const lab = norm(st[0].model); if (!p.model.sset.some(a => lab.includes(a))) { issues.push(`담당자 모델표기 "${st[0].model}" 확인`); if (status === 'ok') status = 'warn'; } }
      if (st.length > 1) issues.push(`담당자 ${st.length}곳 기재`);
    }
    const vdiff = p.vendorMatches.filter(v => v.date && v.date !== p.date).map(v => v.date.slice(5));
    if (p.vendorMatches.length && vdiff.length) dateNotes.push(`업체 ${[...new Set(vdiff)].join('/')}`);
    if (p.vendorMatches.some(v => !v.date)) dateNotes.push(`업체 "${p.vendorMatches.find(v => !v.date).rawDate}"`);
    if (p.how && /합산/.test(p.how)) issues.push(p.how.split(', ').filter(x => /합산/.test(x))[0]);
    rows.push({
      status, model: p.modelName, po: p.po, date: p.date, qty: p.qty, erpAmt: p.amt,
      staffWhere: st.map(e => `${e.file} / ${e.sheet}${e.rows.some(Boolean) ? ` (${e.rows.join(',')}행)` : ''}`).join('\n'), staffAmt: stAmt, staffDiff: st.length ? r0(stAmt) - p.amt : null,
      vendorDates: vDates, vendorAmt: p.vendorMatches.length ? vAmt : null, vendorDiff: p.vendorMatches.length ? vAmt - p.amt : null,
      vendorRows: p.vendorMatches.map(v => `${v.sheet}!${v.row}`).join(', '), issues: issues.join(' · '), dateNote: dateNotes.join(' / '), grps: [...p.grps].join(', ')
    });
  }
  rows.sort((a, b) => (a.model || '').localeCompare(b.model || '') || String(a.date).localeCompare(String(b.date)) || a.po.localeCompare(b.po));

  const vOnly = vRows.filter(v => !v.done);
  const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const summary = {
    hasVendor, hasStaff, month, poPrefix, erpPOs: POs.size, erpAmt: sum([...POs.values()], p => p.amt),
    vendorAmt: sum(vRows, v => v.amt), vendorRows: vRows.length,
    staffPOs: new Set(staffCur.filter(e => POs.has(e.po)).map(e => e.po)).size,
    staffAmt: sum([...POs.values()].filter(p => p.staff.length), p => p.staff[0].amt),
    dateDiff: rows.filter(r => r.dateNote).length, ok: rows.filter(r => r.status === 'ok').length, warn: rows.filter(r => r.status === 'warn').length, bad: rows.filter(r => r.status === 'bad').length,
    vOnly: vOnly.length, vOnlyAmt: sum(vOnly, v => v.amt), staffNoERP: staffNoERP.length, staffOther: staffOther.length
  };
  // 모델별 소계
  const byModel = new Map();
  for (const p of POs.values()) {
    const k = p.model ? p.model.name : p.groupName;
    const x = byModel.get(k) || { model: k, pos: 0, qty: 0, unit: p.unit, erp: 0, vendor: 0, staff: 0 };
    if (x.unit !== p.unit) x.unit = '';
    x.pos++; x.qty += p.qty || 0; x.erp += p.amt; x.staff += p.staff.length ? r0(p.staff[0].amt) : 0; byModel.set(k, x);
  }
  vRows.forEach(v => { const m = models.find(m => 'M:' + m.id === v.fam); const k = m ? m.name : groupOf(v.fam.slice(2)); const x = byModel.get(k) || { model: k, pos: 0, qty: 0, unit: '', erp: 0, vendor: 0, staff: 0 }; x.vendor += v.amt; byModel.set(k, x); });

  return { summary, rows, vOnly, vExcluded, vChecks, staffNoERP, staffOther, byModel: [...byModel.values()], skipped: input.staff.flatMap(s => s.skippedSheets.map(x => s.file + ' / ' + x)) };
}

const API = { DEFAULT_MASTER, parseERP, parseVendor, autoSelectVendorSheets, parseStaffWorkbook, reconcile, norm, splitList };
if (typeof module !== 'undefined') module.exports = API; else root.Recon = API;
})(this);
