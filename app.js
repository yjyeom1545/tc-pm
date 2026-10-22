/* TC 생산관리 · 외주 입고 등록 / 월마감 대사 */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => n == null || n === '' || isNaN(n) ? '' : Math.round(n).toLocaleString('ko-KR');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const thisMonth = () => today().slice(0, 7);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthEnd = m => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo, 0); return `${m}-${String(d.getDate()).padStart(2, '0')}`; };
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hide'), err ? 6000 : 2500); }

const sb = supabase.createClient(TCPM_CONFIG.url, TCPM_CONFIG.key);
const S = { user: null, prof: null, items: [], itemMap: {}, prices: [], master: null, editId: null, recent: [], list: [], closeRes: null, vendors: [], vendor: null, view: 'reg' };
const LSV = 'tcpm_vendor';
const vItems = () => S.items.filter(i => i.vendor === S.vendor);
const curVendor = () => S.vendors.find(v => v.name === S.vendor) || {};

/* ================= 인증 ================= */
let lmode = 'in';
$$('.ltabs button').forEach(b => b.onclick = () => {
  lmode = b.dataset.l; $$('.ltabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('#fLogin .up').forEach(x => x.classList.toggle('hide', lmode !== 'up'));
  $('#lBtn').textContent = lmode === 'in' ? '로그인' : '계정 신청'; $('#lMsg').textContent = '';
});
$('#fLogin').onsubmit = async e => {
  e.preventDefault(); $('#lMsg').textContent = ''; $('#lBtn').disabled = true;
  const email = $('#lEmail').value.trim(), password = $('#lPw').value;
  try {
    if (lmode === 'in') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const name = $('#lName').value.trim();
      if (!name) throw new Error('이름을 입력하세요');
      if (password.length < 6) throw new Error('비밀번호는 6자 이상');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.href.split('#')[0] } });
      if (error) throw error;
      if (!data.session) { $('#lMsg').style.color = 'var(--ok)'; $('#lMsg').textContent = '신청 완료. 메일의 인증 링크를 누른 뒤 로그인하세요.'; }
    }
  } catch (err) { $('#lMsg').style.color = ''; $('#lMsg').textContent = krErr(err.message); }
  $('#lBtn').disabled = false;
};
function krErr(m) {
  if (/Invalid login/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다';
  if (/Email not confirmed/i.test(m)) return '메일 인증이 아직 안 됐습니다. 받은 메일의 링크를 눌러 주세요';
  if (/already registered/i.test(m)) return '이미 신청된 이메일입니다';
  if (/duplicate key.*po/i.test(m)) return '이미 등록된 P/O No 입니다';
  if (/pm_receipts_po_check/.test(m)) return 'P/O No 형식이 아닙니다 (PO + 숫자 8자리)';
  if (/row-level security|권한/i.test(m)) return '권한이 없거나 마감(잠금)된 월입니다';
  return m;
}
$('#btnOut').onclick = $('#pOut').onclick = () => sb.auth.signOut();
$('#pRefresh').onclick = () => location.reload();

sb.auth.onAuthStateChange((ev, session) => { setTimeout(() => boot(session), 0); });
let booted = null;
async function boot(session) {
  if (!session) { show('login'); booted = null; return; }
  if (booted === session.user.id) return; booted = session.user.id;
  S.user = session.user;
  const { data: prof } = await sb.from('pm_profiles').select('*').eq('user_id', S.user.id).maybeSingle();
  S.prof = prof;
  if (!prof || !prof.approved) { show('pending'); return; }
  document.body.classList.toggle('admin', prof.role === 'admin');
  $('#meName').textContent = prof.name; $('#meRole').textContent = prof.role === 'admin' ? '관리자' : '담당자';
  show('app');
  await loadRefs();
  initViews();
  go(location.hash.slice(1) || 'reg');
}
function show(v) { $('#vLogin').classList.toggle('hide', v !== 'login'); $('#vPending').classList.toggle('hide', v !== 'pending'); $('#vApp').classList.toggle('hide', v !== 'app'); }

/* ================= 기준정보 로드 ================= */
async function loadRefs() {
  const [it, pr, cf, vd, bm] = await Promise.all([
    sb.from('pm_items').select('*').order('sort'),
    sb.from('pm_prices').select('*').order('valid_from', { ascending: false }),
    sb.from('pm_config').select('*').eq('id', 'master').maybeSingle(),
    sb.from('pm_vendors').select('*').order('sort'),
    sb.from('pm_bom').select('*').order('item_code').order('valid_from').order('seq').limit(5000)
  ]);
  S.bom = bm.data || [];
  S.vendors = vd.data || [];
  const act = S.vendors.filter(v => v.active);
  if (!S.vendor) { let saved = null; try { saved = localStorage.getItem(LSV); } catch (e) {} S.vendor = (act.find(v => v.name === saved) || act[0] || { name: '대림에스앤티' }).name; }
  const vopts = act.map(v => `<option ${v.name === S.vendor ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  $('#vendorSel').innerHTML = vopts; $('#rVendor').innerHTML = vopts; $('#cVendor').innerHTML = vopts;
  $('#lVendor').innerHTML = '<option value="__ALL__">전체 업체</option>' + vopts;
  S.items = it.data || []; S.itemMap = Object.fromEntries(S.items.map(i => [i.code, i]));
  S.prices = pr.data || [];
  S.master = (cf.data && cf.data.data) || JSON.parse(JSON.stringify(Recon.DEFAULT_MASTER));
  if (!S.master.partGroups) S.master.partGroups = Recon.DEFAULT_MASTER.partGroups;
  if (!S.master.partAlias) S.master.partAlias = [];
  if (!S.master.settings) S.master.settings = Recon.DEFAULT_MASTER.settings;
}
function priceFor(code, date) {
  const p = S.prices.filter(p => p.code === code && p.valid_from <= (date || today())).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
  return p ? Number(p.price) : null;
}

/* ================= 네비게이션 ================= */
const SUB = {
  reg: '<b>입고 등록</b> · 입고될 때마다 P/O No와 품목·수량을 입력합니다. 금액은 단가표로 자동 계산됩니다.',
  list: '<b>입고 내역</b> · 월별 등록 내역 조회, 수정·삭제, 엑셀 저장',
  close: '<b>월 마감</b> · ERP 입고상세조회를 올리면 등록 내역과 P/O 단위로 정합성을 검증합니다. 업체 명세서를 함께 올리면 3자 대조.',
  master: '<b>기준정보</b> · 품목·단가표(적용일별), ERP 모델 식별 마스터',
  users: '<b>사용자</b> · 계정 승인 및 권한'
};
$('#nav').onclick = e => { const v = e.target.dataset.v; if (v) go(v); };
function setVendor(v) {
  if (v === S.vendor) return; S.vendor = v; try { localStorage.setItem(LSV, v); } catch (e) {}
  $('#vendorSel').value = v; $('#rVendor').value = v; $('#cVendor').value = v; if (!S.listAll) $('#lVendor').value = v; S.closeRes = null; selItem = null;
  const keep = S.editId ? null : { po: $('#rPO').value, note: $('#rNote').value };
  resetForm(); if (keep) { $('#rPO').value = keep.po; $('#rNote').value = keep.note; checkPO(); }
  initItemFilters(); renderEmpty();
  if (C.erp) showErpInfo();
}
$('#vendorSel').onchange = () => { setVendor($('#vendorSel').value); go(S.view); };
$('#rVendor').onchange = () => { setVendor($('#rVendor').value); loadRecent(); };
$('#cVendor').onchange = () => { setVendor($('#cVendor').value); loadCloseInfo(); };
$('#lVendor').onchange = () => { const v = $('#lVendor').value; S.listAll = v === '__ALL__'; if (!S.listAll) setVendor(v); $('#lItem').value = ''; loadList(); };
function go(v) {
  if (!SUB[v] || (v === 'users' && S.prof.role !== 'admin')) v = 'reg';
  location.hash = v; S.view = v;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
  $$('main > section').forEach(s => s.classList.toggle('hide', s.id !== 'v-' + v));
  $('#subnav').innerHTML = SUB[v];
  ({ reg: loadRecent, list: loadList, close: loadCloseInfo, master: renderMaster, users: loadUsers })[v]();
}
let inited = false;
function initViews() {
  if (inited) return; inited = true;
  $('#rDate').value = today(); $('#lMonth').value = thisMonth(); $('#cMonth').value = prevMonthIfEarly();
  resetForm();
  initItemFilters();
}
function prevMonthIfEarly() { return new Date().getDate() <= 15 ? prevMonth() : thisMonth(); }

/* ================= 입고 등록 ================= */
function itemOptions(sel) {
  const pool = vItems().filter(i => i.active || i.code === sel);
  const cats = [...new Set(pool.map(i => i.category))];
  return '<option value="">품목 선택</option>' + cats.map(c => `<optgroup label="${esc(c)}">` + pool.filter(i => i.category === c).map(i => `<option value="${esc(i.code)}" ${i.code === sel ? 'selected' : ''}>${esc(i.name)}${i.erp_part && !i.name.includes(i.erp_part) ? ' · ' + esc(i.erp_part) : ''}</option>`).join('') + '</optgroup>').join('');
}
function addLine(l = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select class="lc">${itemOptions(l.code)}</select></td><td><input class="lq num" type="number" min="0" step="any" value="${l.qty ?? ''}"></td><td class="lu c muted"></td><td><input class="lp num" type="number" step="any" value="${l.unit_price ?? ''}"></td><td class="la num"></td><td class="x" title="삭제">✕</td>`;
  $('#rLines tbody').appendChild(tr);
  tr.dataset.ovr = l.overridden ? '1' : '';
  const sel = tr.querySelector('.lc'), q = tr.querySelector('.lq'), p = tr.querySelector('.lp');
  sel.onchange = () => { tr.dataset.ovr = ''; autoPrice(tr); calc(); q.focus(); };
  q.oninput = calc;
  p.oninput = () => { tr.dataset.ovr = Number(p.value) !== priceFor(sel.value, $('#rDate').value) ? '1' : ''; calc(); };
  tr.querySelector('.x').onclick = () => { if ($('#rLines tbody').children.length === 1) { tr.querySelector('.lc').value = ''; tr.querySelector('.lq').value = ''; tr.querySelector('.lp').value = ''; tr.dataset.ovr = ''; } else tr.remove(); calc(); };
  if (!l.unit_price) autoPrice(tr);
  calc();
  return tr;
}
function autoPrice(tr) {
  const code = tr.querySelector('.lc').value; if (!code) { tr.querySelector('.lp').value = ''; return; }
  if (tr.dataset.ovr === '1') return;
  const p = priceFor(code, $('#rDate').value);
  tr.querySelector('.lp').value = p ?? '';
}
function calc() {
  let tot = 0;
  $$('#rLines tbody tr').forEach(tr => {
    const code = tr.querySelector('.lc').value, it = S.itemMap[code];
    const q = Number(tr.querySelector('.lq').value) || 0, p = Number(tr.querySelector('.lp').value) || 0;
    tr.querySelector('.lu').textContent = it ? it.unit : '';
    tr.querySelector('.lp').classList.toggle('ovr', tr.dataset.ovr === '1');
    const a = Math.round(q * p); tr.querySelector('.la').textContent = fmt(a); tot += a;
  });
  $('#rTotal').textContent = fmt(tot);
  renderBom();
}
function bomFor(code, date) {
  const rows = S.bom.filter(b => b.item_code === code && b.valid_from <= (date || today()));
  if (!rows.length) return null;
  const vf = rows.reduce((m, b) => b.valid_from > m ? b.valid_from : m, '');
  return { valid_from: vf, parts: rows.filter(b => b.valid_from === vf).sort((a, b) => a.seq - b.seq) };
}
let bomRows = [];
function renderBom() {
  const date = $('#rDate').value;
  const lines = $$('#rLines tbody tr').map(tr => ({ code: tr.querySelector('.lc').value, qty: Number(tr.querySelector('.lq').value) || 0, price: Number(tr.querySelector('.lp').value) || 0, ovr: tr.dataset.ovr === '1' })).filter(l => l.code && l.qty > 0);
  bomRows = [];
  if (!lines.length) { $('#bomBody').innerHTML = '<div class="muted small" style="padding:14px;text-align:center">품목과 수량을 입력하면 여기에 ERP 등록용 부품 목록이 나옵니다.</div>'; $('#bomCopy').disabled = true; $$('.ccol').forEach(b => b.disabled = true); return; }
  let html = '', grand = 0;
  for (const l of lines) {
    const it = S.itemMap[l.code] || {}, b = bomFor(l.code, date), lineAmt = Math.round(l.qty * l.price);
    let parts;
    if (b) parts = b.parts.map(p => ({ part: p.part, name: p.part_name || '', per: Number(p.per_qty), qty: Number(p.per_qty) * l.qty, price: Number(p.unit_price) }));
    else parts = [{ part: String(it.erp_part || l.code).split(/[\s\/(]+/)[0], name: it.name || '', per: 1, qty: l.qty, price: l.price }];
    parts.forEach(p => p.amt = Math.round(p.qty * p.price));
    const sum = parts.reduce((a, p) => a + p.amt, 0); grand += sum;
    const ok = sum === lineAmt;
    const base = bomRows.length; bomRows.push(...parts);
    html += `<div class="bomgrp"><div class="bomhd"><b>${esc(it.name || l.code)}</b> × ${fmt(l.qty)}${esc(it.unit || '')} <span class="muted">${b ? `BOM ${b.parts.length}품목 · 적용 ${esc(b.valid_from)}` : 'BOM 없음 — 품목 자체를 1줄로 등록'}</span>
      <span class="sp"></span>${ok ? '<span class="tag t-ok">합계 일치</span>' : `<span class="tag t-bad">BOM 합계 ${fmt(sum)} ≠ 입고 금액 ${fmt(lineAmt)}</span>`}
      <button class="bcopy" data-i="${bomRows.length - parts.length}" data-n="${parts.length}">이 모델만 복사</button></div>
      <table class="bomt" data-i="${bomRows.length - parts.length}" data-n="${parts.length}"><thead><tr><th class="num" style="width:40px">No</th><th class="cc" data-col="part" title="이 모델 품번 열 복사">품번</th><th>품명</th><th class="num" style="width:52px">대당</th><th class="num cc" data-col="qty" style="width:70px" title="이 모델 수량 열 복사">수량</th><th class="num cc" data-col="price" style="width:90px" title="이 모델 단가 열 복사">단가</th><th class="num" style="width:105px">금액</th></tr></thead><tbody>
      ${parts.map((p, i) => { const r = base + i; return `<tr><td class="num muted">${i + 1}</td><td class="nw" data-r="${r}" data-c="part">${esc(p.part)}</td><td class="small" data-r="${r}" data-c="name">${esc(p.name)}</td><td class="num" data-r="${r}" data-c="per">${fmt(p.per)}</td><td class="num" data-r="${r}" data-c="qty"><b>${fmt(p.qty)}</b></td><td class="num" data-r="${r}" data-c="price">${fmt(p.price)}</td><td class="num" data-r="${r}" data-c="amt">${fmt(p.amt)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="6" class="num"><b>소계</b></td><td class="num"><b>${fmt(sum)}</b></td></tr></tfoot></table>
      ${!ok && l.ovr ? '<div class="small err">단가를 직접 수정한 줄이라 BOM 단가와 다릅니다. ERP 등록 단가를 확인하세요.</div>' : (!ok && b ? '<div class="small err">단가표와 BOM 단가가 맞지 않습니다 — 기준정보에서 새 단가의 BOM을 등록해 주세요.</div>' : '')}</div>`;
  }
  html += `<div class="bomtot">ERP 등록 합계 <b>${fmt(grand)}</b>원 · ${bomRows.length}줄</div>`;
  $('#bomBody').innerHTML = html; $('#bomCopy').disabled = false; $$('.ccol').forEach(b => b.disabled = false);
  $('#bomBody').querySelectorAll('th.cc').forEach(th => th.onclick = () => { const t = th.closest('table'); copyCol(bomRows.slice(+t.dataset.i, +t.dataset.i + +t.dataset.n), th.dataset.col); });
  $('#bomBody').querySelectorAll('.bcopy').forEach(b => b.onclick = () => copyRows(bomRows.slice(+b.dataset.i, +b.dataset.i + +b.dataset.n)));
}
async function copyRows(rows) {
  const withName = $('#bomName').checked;
  const txt = rows.map(p => (withName ? [p.part, p.name, p.qty, p.price] : [p.part, p.qty, p.price]).join('\t')).join('\n');
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(`${rows.length}줄 복사했습니다 — ERP 입력 화면에 붙여넣으세요`);
}
$('#bomCopy').onclick = () => copyRows(bomRows);
const COLNAME = { part: '품번', qty: '수량', price: '단가', name: '품명', per: '대당', amt: '금액' };
/* 열 단위 드래그 선택 → 놓으면 복사 */
let csel = null;
function paintSel() {
  $$('#bomBody td.csel').forEach(td => td.classList.remove('csel'));
  if (!csel) return;
  const lo = Math.min(csel.r0, csel.r1), hi = Math.max(csel.r0, csel.r1);
  $$(`#bomBody td[data-c="${csel.c}"]`).forEach(td => { const r = +td.dataset.r; if (r >= lo && r <= hi) td.classList.add('csel'); });
}
function selRows() { if (!csel) return []; const lo = Math.min(csel.r0, csel.r1), hi = Math.max(csel.r0, csel.r1); return bomRows.slice(lo, hi + 1); }
$('#bomBody').addEventListener('mousedown', e => {
  const td = e.target.closest('td[data-c]'); if (!td || e.button !== 0) return;
  e.preventDefault();
  if (e.shiftKey && csel && csel.c === td.dataset.c) csel.r1 = +td.dataset.r;
  else csel = { c: td.dataset.c, r0: +td.dataset.r, r1: +td.dataset.r };
  csel.drag = true; paintSel();
});
$('#bomBody').addEventListener('mouseover', e => {
  if (!csel || !csel.drag) return;
  const td = e.target.closest('td[data-c]'); if (!td || td.dataset.c !== csel.c) return;
  csel.r1 = +td.dataset.r; paintSel();
});
document.addEventListener('mouseup', () => { if (csel && csel.drag) { csel.drag = false; copyCol(selRows(), csel.c); } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && csel && !csel.drag && !window.getSelection().toString()) { e.preventDefault(); copyCol(selRows(), csel.c); } });
document.addEventListener('mousedown', e => { if (csel && !e.target.closest('#bomBody')) { csel = null; paintSel(); } });
async function copyCol(rows, col) {
  const txt = rows.map(p => p[col]).join('\n');
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(`${COLNAME[col]} ${rows.length}줄 복사했습니다`);
}
$$('.ccol').forEach(b => b.onclick = () => copyCol(bomRows, b.dataset.col));
$('#rAddLine').onclick = () => addLine().querySelector('.lc').focus();
$('#rDate').onchange = () => { $$('#rLines tbody tr').forEach(autoPrice); calc(); checkPO(); loadRecent(); };
let poTimer;
$('#rPO').oninput = () => { $('#rPO').value = $('#rPO').value.toUpperCase().replace(/\s/g, ''); clearTimeout(poTimer); poTimer = setTimeout(checkPO, 250); };
async function checkPO() {
  const po = $('#rPO').value, m = $('#poMsg');
  if (!po) { m.innerHTML = ''; return false; }
  if (!/^PO\d{8}$/.test(po)) { m.innerHTML = '<span class="err">형식: PO + 숫자 8자리 (예: PO26100001)</span>'; return false; }
  const d = $('#rDate').value, yymm = d ? d.slice(2, 4) + d.slice(5, 7) : '';
  const { data } = await sb.from('pm_receipts').select('id,recv_date,vendor,created_by_name').eq('po', po).maybeSingle();
  if (data && data.id !== S.editId) { m.innerHTML = `<span class="err">이미 등록된 P/O 입니다 — ${esc(data.vendor)} · ${esc(data.recv_date)} · ${esc(data.created_by_name || '')}</span>`; return false; }
  if (yymm && po.slice(2, 6) !== yymm) { m.innerHTML = `<span class="tag t-warn">확인</span> P/O 월(${po.slice(2, 4)}년 ${po.slice(4, 6)}월)과 입고일 월이 다릅니다`; return true; }
  m.innerHTML = '<span class="ok">사용 가능한 P/O</span>'; return true;
}
function resetForm() {
  S.editId = null; $('#regTitle').textContent = '입고 등록 — ' + (S.vendor || '');
  $('#rPO').value = ''; $('#rNote').value = ''; $('#poMsg').innerHTML = ''; $('#rMsg').textContent = '';
  if (!$('#rDate').value) $('#rDate').value = today();
  $('#rLines tbody').innerHTML = ''; addLine();
  $('#rSave').textContent = '저장'; $('#rReset').textContent = '새로 입력';
}
$('#rReset').onclick = () => { resetForm(); $('#rPO').focus(); };
$('#rSave').onclick = async () => {
  const lines = $$('#rLines tbody tr').map(tr => ({ code: tr.querySelector('.lc').value, qty: Number(tr.querySelector('.lq').value), unit_price: Number(tr.querySelector('.lp').value), overridden: tr.dataset.ovr === '1' })).filter(l => l.code || l.qty);
  if (!$('#rDate').value) return toast('입고일을 입력하세요', 1);
  if (!(await checkPO())) return toast('P/O No를 확인하세요', 1);
  if (!lines.length) return toast('품목을 1개 이상 입력하세요', 1);
  if (lines.some(l => !l.code || !(l.qty > 0))) return toast('품목과 수량을 확인하세요', 1);
  if ($$('#rLines tbody tr').some(tr => tr.querySelector('.lc').value && tr.querySelector('.lp').value === '')) return toast('단가가 없는 품목이 있습니다 (기준정보에 단가 등록 필요)', 1);
  const dup = lines.map(l => l.code).filter((c, i, a) => a.indexOf(c) !== i);
  if (dup.length) return toast('같은 품목이 두 줄 있습니다 — 수량을 합쳐 주세요', 1);
  $('#rSave').disabled = true;
  const head = { po: $('#rPO').value, recv_date: $('#rDate').value, vendor: S.vendor, note: $('#rNote').value.trim() || null };
  let error = null;
  if (!S.editId) {
    ({ error } = await sb.rpc('pm_new_receipt', { p: { ...head, lines } }));
  } else {
    const u = await sb.from('pm_receipts').update(head, { count: 'exact' }).eq('id', S.editId);
    error = u.error || (!u.count ? { message: '권한' } : null);
    if (!error) { const d = await sb.from('pm_receipt_lines').delete().eq('receipt_id', S.editId); error = d.error; }
    if (!error) { const i = await sb.from('pm_receipt_lines').insert(lines.map(l => ({ receipt_id: S.editId, code: l.code, qty: l.qty, unit_price: l.unit_price, amount: Math.round(l.qty * l.unit_price), price_overridden: l.overridden }))); error = i.error; }
  }
  $('#rSave').disabled = false;
  if (error) return toast(krErr(error.message), 1);
  toast((S.editId ? '수정' : '저장') + ' 완료 · ' + S.vendor + ' · ' + $('#rPO').value + ' · ' + $('#rTotal').textContent + '원');
  const keepDate = $('#rDate').value; resetForm(); $('#rDate').value = keepDate; $('#rPO').focus();
  loadRecent();
};
async function fetchReceipts(q) {
  const { data, error } = await q;
  if (error) { toast(krErr(error.message), 1); return []; }
  return (data || []).map(r => { const lines = r.pm_receipt_lines || []; return { ...r, lines, amount: lines.reduce((s, l) => s + Number(l.amount), 0) }; });
}
const SEL = 'id,po,recv_date,vendor,note,created_by,created_by_name,created_at,updated_at,pm_receipt_lines(code,qty,unit_price,amount,price_overridden)';
async function loadRecent() {
  const m = ($('#rDate').value || today()).slice(0, 7);
  S.recent = await fetchReceipts(sb.from('pm_receipts').select(SEL).eq('vendor', S.vendor).gte('recv_date', m + '-01').lte('recv_date', monthEnd(m)).order('recv_date', { ascending: false }).order('created_at', { ascending: false }));
  const tot = S.recent.reduce((s, r) => s + r.amount, 0);
  $('#recentTitle').innerHTML = `${esc(S.vendor)} · ${esc(m.replace('-', '년 '))}월 등록 현황 <span class="muted small" style="font-weight:400">${S.recent.length}건 · ${fmt(tot)}원</span>`;
  const t = $('#tRecent');
  t.innerHTML = '<thead><tr><th>입고일</th><th>P/O No</th><th>품목 · 수량</th><th class="num">금액</th><th>담당</th></tr></thead><tbody>' +
    (S.recent.length ? S.recent.map(r => `<tr class="clk ${r.id === S.editId ? 'sel' : ''}" data-id="${r.id}"><td class="nw">${esc(r.recv_date.slice(5))}</td><td class="nw">${esc(r.po)}</td><td>${lineText(r)}</td><td class="num">${fmt(r.amount)}</td><td class="nw">${esc(r.created_by_name || '')}</td></tr>`).join('')
      : `<tr class="empty"><td colspan="5">${esc(S.vendor)} ${esc(m)} 등록 내역이 없습니다</td></tr>`) + '</tbody>';
  t.querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => editReceipt(S.recent.find(r => r.id === tr.dataset.id)));
}
function lineText(r) { return r.lines.map(l => { const it = S.itemMap[l.code]; return `${esc(it ? it.name : l.code)} <b>${fmt(l.qty)}</b>${it && it.unit !== '대' ? esc(it.unit) : (it ? '대' : '')}${l.price_overridden ? ' <span class="tag t-warn">단가수정</span>' : ''}`; }).join('<br>'); }
function canEdit(r) { return S.prof.role === 'admin' || r.created_by === S.user.id; }
function editReceipt(r) {
  if (!r) return;
  if (!canEdit(r)) return toast('본인이 등록한 건만 수정할 수 있습니다 (관리자 제외)', 1);
  if (r.vendor && r.vendor !== S.vendor) setVendor(r.vendor);
  go('reg');
  S.editId = r.id; $('#regTitle').textContent = '입고 수정 — ' + r.vendor + ' · ' + r.po; $('#rSave').textContent = '수정 저장'; $('#rReset').textContent = '수정 취소';
  $('#rDate').value = r.recv_date; $('#rPO').value = r.po; $('#rNote').value = r.note || '';
  $('#rLines tbody').innerHTML = ''; r.lines.forEach(l => addLine({ code: l.code, qty: Number(l.qty), unit_price: Number(l.unit_price), overridden: l.price_overridden }));
  checkPO(); loadRecent();
}

/* ================= 입고 내역 ================= */
['#lMonth', '#lStaff', '#lItem'].forEach(id => $(id).onchange = () => id === '#lMonth' ? loadList() : renderList());
$('#lText').oninput = renderList;
async function loadList() {
  $('#lVendor').value = S.listAll ? '__ALL__' : S.vendor;
  const m = $('#lMonth').value || thisMonth();
  let q = sb.from('pm_receipts').select(SEL); if (!S.listAll) q = q.eq('vendor', S.vendor);
  S.list = await fetchReceipts(q.gte('recv_date', m + '-01').lte('recv_date', monthEnd(m)).order('recv_date').order('po'));
  $('#lItem').disabled = !!S.listAll;
  const staffs = [...new Set(S.list.map(r => r.created_by_name || ''))].sort();
  const cur = $('#lStaff').value;
  $('#lStaff').innerHTML = '<option value="">담당자: 전체</option>' + staffs.map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
  renderList();
}
function listFiltered() {
  const st = $('#lStaff').value, it = $('#lItem').value, tx = $('#lText').value.trim().toUpperCase();
  return S.list.filter(r => (!st || (r.created_by_name || '') === st) && (!it || r.lines.some(l => l.code === it)) && (!tx || (r.po + (r.note || '')).toUpperCase().includes(tx)));
}
function renderList() {
  const rows = listFiltered();
  const tot = rows.reduce((s, r) => s + r.amount, 0);
  const staffN = new Set(rows.map(r => r.created_by_name || '')).size, ovr = rows.filter(r => r.lines.some(l => l.price_overridden));
  $('#lKpi').innerHTML = `<div class="kpi"><div class="l">등록 P/O</div><div class="v">${rows.length}</div><div class="d muted">${S.listAll ? '전체 업체' : esc(S.vendor)} · ${esc($('#lMonth').value)}</div></div>
   <div class="kpi"><div class="l">입고 금액 합계</div><div class="v">${fmt(tot)}</div></div>
   <div class="kpi"><div class="l">등록 담당자</div><div class="v">${staffN}</div><div class="d muted">명</div></div>
   <div class="kpi warn"><div class="l">단가 직접 수정</div><div class="v">${ovr.length}</div><div class="d muted">단가표와 다른 단가로 입력된 건</div></div>`;
  $('#lInfo').textContent = `${rows.length} / ${S.list.length}건`;
  const all = !!S.listAll;
  $('#tList').innerHTML = '<thead><tr>' + (all ? '<th>업체</th>' : '') + '<th>입고일</th><th>P/O No</th><th>품목 · 수량</th><th class="num">금액</th><th>담당</th><th>비고</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map(r => `<tr>${all ? `<td class="nw">${esc(r.vendor)}</td>` : ''}<td class="nw">${esc(r.recv_date)}</td><td class="nw">${esc(r.po)}</td><td>${lineText(r)}</td><td class="num">${fmt(r.amount)}</td><td class="nw">${esc(r.created_by_name || '')}</td><td class="small">${esc(r.note || '')}</td><td class="nw">${canEdit(r) ? `<button data-e="${r.id}">수정</button> <button data-d="${r.id}">삭제</button>` : ''}</td></tr>`).join('')
      : `<tr class="empty"><td colspan="${all ? 8 : 7}">해당 월 등록 내역이 없습니다</td></tr>`) + '</tbody>';
  $('#tList').querySelectorAll('[data-e]').forEach(b => b.onclick = () => editReceipt(S.list.find(r => r.id === b.dataset.e)));
  $('#tList').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    const r = S.list.find(x => x.id === b.dataset.d);
    if (!confirm(`${r.po} (${fmt(r.amount)}원)을 삭제할까요?`)) return;
    const { error, count } = await sb.from('pm_receipts').delete({ count: 'exact' }).eq('id', r.id);
    if (error || !count) return toast(error ? krErr(error.message) : '삭제 권한이 없거나 마감된 월입니다', 1);
    toast('삭제했습니다'); loadList();
  });
  if (all) {
    const vg = {}; rows.forEach(r => { const a = vg[r.vendor] || (vg[r.vendor] = { n: 0, amt: 0 }); a.n++; a.amt += r.amount; });
    const order = S.vendors.map(v => v.name).filter(n => vg[n]).concat(Object.keys(vg).filter(n => !S.vendors.some(v => v.name === n)));
    $('#tListSum').innerHTML = '<thead><tr><th>업체</th><th class="num">P/O</th><th class="num">금액</th></tr></thead><tbody>' +
      (order.length ? order.map(n => `<tr class="clk" data-v="${esc(n)}"><td>${esc(n)}</td><td class="num">${vg[n].n}</td><td class="num">${fmt(vg[n].amt)}</td></tr>`).join('') + `<tr style="font-weight:700"><td>합계</td><td class="num">${rows.length}</td><td class="num">${fmt(tot)}</td></tr>` : '<tr class="empty"><td colspan="3">업체별 합계</td></tr>') + '</tbody>';
    $('#tListSum').querySelectorAll('tr.clk').forEach(tr => tr.onclick = () => { $('#lVendor').value = tr.dataset.v; $('#lVendor').onchange(); });
    return;
  }
  // 품목별 합계
  const agg = {};
  rows.forEach(r => r.lines.forEach(l => { const a = agg[l.code] || (agg[l.code] = { qty: 0, amt: 0, n: 0 }); a.qty += Number(l.qty); a.amt += Number(l.amount); a.n++; }));
  const keys = Object.keys(agg).sort((a, b) => (S.itemMap[a]?.sort ?? 999) - (S.itemMap[b]?.sort ?? 999));
  $('#tListSum').innerHTML = '<thead><tr><th>품목</th><th class="num">P/O</th><th class="num">수량</th><th class="num">금액</th></tr></thead><tbody>' +
    (keys.length ? keys.map(k => `<tr><td>${esc(S.itemMap[k]?.name || k)}</td><td class="num">${agg[k].n}</td><td class="num">${fmt(agg[k].qty)} ${esc(S.itemMap[k]?.unit || '')}</td><td class="num">${fmt(agg[k].amt)}</td></tr>`).join('') + `<tr style="font-weight:700"><td>합계</td><td></td><td></td><td class="num">${fmt(tot)}</td></tr>`
      : '<tr class="empty"><td colspan="4">품목별 합계</td></tr>') + '</tbody>';
}
$('#lXls').onclick = () => {
  const rows = listFiltered(); const aoa = [['업체', '입고일', 'P/O No', '품목코드', '품목', '수량', '단위', '단가', '금액', '단가수정', '담당', '비고']];
  rows.forEach(r => r.lines.forEach(l => { const it = S.itemMap[l.code] || {}; aoa.push([r.vendor, r.recv_date, r.po, l.code, it.name || l.code, Number(l.qty), it.unit || '', Number(l.unit_price), Number(l.amount), l.price_overridden ? 'Y' : '', r.created_by_name || '', r.note || '']); }));
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [12, 12, 13, 10, 30, 9, 6, 12, 14, 8, 10, 30].map(w => ({ wch: w }));
  aoa[0].forEach((h, c) => { ws[XLSX.utils.encode_cell({ r: 0, c })].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1F3864' } } }; });
  for (let r = 1; r < aoa.length; r++) [5, 7, 8].forEach(c => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = '#,##0'; });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '입고내역'); XLSX.writeFile(wb, `입고내역_${S.listAll ? '전체업체' : S.vendor}_${$('#lMonth').value}.xlsx`);
};

/* ================= 월 마감 ================= */
const C = { erp: null, erpName: '', ven: null, venName: '', regs: [], closing: null, sel: [] };
function readFile(f) { return new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => { try { ok(XLSX.read(new Uint8Array(r.result), { type: 'array' })); } catch (e) { ng(e); } }; r.onerror = ng; r.readAsArrayBuffer(f); }); }
function setupDrop(id, onFile) {
  const d = $(id), inp = d.querySelector('input');
  d.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => { if (inp.files[0]) onFile(inp.files[0]); inp.value = ''; });
  d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
  d.addEventListener('dragleave', () => d.classList.remove('over'));
  d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
}
const fileLine = (ok, name, info) => `<div>${ok ? '<span class="tag t-ok">OK</span>' : '<span class="tag t-bad">오류</span>'} ${esc(name)} <span class="muted">${esc(info || '')}</span></div>`;
setupDrop('#dErp', async f => {
  try {
    const wb = await readFile(f); const e = Recon.parseERP(wb, XLSX);
    if (!e || !e.lines.length) throw new Error('입고상세조회 머리글(입고번호, P/O No)을 찾지 못했습니다');
    C.erp = e; C.erpName = f.name;
    const mc = {}; e.lines.forEach(l => { const m = (l.date || '').slice(0, 7); mc[m] = (mc[m] || 0) + 1; });
    const em = Object.keys(mc).sort((a, b) => mc[b] - mc[a])[0];
    if (em && em !== $('#cMonth').value) { $('#cMonth').value = em; await loadCloseInfo(); }
    showErpInfo();
  } catch (err) { C.erp = null; $('#dErp').classList.remove('has'); $('#dErp .files').innerHTML = fileLine(0, f.name, err.message); }
  refreshClose();
});
setupDrop('#dVen', async f => {
  try {
    const wb = await readFile(f); const v = Recon.parseVendor(wb, XLSX);
    if (!v.sheets.length) throw new Error('날짜·금액 머리글이 있는 시트를 찾지 못했습니다');
    C.ven = v; C.venName = f.name; $('#dVen').classList.add('has'); $('#dVen .files').innerHTML = fileLine(1, f.name, `대조 후보 시트 ${v.sheets.length}개`);
  } catch (err) { C.ven = null; $('#dVen').classList.remove('has'); $('#dVen .files').innerHTML = fileLine(0, f.name, err.message); }
  refreshClose();
});
$('#cMonth').onchange = loadCloseInfo;
function erpFor(vendorName) {
  const v = S.vendors.find(x => x.name === vendorName) || {};
  const lines = C.erp.lines.filter(l => v.erp_code ? l.vcode === String(v.erp_code) : String(l.vendor || '').replace(/\s|\(주\)|㈜/g, '').includes(vendorName.replace(/\s/g, '')));
  return { ...C.erp, lines };
}
function showErpInfo() {
  if (!C.erp) return;
  const all = C.erp.lines, mine = erpFor(S.vendor).lines;
  const byV = {}; all.forEach(l => { const k = (l.vendor || '?') + (l.vcode ? ' (' + l.vcode + ')' : ''); byV[k] = (byV[k] || 0) + l.amt; });
  const pos = new Set(mine.map(l => l.po)).size, amt = mine.reduce((s, l) => s + l.amt, 0);
  $('#dErp').classList.add('has');
  $('#dErp .files').innerHTML = fileLine(1, C.erpName, `전체 ${all.length}행`) +
    `<div style="margin-top:4px"><b>${esc(S.vendor)}</b> 해당: ${mine.length}행 · P/O ${pos}건 · <b>${fmt(amt)}</b>원${mine.length ? '' : ' <span class="err">— 이 업체 입고가 파일에 없습니다</span>'}</div>` +
    (Object.keys(byV).length > 1 ? `<div class="muted">파일 내 거래처: ${Object.entries(byV).map(([k, a]) => esc(k) + ' ' + fmt(a)).join(' · ')}</div>` : '');
  refreshClose();
}
async function loadCloseInfo() {
  const m = $('#cMonth').value || prevMonth(), yymm = 'PO' + m.slice(2, 4) + m.slice(5, 7);
  const [a, b, cl] = await Promise.all([
    fetchReceipts(sb.from('pm_receipts').select(SEL).eq('vendor', S.vendor).gte('recv_date', m + '-01').lte('recv_date', monthEnd(m))),
    fetchReceipts(sb.from('pm_receipts').select(SEL).eq('vendor', S.vendor).like('po', yymm + '%')),
    sb.from('pm_closings').select('*').eq('month', m).eq('vendor', S.vendor).maybeSingle()
  ]);
  const map = new Map(); [...a, ...b].forEach(r => map.set(r.id, r)); C.regs = [...map.values()];
  C.closing = cl.data;
  const tot = C.regs.reduce((s, r) => s + r.amount, 0), staffs = [...new Set(C.regs.map(r => r.created_by_name || ''))];
  $('#cRegInfo').innerHTML = `<b>${esc(S.vendor)}</b> ${esc(m)} 입고 등록 <b>${C.regs.length}</b>건 · <b>${fmt(tot)}</b>원 · 담당 ${staffs.length}명`;
  $('#cRegFiles').innerHTML = staffs.length ? staffs.map(s => { const rs = C.regs.filter(r => (r.created_by_name || '') === s); return `<div><span class="tag t-ok">DB</span> ${esc(s || '(이름 없음)')} <span class="muted">${rs.length}건 · ${fmt(rs.reduce((x, r) => x + r.amount, 0))}원</span></div>`; }).join('') : `<span class="muted">${esc(S.vendor)} 해당 월 등록 내역 없음</span>`;
  $('#cLockInfo').innerHTML = C.closing ? `<span class="tag ${C.closing.locked ? 't-bad' : 't-mut'}">${C.closing.locked ? '마감 확정(잠금)' : '마감 저장(잠금 해제)'}</span> ${esc(C.closing.created_by_name || '')} · ${esc(String(C.closing.created_at).slice(0, 16).replace('T', ' '))} ${S.prof.role === 'admin' && C.closing.locked ? '<button id="btnUnlock">잠금 해제</button>' : ''}` : '<span class="tag t-mut">미마감</span>';
  const ub = $('#btnUnlock'); if (ub) ub.onclick = async () => { if (!confirm(S.vendor + ' ' + m + ' 마감 잠금을 해제할까요? 해제하면 해당 월 입고를 다시 수정할 수 있습니다.')) return; const { error } = await sb.from('pm_closings').update({ locked: false }).eq('month', m).eq('vendor', S.vendor); if (error) return toast(krErr(error.message), 1); toast('잠금 해제'); loadCloseInfo(); };
  loadHist();
  refreshClose();
  if (!S.closeRes) renderEmpty();
}
function refreshClose() {
  const box = $('#cSheetsBox');
  box.classList.toggle('hide', !C.ven);
  if (C.ven) {
    const mon = $('#cMonth').value, auto = new Set(Recon.autoSelectVendorSheets(C.ven, +mon.slice(5, 7)));
    const idx = new Map(); C.ven.index.forEach(ix => ix.items.forEach(it => idx.set(it.amt, it.label)));
    $('#idxInfo').innerHTML = C.ven.index.filter(i => i.items.length).map(ix => `<b>${esc(ix.sheet)}</b> ${esc(ix.title)} — ` + ix.items.map(it => `${esc(it.label)} ${fmt(it.amt)}`).join(' / ')).join('<br>') + '<br>INDEX 금액과 시트 합계가 같은 시트를 자동 체크했습니다.';
    $('#sheetList').innerHTML = C.ven.sheets.map(s => `<label><input type="checkbox" data-sheet="${esc(s.sheet)}" ${auto.has(s.sheet) ? 'checked' : ''}> <b>${esc(s.sheet)}</b> <span class="muted">${esc(s.title)}</span> ${idx.has(s.sum) ? `<span class="tag t-ok">INDEX "${esc(idx.get(s.sum))}" 일치</span>` : ''}<span class="sum">${s.rows.length}행 · ${fmt(s.sum)}원</span></label>`).join('');
  }
  $('#btnRun').disabled = !C.erp;
  $('#runInfo').textContent = !C.erp ? 'ERP 입고상세조회를 넣으면 실행할 수 있습니다' : `[${S.vendor}] ` + (C.ven ? 'ERP · 업체 명세서 · 입고 등록 3자 대조' : 'ERP ↔ 입고 등록 대조 (업체 명세서 없음)');
}
$('#btnRun').onclick = () => {
  C.sel = $$('#sheetList input:checked').map(x => x.dataset.sheet);
  const vendorSheets = C.ven ? C.ven.sheets.filter(s => C.sel.includes(s.sheet)) : [];
  const entries = C.regs.map(r => ({ file: '입고등록', sheet: r.created_by_name || '(이름 없음)', row: null, po: r.po, amt: Math.round(r.amount), date: r.recv_date, qty: r.lines.reduce((s, l) => s + Number(l.qty), 0), model: r.lines.map(l => S.itemMap[l.code]?.name || l.code).join(', ') }));
  const staff = entries.length ? [{ file: '입고등록', entries, skippedSheets: [] }] : [];
  const erpV = erpFor(S.vendor);
  if (!erpV.lines.length) return toast(`ERP 파일에 ${S.vendor} 입고가 없습니다 (기준정보 > 업체의 거래처코드 확인)`, 1);
  S.closeRes = Recon.reconcile({ erp: erpV, vendorSheets, staff }, S.master); S.closeRes.vendor = S.vendor;
  // 단가 수정 건 표시
  const ovr = new Set(C.regs.filter(r => r.lines.some(l => l.price_overridden)).map(r => r.po));
  S.closeRes.rows.forEach(x => { if (ovr.has(x.po)) x.issues = (x.issues ? x.issues + ' · ' : '') + '입고 등록 시 단가 직접 수정'; x.staffWhere = x.staffWhere.replace(/입고등록 \/ /g, ''); });
  renderClose(); $('#btnXls').disabled = false; $('#btnClose').disabled = false;
  $('#kpis').scrollIntoView({ behavior: 'smooth' });
};
const ST = { ok: ['일치', 't-ok'], warn: ['확인필요', 't-warn'], bad: ['불일치', 't-bad'] };
const PO_HEAD = '<thead><tr><th>상태</th><th>모델 (ERP 식별)</th><th>P/O No</th><th>ERP 입고일</th><th>날짜 차이</th><th class="num">대수/수량</th><th class="num">ERP 금액</th><th class="num">등록 금액</th><th class="num">등록−ERP</th><th class="num">업체 금액</th><th class="num">업체−ERP</th><th>등록 담당</th><th>확인 내용</th></tr></thead>';
function renderEmpty() {
  const k = (l, d, c = '') => `<div class="kpi ${c}"><div class="l">${l}</div><div class="v muted">—</div><div class="d muted">${d}</div></div>`;
  $('#kpis').innerHTML = k('ERP 입고', 'P/O —건') + k('업체 명세서', 'ERP 대비 —') + k('입고 등록', 'ERP 대비 —') + k('일치 P/O (P/O·금액)', '날짜 차이 —', 'ok') + k('확인필요 P/O', '미등록·모델 표기 등', 'warn') + k('불일치 P/O / 업체에만 있는 행', '', 'bad');
  $('#tPO').innerHTML = PO_HEAD + '<tbody><tr class="empty"><td colspan="13">ERP 입고상세조회를 넣고 [대조 실행]을 누르면 P/O별 결과가 표시됩니다.</td></tr></tbody>';
  $('#tModel').innerHTML = '<thead><tr><th>모델 / 품목군</th><th class="num">P/O</th><th class="num">대수 / 수량</th><th class="num">ERP</th><th class="num">업체</th><th class="num">업체−ERP</th><th class="num">입고 등록</th><th class="num">등록−ERP</th></tr></thead><tbody><tr class="empty"><td colspan="8">대조 실행 후 표시됩니다.</td></tr></tbody>';
  $('#t-ven').innerHTML = '<div class="muted small" style="padding:18px">업체 명세서를 넣고 대조하면 ① 업체에만 있는 행 ② 명세서 내부 점검 ③ 대조 제외 행이 표시됩니다.</div>';
  $('#t-stf').innerHTML = '<div class="muted small" style="padding:18px">대조 후 ① 등록됐지만 ERP에 없는 P/O ② ERP에는 있지만 등록 안 된 P/O가 표시됩니다.</div>';
  $('#poCount').textContent = ''; $('#btnXls').disabled = true; $('#btnClose').disabled = true;
}
function renderClose() {
  const r = S.closeRes, s = r.summary, d1 = s.vendorAmt - s.erpAmt, d2 = s.staffAmt - s.erpAmt;
  $('#kpis').innerHTML = `
   <div class="kpi"><div class="l">ERP 입고 · ${esc(r.vendor)} (${esc(s.month)})</div><div class="v">${fmt(s.erpAmt)}</div><div class="d muted">P/O ${s.erpPOs}건</div></div>
   ${s.hasVendor ? `<div class="kpi"><div class="l">업체 명세서 (선택 시트)</div><div class="v">${fmt(s.vendorAmt)}</div><div class="d ${d1 ? 'diff' : 'muted'}">ERP 대비 ${d1 > 0 ? '+' : ''}${fmt(d1)}</div></div>` : '<div class="kpi"><div class="l">업체 명세서</div><div class="v muted">미사용</div><div class="d muted">ERP ↔ 입고 등록만 대조</div></div>'}
   <div class="kpi"><div class="l">입고 등록 (ERP P/O 해당분)</div><div class="v">${fmt(s.staffAmt)}</div><div class="d ${d2 ? 'diff' : 'muted'}">P/O ${s.staffPOs}/${s.erpPOs}건 · ERP 대비 ${d2 > 0 ? '+' : ''}${fmt(d2)}</div></div>
   <div class="kpi ok"><div class="l">일치 P/O (P/O·금액)</div><div class="v">${s.ok}</div><div class="d muted">${s.dateDiff ? `날짜만 다른 P/O ${s.dateDiff}건 포함` : '날짜 차이 없음'}</div></div>
   <div class="kpi warn"><div class="l">확인필요 P/O</div><div class="v">${s.warn}</div><div class="d muted">미등록·모델 표기 등</div></div>
   <div class="kpi bad"><div class="l">불일치 P/O / 업체에만 있는 행</div><div class="v">${s.bad} / ${s.vOnly}</div><div class="d muted">${s.vOnly ? '업체에만 ' + fmt(s.vOnlyAmt) + '원' : ''}</div></div>`;
  const models = [...new Set(r.rows.map(x => x.model))].sort();
  $('#fModel').innerHTML = '<option value="">모델: 전체</option>' + models.map(m => `<option>${esc(m)}</option>`).join('');
  $('#fStatus').value = s.bad || s.warn ? 'nok' : '';
  renderPO(); renderModel(); renderVen(); renderStf();
}
function renderPO() {
  const r = S.closeRes; if (!r) return;
  const fs = $('#fStatus').value, fm = $('#fModel').value, ft = $('#fText').value.trim().toUpperCase();
  const rows = r.rows.filter(x => (!fs || (fs === 'nok' ? x.status !== 'ok' : fs === 'date' ? !!x.dateNote : x.status === fs)) && (!fm || x.model === fm) && (!ft || (x.po + x.staffWhere + x.issues + x.model).toUpperCase().includes(ft)));
  $('#poCount').textContent = `${rows.length} / ${r.rows.length}건`;
  const dc = v => v == null ? '' : `<span class="${v ? 'diff' : ''}">${v > 0 ? '+' : ''}${fmt(v)}</span>`;
  $('#tPO').innerHTML = PO_HEAD + '<tbody>' + (rows.length ? rows.map(x => `<tr class="${x.status === 'ok' ? '' : x.status}"><td class="c"><span class="tag ${ST[x.status][1]}">${ST[x.status][0]}</span></td><td>${esc(x.model)}</td><td class="nw">${esc(x.po)}</td><td class="nw">${esc(x.date)}</td><td>${x.dateNote ? `<span class="tag t-date">${esc(x.dateNote.replace(/담당/g, '등록'))}</span>` : ''}</td><td class="num">${x.qty == null ? '' : fmt(x.qty)}</td><td class="num">${fmt(x.erpAmt)}</td><td class="num">${fmt(x.staffAmt)}</td><td class="num">${dc(x.staffDiff)}</td><td class="num">${fmt(x.vendorAmt)}</td><td class="num">${dc(x.vendorDiff)}</td><td class="small nw">${esc(x.staffWhere)}</td><td class="small">${esc(x.issues.replace(/담당자 파일 미기재/g, '입고 미등록').replace(/담당자/g, '등록'))}</td></tr>`).join('') : '<tr class="empty"><td colspan="13">조건에 맞는 P/O가 없습니다</td></tr>') + '</tbody>';
}
['#fStatus', '#fModel'].forEach(id => $(id).onchange = renderPO); $('#fText').oninput = renderPO;
function renderModel() {
  const b = S.closeRes.byModel.slice().sort((a, b) => (a.unit === '대' ? 0 : 1) - (b.unit === '대' ? 0 : 1) || b.erp - a.erp);
  const t = { pos: 0, qty: 0, erp: 0, vendor: 0, staff: 0 }; b.forEach(x => { for (const k in t) if (k !== 'qty' || x.unit === '대') t[k] += x[k] || 0; });
  const dc = v => `<span class="${v ? 'diff' : ''}">${v > 0 ? '+' : ''}${fmt(v)}</span>`;
  const q = x => !x.qty ? '' : x.unit === '대' ? fmt(x.qty) + ' 대' : `${fmt(x.qty)} ${esc((x.unit || '').toLowerCase())}`;
  const hv = S.closeRes.summary.hasVendor;
  $('#tModel').innerHTML = '<thead><tr><th>모델 / 품목군</th><th class="num">P/O</th><th class="num">대수 / 수량</th><th class="num">ERP</th><th class="num">업체</th><th class="num">업체−ERP</th><th class="num">입고 등록</th><th class="num">등록−ERP</th></tr></thead><tbody>' +
    b.map(x => `<tr class="${(hv && x.vendor !== x.erp) || x.staff !== x.erp ? 'bad' : ''}"><td>${esc(x.model)}</td><td class="num">${x.pos}</td><td class="num">${q(x)}</td><td class="num">${fmt(x.erp)}</td><td class="num">${hv ? fmt(x.vendor) : ''}</td><td class="num">${hv ? dc(x.vendor - x.erp) : ''}</td><td class="num">${fmt(x.staff)}</td><td class="num">${dc(x.staff - x.erp)}</td></tr>`).join('') +
    `<tr style="font-weight:700"><td>합계</td><td class="num">${t.pos}</td><td class="num">${fmt(t.qty)} 대</td><td class="num">${fmt(t.erp)}</td><td class="num">${hv ? fmt(t.vendor) : ''}</td><td class="num">${hv ? dc(t.vendor - t.erp) : ''}</td><td class="num">${fmt(t.staff)}</td><td class="num">${dc(t.staff - t.erp)}</td></tr></tbody>`;
}
function vtable(list, extra) { return list.length ? `<div class="tw" style="max-height:40vh"><table><thead><tr><th>시트</th><th class="num">행</th><th>구분</th><th>품번/모델</th><th>일자</th><th class="num">단가</th><th class="num">수량</th><th class="num">금액</th><th>${extra}</th></tr></thead><tbody>${list.map(v => `<tr><td>${esc(v.sheet)}</td><td class="num">${v.row}</td><td>${esc(v.vkind)}</td><td>${esc(v.code)}</td><td>${esc(v.date || v.rawDate)}</td><td class="num">${fmt(v.price)}</td><td class="num">${fmt(v.qty)}</td><td class="num">${fmt(v.amt)}</td><td class="small">${esc(v.why || v.note || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">해당 없음</div>'; }
function renderVen() {
  const r = S.closeRes;
  if (!r.summary.hasVendor) { $('#t-ven').innerHTML = '<div class="muted small" style="padding:18px">이번 대조에는 업체 명세서를 사용하지 않았습니다.</div>'; return; }
  $('#t-ven').innerHTML = `<h3 style="color:var(--bad)">① 업체 명세서에만 있는 행 (ERP에 해당 P/O 없음) — ${r.vOnly.length}건 ${fmt(r.vOnly.reduce((s, v) => s + v.amt, 0))}원</h3>${vtable(r.vOnly, '비고')}
  <h3 style="color:var(--warn)">② 명세서 내부 점검 (단가×수량, 대상월 밖 날짜, 일자 없음) — ${r.vChecks.length}건</h3>${vtable(r.vChecks, '점검 내용')}
  <h3 style="color:var(--mut)">③ 대조 제외 (금액 칸 비어 있음 — 전월 마감분 등) — ${r.vExcluded.length}건</h3>${vtable(r.vExcluded, '사유')}
  <div class="muted small" style="margin-top:8px">대조에 사용한 시트: ${esc(C.sel.join(', '))}</div>`;
}
function renderStf() {
  const r = S.closeRes, miss = r.rows.filter(x => !x.staffWhere);
  const st = list => list.length ? `<div class="tw" style="max-height:40vh"><table><thead><tr><th>담당</th><th>P/O No</th><th>입고일</th><th class="num">금액</th></tr></thead><tbody>${list.map(e => `<tr><td>${esc(e.sheet)}</td><td>${esc(e.po)}</td><td>${esc(e.date)}</td><td class="num">${fmt(e.amt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">해당 없음</div>';
  $('#t-stf').innerHTML = `<h3 style="color:var(--bad)">① 입고 등록됐지만 ERP 조회 파일에 없는 P/O — ${r.staffNoERP.length}건</h3><div class="muted small" style="margin-bottom:4px">P/O 오기재이거나 ERP 미입고 처리, 또는 ERP 조회 조건에서 빠진 품목입니다.</div>${st(r.staffNoERP)}
   <h3 style="color:var(--warn)">② ERP에는 있지만 입고 등록이 안 된 P/O — ${miss.length}건</h3>
   ${miss.length ? `<div class="tw" style="max-height:40vh"><table><thead><tr><th>P/O No</th><th>모델</th><th>ERP 입고일</th><th class="num">ERP 금액</th></tr></thead><tbody>${miss.map(x => `<tr><td>${esc(x.po)}</td><td>${esc(x.model)}</td><td>${esc(x.date)}</td><td class="num">${fmt(x.erpAmt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">해당 없음</div>'}
   <h3 style="color:var(--mut)">③ 대상월(${esc(r.summary.poPrefix)}…) 외 P/O로 등록된 건 — ${r.staffOther.length}건 (대조 제외)</h3>${st(r.staffOther.map(e => ({ ...e })))}`;
}
$('#tabs').onclick = e => { const t = e.target.dataset.t; if (!t) return; $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); ['po', 'model', 'ven', 'stf', 'hist'].forEach(k => $('#t-' + k).classList.toggle('hide', k !== t)); };
async function loadHist() {
  const { data } = await sb.from('pm_closings').select('month,vendor,locked,erp_amt,vendor_amt,staff_amt,ok,warn,bad,date_diff,erp_file,vendor_file,created_by_name,created_at').order('month', { ascending: false }).order('vendor').limit(60);
  $('#tHist').innerHTML = '<thead><tr><th>마감월</th><th>업체</th><th>상태</th><th class="num">ERP</th><th class="num">업체</th><th class="num">입고 등록</th><th class="num">일치</th><th class="num">확인</th><th class="num">불일치</th><th class="num">날짜차이</th><th>ERP 파일</th><th>업체 파일</th><th>확정자</th><th>일시</th></tr></thead><tbody>' +
    ((data || []).length ? data.map(h => `<tr><td>${esc(h.month)}</td><td>${esc(h.vendor)}</td><td><span class="tag ${h.locked ? 't-bad' : 't-mut'}">${h.locked ? '잠금' : '해제'}</span></td><td class="num">${fmt(h.erp_amt)}</td><td class="num">${fmt(h.vendor_amt)}</td><td class="num">${fmt(h.staff_amt)}</td><td class="num">${h.ok}</td><td class="num">${h.warn}</td><td class="num">${h.bad}</td><td class="num">${h.date_diff}</td><td class="small">${esc(h.erp_file || '')}</td><td class="small">${esc(h.vendor_file || '')}</td><td>${esc(h.created_by_name || '')}</td><td class="small nw">${esc(String(h.created_at).slice(0, 16).replace('T', ' '))}</td></tr>`).join('') : '<tr class="empty"><td colspan="14">마감 이력이 없습니다</td></tr>') + '</tbody>';
}
$('#btnClose').onclick = async () => {
  const r = S.closeRes, s = r.summary, m = s.month;
  if (r.vendor !== S.vendor) return toast('업체를 바꿨습니다. 대조를 다시 실행하세요', 1);
  if (m !== $('#cMonth').value && !confirm(`ERP 파일의 월(${m})과 선택한 마감월(${$('#cMonth').value})이 다릅니다. ${m}로 마감할까요?`)) return;
  if ((s.bad || s.warn) && !confirm(`불일치 ${s.bad}건, 확인필요 ${s.warn}건이 남아 있습니다. 그래도 ${m} 마감을 확정할까요?`)) return;
  if (!confirm(`${S.vendor} ${m} 마감을 확정하면 해당 업체·월 입고는 수정·삭제할 수 없게 잠깁니다 (관리자만 해제 가능). 진행할까요?`)) return;
  const row = { month: m, vendor: S.vendor, locked: true, erp_amt: s.erpAmt, vendor_amt: s.hasVendor ? s.vendorAmt : null, staff_amt: s.staffAmt, ok: s.ok, warn: s.warn, bad: s.bad, date_diff: s.dateDiff, summary: s, rows: r.rows, erp_file: C.erpName, vendor_file: s.hasVendor ? C.venName : null, created_by_name: S.prof.name };
  let res;
  if (C.closing && C.closing.month === m) res = await sb.from('pm_closings').update(row).eq('month', m).eq('vendor', S.vendor);
  else res = await sb.from('pm_closings').insert(row);
  if (res.error) return toast(krErr(res.error.message) + (C.closing ? ' (기존 마감 덮어쓰기는 관리자만 가능)' : ''), 1);
  toast(S.vendor + ' ' + m + ' 마감 확정'); $('#cMonth').value = m; loadCloseInfo();
};
$('#btnXls').onclick = () => {
  const r = S.closeRes, s = r.summary, wb = XLSX.utils.book_new();
  const B = { top: { style: 'thin', color: { rgb: 'B7C1D1' } }, bottom: { style: 'thin', color: { rgb: 'B7C1D1' } }, left: { style: 'thin', color: { rgb: 'B7C1D1' } }, right: { style: 'thin', color: { rgb: 'B7C1D1' } } };
  const HS = { font: { bold: true, color: { rgb: 'FFFFFF' }, name: '맑은 고딕', sz: 10 }, fill: { fgColor: { rgb: '1F3864' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: B };
  const FILL = { warn: 'FFF4D6', bad: 'FDE8E7' };
  function sheet(title, head, data, widths, nc) {
    const aoa = [[title], [], head, ...data]; const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: head.length - 1 } }];
    const TS = { font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' }, name: '맑은 고딕' }, fill: { fgColor: { rgb: '1F3864' } } };
    for (let c = 0; c < head.length; c++) { const a = XLSX.utils.encode_cell({ r: 0, c }); ws[a] = ws[a] || { t: 's', v: '' }; ws[a].s = TS; ws[XLSX.utils.encode_cell({ r: 2, c })].s = HS; }
    data.forEach((row, i) => row.forEach((v, c) => { const a = XLSX.utils.encode_cell({ r: i + 3, c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = { font: { name: '맑은 고딕', sz: 10 }, border: B, alignment: { vertical: 'top', wrapText: true, horizontal: nc.includes(c) ? 'right' : 'left' }, ...(FILL[row.__st] ? { fill: { fgColor: { rgb: FILL[row.__st] } } } : {}) }; if (nc.includes(c) && typeof v === 'number') ws[a].z = '#,##0'; }));
    ws['!cols'] = widths.map(w => ({ wch: w })); ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + data.length, c: head.length - 1 } }) };
    return ws;
  }
  const lab = { ok: '일치', warn: '확인필요', bad: '불일치' };
  const sum = [['ERP 입고 합계', s.erpAmt, `P/O ${s.erpPOs}건`], ['업체 명세서 합계', s.hasVendor ? s.vendorAmt : '미사용', s.hasVendor ? `ERP 대비 ${fmt(s.vendorAmt - s.erpAmt)}` : ''], ['입고 등록 합계(ERP P/O 해당분)', s.staffAmt, `P/O ${s.staffPOs}건 · ERP 대비 ${fmt(s.staffAmt - s.erpAmt)}`], ['일치 P/O', s.ok, `날짜만 다른 P/O ${s.dateDiff}건 포함`], ['확인필요 P/O', s.warn, ''], ['불일치 P/O', s.bad, ''], ['업체 명세서에만 있는 행', s.vOnly, ''], ['ERP에 없는 등록 P/O', s.staffNoERP, ''], [], ['ERP 파일', C.erpName, ''], ['업체 파일', s.hasVendor ? C.venName : '', C.sel.join(', ')], ['작성', S.prof.name + ' · ' + new Date().toLocaleString('ko-KR'), '']];
  XLSX.utils.book_append_sheet(wb, sheet(`${r.vendor} 월마감 입고 대사 — ${s.month}`, ['항목', '값', '비고'], sum, [32, 22, 60], [1]), '요약');
  const po = r.rows.map(x => { const a = [lab[x.status], x.model, x.po, x.date, x.dateNote, x.qty, x.erpAmt, x.staffAmt, x.staffDiff, x.vendorAmt, x.vendorDiff, x.staffWhere, x.issues]; a.__st = x.status; return a; });
  XLSX.utils.book_append_sheet(wb, sheet(`P/O별 대조 — ${s.month}`, ['상태', '모델', 'P/O No', 'ERP 입고일', '날짜 차이', '대수/수량', 'ERP 금액', '등록 금액', '등록−ERP', '업체 금액', '업체−ERP', '등록 담당', '확인 내용'], po, [9, 24, 13, 11, 18, 9, 14, 14, 11, 14, 11, 12, 46], [5, 6, 7, 8, 9, 10]), 'PO별대조');
  const bm = r.byModel.map(x => { const a = [x.model, x.pos, x.qty || null, x.unit || '', x.erp, s.hasVendor ? x.vendor : null, s.hasVendor ? x.vendor - x.erp : null, x.staff, x.staff - x.erp]; a.__st = (s.hasVendor && x.vendor !== x.erp) || x.staff !== x.erp ? 'bad' : 'ok'; return a; });
  XLSX.utils.book_append_sheet(wb, sheet('모델·품목군별 소계', ['모델/품목군', 'P/O', '대수/수량', '단위', 'ERP', '업체', '업체−ERP', '입고 등록', '등록−ERP'], bm, [24, 6, 10, 6, 16, 16, 12, 16, 12], [1, 2, 4, 5, 6, 7, 8]), '모델별');
  XLSX.writeFile(wb, `입고대사_${r.vendor}_${s.month}.xlsx`);
};

/* ================= 기준정보 ================= */
let selItem = null;
function renderMaster() {
  const adm = S.prof.role === 'admin';
  $('#mAdmHint').textContent = adm ? '이름·정렬·사용여부는 셀을 고친 뒤 [저장]' : '조회 전용 (수정은 관리자)';
  $('#tItems').innerHTML = '<thead><tr><th>코드</th><th>품목명</th><th>ERP 품번</th><th>구분</th><th>단위</th><th class="num">현재 단가</th><th>적용일</th><th class="num">정렬</th><th class="c">사용</th>' + (adm ? '<th></th>' : '') + '</tr></thead><tbody>' +
    vItems().map(i => { const p = S.prices.filter(x => x.code === i.code && x.valid_from <= today()).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]; return `<tr class="clk ${selItem === i.code ? 'sel' : ''}" data-c="${esc(i.code)}"><td class="nw">${esc(i.code)}</td><td>${adm ? `<input class="ie" data-k="name" value="${esc(i.name)}" style="width:100%">` : esc(i.name)}</td><td>${adm ? `<input class="ie" data-k="erp_part" value="${esc(i.erp_part || '')}" style="width:110px">` : esc(i.erp_part || '')}</td><td>${esc(i.category)}</td><td>${esc(i.unit)}</td><td class="num">${p ? fmt(p.price) : '<span class="err">없음</span>'}</td><td class="nw small">${p ? esc(p.valid_from) : ''}</td><td class="num">${adm ? `<input class="ie" data-k="sort" value="${i.sort}" style="width:50px;text-align:right">` : i.sort}</td><td class="c">${adm ? `<input type="checkbox" class="ie" data-k="active" ${i.active ? 'checked' : ''}>` : (i.active ? 'Y' : '')}</td>${adm ? '<td><button class="isave">저장</button></td>' : ''}</tr>`; }).join('') + '</tbody>';
  $('#tItems').querySelectorAll('tr.clk').forEach(tr => tr.onclick = e => { if (e.target.closest('input,button')) return; selItem = tr.dataset.c; $('#pCode').value = selItem; renderMaster(); });
  $('#tItems').querySelectorAll('.isave').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), code = tr.dataset.c, upd = {};
    tr.querySelectorAll('.ie').forEach(x => upd[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.dataset.k === 'sort' ? Number(x.value) || 0 : x.value.trim());
    const { error } = await sb.from('pm_items').update(upd).eq('code', code);
    if (error) return toast(krErr(error.message), 1); toast('품목 저장'); await loadRefs(); renderMaster();
  });
  $('#pCode').innerHTML = vItems().map(i => `<option value="${esc(i.code)}" ${i.code === selItem ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  if (!$('#pFrom').value) $('#pFrom').value = today();
  const vset = new Set(vItems().map(i => i.code)); const ps = S.prices.filter(p => vset.has(p.code) && (!selItem || p.code === selItem));
  $('#mPriceFor').textContent = selItem ? '— ' + (S.itemMap[selItem]?.name || selItem) : `— ${S.vendor} 전체 (품목을 누르면 해당 품목만)`;
  $('#tPrices').innerHTML = '<thead><tr><th>품목</th><th class="num">단가</th><th>적용일</th><th>비고</th>' + (adm ? '<th></th>' : '') + '</tr></thead><tbody>' +
    ps.map(p => `<tr><td>${esc(S.itemMap[p.code]?.name || p.code)}</td><td class="num">${fmt(p.price)}</td><td class="nw">${esc(p.valid_from)}${p.valid_from > today() ? ' <span class="tag t-date">예정</span>' : ''}</td><td class="small">${esc(p.note || '')}</td>${adm ? `<td><span class="x" data-pid="${p.id}">✕</span></td>` : ''}</tr>`).join('') + '</tbody>';
  $('#tPrices').querySelectorAll('[data-pid]').forEach(x => x.onclick = async () => { if (!confirm('이 단가 이력을 삭제할까요?')) return; const { error } = await sb.from('pm_prices').delete().eq('id', x.dataset.pid); if (error) return toast(krErr(error.message), 1); await loadRefs(); renderMaster(); });
  renderEngineMaster(); renderVendors(); renderBomMaster();
}
$('#pAdd').onclick = async () => {
  const row = { code: $('#pCode').value, price: Number($('#pPrice').value), valid_from: $('#pFrom').value, note: $('#pNote').value.trim() || null };
  if (!row.code || !(row.price >= 0) || $('#pPrice').value === '' || !row.valid_from) return toast('품목·단가·적용일을 입력하세요', 1);
  const { error } = await sb.from('pm_prices').upsert(row, { onConflict: 'code,valid_from' });
  if (error) return toast(krErr(error.message), 1);
  toast('단가 등록'); $('#pPrice').value = ''; $('#pNote').value = ''; selItem = row.code; await loadRefs(); renderMaster();
};
$('#mAddItem').onclick = async () => {
  const code = (prompt(`[${S.vendor}] 품목 코드 (시스템 내부 고유값, 예: Z60DC / BS-1303999)`) || '').trim(); if (!code) return;
  const erp_part = (prompt('ERP 품번 (예: 1303999GT)') || '').trim();
  const name = (prompt('품목명') || '').trim(); if (!name) return;
  const category = (prompt('구분: 모델 / 단품 / CWT', '모델') || '모델').trim();
  const unit = (prompt('단위: 대 / ea / kg', category === '모델' ? '대' : category === 'CWT' ? 'kg' : 'ea') || '대').trim();
  const nextSort = vItems().reduce((m, i) => Math.max(m, Number(i.sort) || 0), 0) + 1;
  const { error } = await sb.from('pm_items').insert({ code, name, category, unit, vendor: S.vendor, erp_part: erp_part || null, sort: nextSort });
  if (error) return toast(krErr(error.message), 1);
  toast('품목 추가 — 단가를 등록하세요'); selItem = code; await loadRefs(); renderMaster(); initItemFilters();
};
function initItemFilters() { $('#lItem').innerHTML = '<option value="">품목: 전체</option>' + vItems().map(i => `<option value="${esc(i.code)}">${esc(i.name)}</option>`).join(''); }
function renderEngineMaster() {
  const M = S.master;
  $('#master tbody').innerHTML = M.models.map((m, i) => `<tr>${['id', 'name', 'vendor', 'key', 'per', 'staff'].map(k => `<td><input data-i="${i}" data-k="${k}" value="${esc(m[k])}"></td>`).join('')}<td class="x adm" data-del="${i}">✕</td></tr>`).join('');
  $('#pgroups tbody').innerHTML = M.partGroups.map((g, i) => `<tr><td><input data-g="${i}" data-k="name" value="${esc(g.name)}"></td><td><input data-g="${i}" data-k="parts" value="${esc(g.parts)}"></td><td class="x adm" data-gdel="${i}">✕</td></tr>`).join('');
  $('#alias tbody').innerHTML = M.partAlias.map((a, i) => `<tr><td><input data-a="${i}" data-k="vendor" value="${esc(a.vendor)}"></td><td><input data-a="${i}" data-k="erp" value="${esc(a.erp)}"></td><td class="x adm" data-adel="${i}">✕</td></tr>`).join('');
  $('#sWin').value = M.settings.dayWindow;
}
function collectEngine() {
  const M = S.master;
  $$('#master input').forEach(x => { M.models[+x.dataset.i][x.dataset.k] = x.dataset.k === 'per' ? (Number(x.value) || 1) : x.value.trim(); });
  $$('#pgroups input').forEach(x => { M.partGroups[+x.dataset.g][x.dataset.k] = x.value.trim(); });
  $$('#alias input').forEach(x => { M.partAlias[+x.dataset.a][x.dataset.k] = x.value.trim(); });
  M.settings.dayWindow = Number($('#sWin').value) || 0;
}
$('#addModel').onclick = () => { collectEngine(); S.master.models.push({ id: '', name: '', vendor: '', key: '', per: 1, staff: '' }); renderEngineMaster(); };
$('#addGroup').onclick = () => { collectEngine(); S.master.partGroups.push({ name: '', parts: '' }); renderEngineMaster(); };
$('#addAlias').onclick = () => { collectEngine(); S.master.partAlias.push({ vendor: '', erp: '' }); renderEngineMaster(); };
$('#v-master').addEventListener('click', e => {
  const d = e.target.dataset; if (d.del == null && d.gdel == null && d.adel == null) return; collectEngine();
  if (d.del != null) S.master.models.splice(+d.del, 1); if (d.gdel != null) S.master.partGroups.splice(+d.gdel, 1); if (d.adel != null) S.master.partAlias.splice(+d.adel, 1);
  renderEngineMaster();
});
$('#mSave').onclick = async () => {
  collectEngine(); S.master.models = S.master.models.filter(m => m.id); S.master.partGroups = S.master.partGroups.filter(g => g.name);
  const { error } = await sb.from('pm_config').upsert({ id: 'master', data: S.master, updated_at: new Date().toISOString() });
  if (error) return toast(krErr(error.message), 1); toast('모델 마스터 저장'); renderEngineMaster();
};

let bomVer = null;
function renderBomMaster() {
  const vlist = vItems(), withBom = new Set(S.bom.map(b => b.item_code));
  $('#bItem').innerHTML = '<option value="">품목 선택</option>' + vlist.map(i => `<option value="${esc(i.code)}" ${i.code === selItem ? 'selected' : ''}>${esc(i.name)}${withBom.has(i.code) ? '' : ' (BOM 없음)'}</option>`).join('');
  const it = S.itemMap[selItem];
  if (!it) { $('#mBomFor').textContent = '품목을 고르거나 위 품목 표에서 행을 누르세요'; $('#mBomInfo').innerHTML = ''; $('#tBom').innerHTML = ''; return; }
  const rows = S.bom.filter(b => b.item_code === selItem);
  const vers = [...new Set(rows.map(b => b.valid_from))].sort().reverse();
  if (!vers.includes(bomVer)) bomVer = vers[0] || null;
  $('#mBomFor').textContent = '';
  if (!$('#bFrom').value) $('#bFrom').value = today();
  if (!vers.length) { $('#mBomInfo').innerHTML = '<span class="muted">등록된 BOM이 없습니다. 단품이면 BOM 없이 품목 자체가 1줄로 등록됩니다.</span>'; $('#tBom').innerHTML = ''; return; }
  const parts = rows.filter(b => b.valid_from === bomVer).sort((a, b) => a.seq - b.seq);
  const sum = parts.reduce((a, p) => a + Number(p.per_qty) * Number(p.unit_price), 0);
  const price = (S.prices.filter(p => p.code === selItem && p.valid_from <= bomVer).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] || {}).price;
  $('#mBomInfo').innerHTML = `적용일 <select id="bVer">${vers.map(v => `<option ${v === bomVer ? 'selected' : ''}>${v}</option>`).join('')}</select> · ${parts.length}품목 · BOM 합계 <b>${fmt(sum)}</b>원 ` +
    (price != null ? (Math.round(sum) === Number(price) ? `<span class="tag t-ok">단가표 ${fmt(price)} 일치</span>` : `<span class="tag t-bad">단가표 ${fmt(price)}와 ${fmt(sum - price)} 차이</span>`) : '');
  $('#bVer').onchange = () => { bomVer = $('#bVer').value; renderBomMaster(); };
  $('#tBom').innerHTML = '<thead><tr><th class="num">No</th><th>품번</th><th>품명</th><th class="num">대당수량</th><th class="num">단품단가</th><th class="num">대당 금액</th></tr></thead><tbody>' +
    parts.map(p => `<tr><td class="num muted">${p.seq}</td><td>${esc(p.part)}</td><td class="small">${esc(p.part_name || '')}</td><td class="num">${fmt(p.per_qty)}</td><td class="num">${fmt(p.unit_price)}</td><td class="num">${fmt(p.per_qty * p.unit_price)}</td></tr>`).join('') + '</tbody>';
}
let bomParsed = [];
$('#bItem').onchange = () => { selItem = $('#bItem').value || null; if (selItem) $('#pCode').value = selItem; renderMaster(); $('#bPaste').oninput(); };
$('#bPaste').oninput = () => {
  bomParsed = [];
  const lines = $('#bPaste').value.split(/\r?\n/).map(x => x.split('\t').map(c => c.trim())).filter(c => c.some(Boolean));
  const num = v => Number(String(v).replace(/,/g, ''));
  for (const c of lines) {
    let p;
    if (c.length >= 4) p = { part: c[0], name: c[1], per: num(c[2]), price: num(c[3]) };
    else if (c.length === 3) p = { part: c[0], name: '', per: num(c[1]), price: num(c[2]) };
    else continue;
    if (!p.part || !(p.per > 0) || isNaN(p.price)) continue;
    bomParsed.push(p);
  }
  const sum = bomParsed.reduce((a, p) => a + p.per * p.price, 0);
  const price = selItem ? priceFor(selItem, $('#bFrom').value) : null;
  $('#bPreview').innerHTML = bomParsed.length ? `${bomParsed.length}품목 인식 · 합계 <b>${fmt(sum)}</b>원` + (price != null ? (Math.round(sum) === price ? ` <span class="tag t-ok">적용일 단가 ${fmt(price)} 일치</span>` : ` <span class="tag t-bad">적용일 단가 ${fmt(price)}와 ${fmt(sum - price)} 차이</span>`) : '') : '<span class="muted">붙여넣은 내용에서 품번·대당수량·단가를 찾지 못했습니다</span>';
  $('#bSave').disabled = !bomParsed.length || !selItem;
};
$('#bFrom').onchange = () => $('#bPaste').oninput();
$('#bSave').onclick = async () => {
  const vf = $('#bFrom').value; if (!selItem || !vf || !bomParsed.length) return;
  const exists = S.bom.some(b => b.item_code === selItem && b.valid_from === vf);
  if (!confirm(`${S.itemMap[selItem].name} BOM ${bomParsed.length}품목을 적용일 ${vf}로 저장할까요?` + (exists ? '\n(같은 적용일 BOM이 있어 교체됩니다)' : ''))) return;
  if (exists) { const d = await sb.from('pm_bom').delete().eq('item_code', selItem).eq('valid_from', vf); if (d.error) return toast(krErr(d.error.message), 1); }
  const { error } = await sb.from('pm_bom').insert(bomParsed.map((p, i) => ({ item_code: selItem, valid_from: vf, seq: i + 1, part: p.part, part_name: p.name || null, per_qty: p.per, unit_price: p.price })));
  if (error) return toast(krErr(error.message), 1);
  toast('BOM 저장'); $('#bPaste').value = ''; $('#bPreview').innerHTML = ''; $('#bSave').disabled = true; bomVer = vf;
  await loadRefs(); renderMaster();
};
function renderVendors() {
  const adm = S.prof.role === 'admin';
  $('#tVendors tbody').innerHTML = S.vendors.map(v => `<tr data-v="${esc(v.name)}"><td>${esc(v.name)}</td><td><input class="ve" data-k="erp_code" value="${esc(v.erp_code || '')}"></td><td><input class="ve" data-k="sort" value="${v.sort}"></td><td class="c">${adm ? `<input type="checkbox" class="ve" data-k="active" ${v.active ? 'checked' : ''} style="width:auto">` : (v.active ? 'Y' : '')}</td><td>${adm ? '<button class="vsave">저장</button>' : ''}</td></tr>`).join('');
  $('#tVendors').querySelectorAll('.vsave').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), upd = {}; tr.querySelectorAll('.ve').forEach(x => upd[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.dataset.k === 'sort' ? Number(x.value) || 0 : x.value.trim() || null);
    const { error } = await sb.from('pm_vendors').update(upd).eq('name', tr.dataset.v); if (error) return toast(krErr(error.message), 1); toast('업체 저장'); await loadRefs(); renderMaster();
  });
}
$('#addVendor').onclick = async () => {
  const name = (prompt('업체명 (예: 아도)') || '').trim(); if (!name) return;
  const erp_code = (prompt('ERP 입고상세조회의 거래처 코드 (예: 1020)') || '').trim();
  const { error } = await sb.from('pm_vendors').insert({ name, erp_code: erp_code || null, sort: 50 });
  if (error) return toast(krErr(error.message), 1); toast('업체 추가 — 품목과 단가를 등록하세요'); await loadRefs(); renderMaster();
};

/* ================= 사용자 ================= */
async function loadUsers() {
  const { data } = await sb.from('pm_profiles').select('*').order('created_at');
  $('#tUsers').innerHTML = '<thead><tr><th>이름</th><th>이메일</th><th>권한</th><th class="c">승인</th><th>신청일</th><th></th></tr></thead><tbody>' +
    (data || []).map(u => `<tr data-u="${u.user_id}"><td><input class="ue" data-k="name" value="${esc(u.name)}"></td><td>${esc(u.email || '')}</td><td><select class="ue" data-k="role"><option value="staff" ${u.role === 'staff' ? 'selected' : ''}>담당자</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option></select></td><td class="c">${u.approved ? '<span class="tag t-ok">승인</span>' : '<span class="tag t-warn">대기</span>'}</td><td class="small">${esc(String(u.created_at).slice(0, 10))}</td><td class="nw">${u.user_id === S.user.id ? '<span class="muted small">본인</span>' : `${u.approved ? '<button class="ua" data-a="0">승인 취소</button>' : '<button class="ua pri" data-a="1">승인</button>'} <button class="us">저장</button>`}</td></tr>`).join('') + '</tbody>';
  $('#tUsers').querySelectorAll('.ua').forEach(b => b.onclick = async () => { const id = b.closest('tr').dataset.u; const { error } = await sb.from('pm_profiles').update({ approved: b.dataset.a === '1' }).eq('user_id', id); if (error) return toast(krErr(error.message), 1); toast('변경했습니다'); loadUsers(); });
  $('#tUsers').querySelectorAll('.us').forEach(b => b.onclick = async () => { const tr = b.closest('tr'), upd = {}; tr.querySelectorAll('.ue').forEach(x => upd[x.dataset.k] = x.value.trim()); const { error } = await sb.from('pm_profiles').update(upd).eq('user_id', tr.dataset.u); if (error) return toast(krErr(error.message), 1); toast('저장'); loadUsers(); });
}
})();
