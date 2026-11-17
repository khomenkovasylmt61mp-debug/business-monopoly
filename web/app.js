/* ================= Монополія — клієнт ================= */
'use strict';

const $ = (id) => document.getElementById(id);
const S = {
  code: null, token: null, pid: null, name: '',
  state: null, lastVersion: -1, screen: null,
  boardData: null, tab: 'mine', pollGen: 0,
  diceKey: '', overShown: null, myTurn: false,
  chatSeen: 0, chatUnread: 0, connected: true,
  clockOffset: 0, theme: null, tapped: false,
  turnLeft: 0, turnLeftAt: 0, prevPos: {}, casinoBet: 200,
};

const LS_SESSION = 'mono.session.v1';
const LS_NAME = 'mono.name';

/* ---------- утиліти ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₴';
const initials = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
function shade(hex, f = 0.72) {
  const h = String(hex || '#2c5fa8').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r}, ${g}, ${b})`;
}
function isLightColor(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 168;
}

function toast(text, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* ignore */ }
  if (!r.ok) throw new Error((j && j.error) || 'Сервер недоступний');
  return j;
}

function saveSession() {
  localStorage.setItem(LS_SESSION, JSON.stringify({
    code: S.code, token: S.token, pid: S.pid, name: S.name,
  }));
  localStorage.setItem(LS_NAME, S.name || '');
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (e) { return null; }
}
function clearSession() {
  localStorage.removeItem(LS_SESSION);
  S.code = S.token = S.pid = null; S.state = null; S.lastVersion = -1;
}

/* ---------- екрани ---------- */
function showScreen(name) {
  if (S.screen === name) return;
  S.screen = name;
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  const el = $('screen-' + name);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'game') requestAnimationFrame(fitBoard);
}

function fitBoard() {
  const b = $('board');
  if (b) b.style.setProperty('--bw', String(Math.round(b.clientWidth)));
}

/* ---------- модалки ---------- */
function openModal(html, opts) {
  const ov = $('overlay');
  ov.innerHTML = `<div class="modal ${(opts && opts.cls) || ''}">${html}</div>`;
  ov.classList.remove('hidden');
  ov.dataset.static = opts && opts.static ? '1' : '';
  ov.onclick = (e) => {
    if (e.target === ov && !ov.dataset.static) closeModal();
  };
  return ov.firstElementChild;
}
function closeModal() {
  const ov = $('overlay');
  ov.classList.add('hidden');
  ov.innerHTML = '';
}

/* ---------- хелпери ---------- */
function meP(st) { return (st || S.state).players.find((p) => p.id === S.pid) || null; }
function curP(st) { return (st || S.state).players.find((p) => p.id === (st || S.state).turn) || null; }
function playerById(st, id) { return st.players.find((p) => p.id === id) || null; }
function groupOf(tile) { return tile.group ? S.boardData.groups[tile.group] : null; }
function groupColor(tile) {
  const g = groupOf(tile);
  if (!g) return null;
  if (tile.type === 'rr') return '#3f3a33';
  if (tile.type === 'util') return '#6d675e';
  return g.color;
}
function groupTiles(key) { return S.boardData.groupTiles[key] || []; }
function ownsGroup(st, pid, key) {
  return groupTiles(key).every((i) => st.tiles[i].owner === pid);
}
function rentMult(st) { return ((st.options && st.options.rentMult) || 1) * (st.rentBoost || 1); }
const CITY_SVG = `<svg class="cp-city" viewBox="0 0 600 170" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="csky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c5f9e" stop-opacity="0"/>
      <stop offset=".45" stop-color="#5b93cf" stop-opacity=".62"/>
      <stop offset="1" stop-color="#f0cd74" stop-opacity=".95"/>
    </linearGradient>
    <linearGradient id="csil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0e2444"/>
      <stop offset="1" stop-color="#07152b"/>
    </linearGradient>
    <linearGradient id="criver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#245a90"/>
      <stop offset="1" stop-color="#0e2c50"/>
    </linearGradient>
  </defs>
  <rect width="600" height="170" fill="url(#csky)"/>
  <circle cx="470" cy="64" r="30" fill="#ffd97a" opacity=".12"/>
  <circle cx="470" cy="64" r="18" fill="#ffdf8f" opacity=".75"/>
  <g fill="url(#csil)" opacity=".88">
    <rect x="0" y="132" width="600" height="38"/>
    <rect x="18" y="112" width="24" height="58"/>
    <rect x="48" y="120" width="18" height="50"/>
    <rect x="72" y="104" width="28" height="66"/>
    <rect x="106" y="118" width="20" height="52"/>
    <rect x="132" y="96" width="30" height="74"/>
    <rect x="168" y="110" width="22" height="60"/>
    <rect x="196" y="88" width="34" height="82"/>
    <rect x="236" y="116" width="20" height="54"/>
    <rect x="262" y="100" width="28" height="70"/>
    <rect x="296" y="120" width="18" height="50"/>
    <rect x="320" y="92" width="26" height="78"/>
    <rect x="352" y="112" width="22" height="58"/>
    <rect x="380" y="100" width="30" height="70"/>
    <rect x="416" y="118" width="20" height="52"/>
    <rect x="442" y="94" width="28" height="76"/>
    <rect x="476" y="114" width="18" height="56"/>
    <rect x="500" y="104" width="26" height="66"/>
    <rect x="532" y="120" width="20" height="50"/>
    <rect x="558" y="108" width="28" height="62"/>
  </g>
  <g fill="url(#csil)">
    <path d="M120 150 q34 -30 68 0" fill="none" stroke="#0a1830" stroke-width="5"/>
    <path d="M215 150 q34 -30 68 0" fill="none" stroke="#0a1830" stroke-width="5"/>
    <path d="M310 150 q34 -30 68 0" fill="none" stroke="#0a1830" stroke-width="5"/>
    <rect x="110" y="148" width="290" height="5"/>
    <rect x="405" y="118" width="6" height="42"/>
    <rect x="401" y="110" width="14" height="8"/>
  </g>
  <g fill="#f6d27a" opacity=".5">
    <rect x="26" y="122" width="4" height="4"/><rect x="34" y="132" width="4" height="4"/>
    <rect x="78" y="114" width="4" height="4"/><rect x="88" y="124" width="4" height="4"/>
    <rect x="138" y="106" width="4" height="4"/><rect x="148" y="118" width="4" height="4"/>
    <rect x="202" y="100" width="4" height="4"/><rect x="212" y="112" width="4" height="4"/>
    <rect x="222" y="126" width="4" height="4"/><rect x="268" y="110" width="4" height="4"/>
    <rect x="278" y="122" width="4" height="4"/><rect x="326" y="104" width="4" height="4"/>
    <rect x="336" y="116" width="4" height="4"/><rect x="386" y="112" width="4" height="4"/>
    <rect x="396" y="124" width="4" height="4"/><rect x="448" y="104" width="4" height="4"/>
    <rect x="458" y="116" width="4" height="4"/><rect x="468" y="128" width="4" height="4"/>
    <rect x="506" y="114" width="4" height="4"/><rect x="516" y="126" width="4" height="4"/>
    <rect x="562" y="118" width="4" height="4"/><rect x="572" y="130" width="4" height="4"/>
  </g>
  <rect y="152" width="600" height="18" fill="url(#criver)" opacity=".9"/>
  <g stroke="#f3d489" stroke-width="2" opacity=".35">
    <line x1="120" y1="158" x2="150" y2="158"/>
    <line x1="210" y1="163" x2="250" y2="163"/>
    <line x1="330" y1="159" x2="360" y2="159"/>
    <line x1="430" y1="164" x2="470" y2="164"/>
  </g>
</svg>`;
const LOG_ICONS = {
  roll: '🎲', move: '👣', money: '💰', rent: '🏠', prop: '🏷', build: '🏗',
  mortgage: '🏦', auction: '🔨', trade: '🤝', jail: '🚔', card: '🎴',
  bankrupt: '💀', win: '🏆', turn: '➡️', join: '👋', leave: '👋', start: '🚀', debt: '⚠️',
  mission: '🎯',
};
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function dieHTML(v, anim) {
  const on = PIPS[v] || [];
  const pips = Array.from({ length: 9 }, (_, i) => `<i class="${on.includes(i + 1) ? 'on' : ''}"></i>`).join('');
  return `<div class="die ${anim ? 'rolled' : ''}" data-v="${v || 0}">${pips}</div>`;
}
function scaleFor(n) {
  const list = S.boardData.scales || [];
  for (const s of list) if (n <= s.max) return s;
  return list[list.length - 1] || { startMoney: 1500, houses: 32, hotels: 12, rent: 1 };
}

/* ================= ПОЛЕ ================= */
const tileEls = [];

function cellPos(i) {
  if (i === 0) return [11, 11];
  if (i < 10) return [11, 11 - i];
  if (i === 10) return [11, 1];
  if (i < 20) return [11 - (i - 10), 1];
  if (i === 20) return [1, 1];
  if (i < 30) return [1, 1 + (i - 20)];
  if (i === 30) return [1, 11];
  return [1 + (i - 30), 11];
}

function sideClass(i) {
  if (i === 0 || i === 10 || i === 20 || i === 30) return 'corner';
  if (i < 10) return 'bottom';
  if (i < 20) return 'left';
  if (i < 30) return 'top';
  return 'right';
}

const TILE_WBR = {
  "Медитеранська": "Медите<wbr>ранська",
  "Коннектикут": "Коннек<wbr>тикут",
  "Електромережа": "Електро<wbr>мережа",
  "Прибутковий податок": "Прибут<wbr>ковий податок",
  "Пенсильванія": "Пенсиль<wbr>ванія",
  "Сент-Чарльз": "Сент-<wbr>Чарльз",
  "Укрзалізниця": "Укр<wbr>залізниця",
  "Київводоканал": "Київ<wbr>водоканал",
  "ПриватБанк": "Приват<wbr>Банк",
};

function tileLabel(name) {
  if (name.includes('ʼ') || name.includes("'")) {
    return `<span class="nw">${esc(name)}</span>`;
  }
  return TILE_WBR[name] || esc(name);
}

function tileIcon(t) {
  if (t.icon) return t.icon;
  if (t.type === 'go') return '➜';
  if (t.type === 'jail') return '🚔';
  if (t.type === 'parking') return '🅿️';
  if (t.type === 'gotojail') return '👮';
  if (t.type === 'chance') return '❓';
  if (t.type === 'chest') return '🎁';
  if (t.type === 'tax') return '💸';
  if (t.type === 'casino') return '🎰';
  if (t.type === 'rr') return '🚂';
  if (t.type === 'util') return t.id === 12 ? '💡' : '🚰';
  return null;
}

function applyTheme(theme) {
  const key = theme === 'classic' ? 'classic' : 'brands';
  if (S.theme === key) return;
  S.theme = key;
  const t = (S.boardData.themes || {})[key];
  if (!t) return;
  S.boardData.board = t.board;
  S.boardData.groups = t.groups;
  rebuildBoard();
}

function rebuildBoard() {
  document.querySelectorAll('#board .tile').forEach((el) => el.remove());
  tileEls.length = 0;
  buildBoard();
  const b = $('board');
  b.style.setProperty('--bw', String(Math.round(b.clientWidth)));
}

function buildBoard() {
  const board = $('board');
  S.boardData.board.forEach((t, i) => {    const [row, col] = cellPos(i);
    const el = document.createElement('div');
    el.className = 'tile ' + sideClass(i) + ' t-' + t.type;
    el.style.gridArea = `${row} / ${col}`;
    el.dataset.i = i;
    const col2 = groupColor(t);
    let bar = '';
    if (col2) bar = `<div class="bar" style="background:${col2}"></div>`;
    const icon = tileIcon(t);
    const logo = t.logo
      ? `<img class="tile-logo" src="/logos/${t.logo}" alt="" draggable="false">`
      : '';
    const c = groupColor(t);
    const lightBg = c && ['#F5D547', '#8FD7F2', '#84CC16'].includes(c);
    let priceHtml = '';
    if (t.price) {
      priceHtml = `<div class="tile-price" style="--pc:${c || '#2c5fa8'};color:${lightBg ? '#1b2740' : '#fff'}">${t.price} ₴</div>`;
    } else if (t.type === 'tax') {
      priceHtml = `<div class="tile-price" style="--pc:#a83226;color:#fff">−${t.amount} ₴</div>`;
    }
    const sub = t.type === 'go' ? '+200 ₴'
      : t.type === 'jail' ? 'просто візит'
        : t.type === 'parking' ? 'безкоштовно' : '';
    const label = t.short || t.name;
    const longest = Math.max(...label.split(/[\s-]+/).map((w) => w.length));
    const body = `<div class="tile-body">
        ${logo || (icon ? `<div class="tile-ico">${icon}</div>` : '')}
        <div class="tile-name${longest > 10 ? ' long' : ''}">${tileLabel(label)}</div>
        ${sub ? `<div class="tile-sub">${sub}</div>` : ''}
      </div>`;
    el.innerHTML = `${bar}${body}${priceHtml}<div class="houses"></div><div class="owner-edge" hidden></div><div class="owner-dot" hidden></div>`;
    el.addEventListener('click', () => openTileInfo(i));
    board.insertBefore(el, $('tokenLayer'));
    tileEls[i] = el;
  });
}

function renderBoard(st) {
  const cur = curP(st);
  const occupied = new Set(st.players.filter((p) => !p.bankrupt).map((p) => p.pos));
  S.boardData.board.forEach((t, i) => {
    const el = tileEls[i];
    if (!el) return;
    const ts = st.tiles[i];
    el.classList.toggle('has-tokens', occupied.has(i));
    const owner = ts.owner ? playerById(st, ts.owner) : null;
    const dot = el.querySelector('.owner-dot');
    const edge = el.querySelector('.owner-edge');
    el.classList.toggle('owned', !!owner);
    if (owner) {
      el.style.setProperty('--own', owner.hex);
      dot.hidden = false;
      dot.textContent = owner.piece || '';
      dot.style.borderColor = owner.hex;
      dot.title = owner.name + (owner.pieceName ? ' · ' + owner.pieceName : '');
      if (edge) edge.hidden = false;
    } else {
      el.style.removeProperty('--own');
      dot.hidden = true;
      dot.textContent = '';
      if (edge) edge.hidden = true;
    }
    el.classList.toggle('mortgaged', !!ts.mortgaged);
    el.classList.toggle('hl', !!(cur && cur.pos === i));

    const hEl = el.querySelector('.houses');
    if (ts.houses === 5) {
      hEl.innerHTML = '<div class="hotel"></div>';
    } else if (ts.houses > 0) {
      hEl.innerHTML = new Array(ts.houses).fill('<div class="house"></div>').join('');
    } else {
      hEl.innerHTML = '';
    }
    const bar = el.querySelector('.bar');
    if (bar && t.type === 'street') {
      bar.style.background = ts.mortgaged ? '#a7a093' : groupColor(t);
    }
  });
  renderTokens(st);
  renderCenter(st);
}

function renderTokens(st) {
  const layer = $('tokenLayer');
  const prevPos = S.prevPos || {};
  layer.innerHTML = '';
  const byTile = new Map();
  st.players.forEach((p) => {
    if (p.bankrupt) return;
    if (!byTile.has(p.pos)) byTile.set(p.pos, []);
    byTile.get(p.pos).push(p);
  });
  byTile.forEach((list, idx) => {
    const [row, col] = cellPos(idx);
    const cell = document.createElement('div');
    const side = (idx === 0 || idx === 10) ? 'bottom' : (idx === 20 || idx === 30) ? 'top' : sideClass(idx);
    const corner = idx === 0 ? 'br' : idx === 10 ? 'bl' : idx === 20 ? 'tl' : idx === 30 ? 'tr' : '';
    cell.className = 'token-cell tok-' + side + (corner ? ' c-' + corner : '');
    cell.style.gridArea = `${row} / ${col}`;
    const stack = document.createElement('div');
    stack.className = 'token-stack';
    const ordered = [...list].sort((a, b) => {
      const pa = (a.id === st.turn ? 2 : 0) + (a.id === S.pid ? 1 : 0);
      const pb = (b.id === st.turn ? 2 : 0) + (b.id === S.pid ? 1 : 0);
      return pb - pa;
    });
    const shown = ordered.slice(0, 7);
    stack.dataset.n = String(shown.length);
    shown.forEach((p) => {
      const t = document.createElement('div');
      t.className = 'token' + (p.id === S.pid ? ' me' : '') + (st.turn === p.id ? ' active' : '');
      t.dataset.pid = p.id;
      t.textContent = p.piece || '';
      t.style.borderColor = p.hex;
      t.title = p.name + (p.pieceName ? ' · ' + p.pieceName : '');
      stack.appendChild(t);
    });
    if (list.length > shown.length) {
      const m = document.createElement('div');
      m.className = 'token token-more';
      m.textContent = '+' + (list.length - shown.length);
      m.title = 'Ще ' + (list.length - shown.length) + ' гравців';
      stack.appendChild(m);
    }
    cell.appendChild(stack);
    layer.appendChild(cell);
  });
  const nextPos = {};
  st.players.forEach((p) => { nextPos[p.id] = p.pos; });
  S.prevPos = nextPos;
  animateMoves(st, prevPos);
}

const MOVE_STEP_MS = 170;

function animateMoves(st, prevPos) {
  const layer = $('tokenLayer');
  if (!layer || !tileEls.length) return;
  const lr = layer.getBoundingClientRect();
  st.players.forEach((p) => {
    if (p.bankrupt) return;
    const old = prevPos[p.id];
    if (old == null || old === p.pos) return;
    const steps = (p.pos - old + 40) % 40;
    if (!steps || steps > 12) return;
    const real = layer.querySelector(`.token[data-pid="${p.id}"]`);
    const from = tileEls[old];
    if (!real || !from) return;
    const ghost = document.createElement('div');
    ghost.className = 'token token-ghost';
    ghost.textContent = p.piece || '';
    ghost.style.borderColor = p.hex;
    const place = (idx) => {
      const r = tileEls[idx].getBoundingClientRect();
      ghost.style.left = (r.left - lr.left + r.width / 2) + 'px';
      ghost.style.top = (r.top - lr.top + r.height / 2) + 'px';
    };
    place(old);
    layer.appendChild(ghost);
    real.style.visibility = 'hidden';
    let i = 0;
    const step = () => {
      i += 1;
      place((old + i) % 40);
      if (i < steps) {
        setTimeout(step, MOVE_STEP_MS);
      } else {
        setTimeout(() => {
          ghost.remove();
          const cur = layer.querySelector(`.token[data-pid="${p.id}"]`);
          if (cur) cur.style.visibility = '';
        }, MOVE_STEP_MS);
      }
    };
    setTimeout(step, 40);
  });
}

function renderCenter(st) {
  const el = $('boardCenter');
  const dice = st.dice;
  const key = dice ? dice.join('+') : '';
  const anim = key && key !== S.diceKey;
  S.diceKey = key;
  const cur = curP(st);
  const potOn = st.options && st.options.parkingPot;

  let line = '';
  if (st.phase === 'ended') {
    const w = st.winner ? playerById(st, st.winner) : null;
    line = w ? `🏆 ${w.name} перемагає` : 'Гру завершено';
  } else if (st.awaiting && st.awaiting.type === 'auction') {
    line = '🔨 Триває аукціон';
  } else if (cur && cur.debt) {
    line = `${cur.name} збирає гроші`;
  } else if (cur) {
    const aw = st.awaiting || {};
    const what = ({
      roll: 'кидає кубики', jail: 'у тюрмі', buy: 'вибирає клітинку',
      endturn: 'завершує хід', debt: 'рахує гроші',
    })[aw.type] || '';
    line = `Хід: ${cur.name}${what ? ' · ' + what : ''}`;
  }

  const events = [];
  st.log.forEach((l) => {
    if (l.kind === 'join' || l.kind === 'leave') return;
    events.push({ t: l.t, kind: l.kind, text: l.text });
  });
  st.chat.forEach((m) => {
    events.push({ t: m.t, kind: 'chat', name: m.name, color: m.color, text: m.text });
  });
  events.sort((a, b) => a.t - b.t);
  const items = events.slice(-40).map((e) => (e.kind === 'chat'
    ? `<div class="feed-item chat" style="border-left-color:${e.color}"><b style="color:${e.color}">${esc(e.name)}</b>${esc(e.text)}</div>`
    : `<div class="feed-item ${e.kind}"><span class="fi">${LOG_ICONS[e.kind] || '•'}</span><span>${esc(e.text)}</span></div>`)).join('');

  let card = '';
  if (st.lastCard && Date.now() / 1000 - (st.lastCard.t || 0) < 10) {
    card = `<div class="card-toast"><b>${esc(st.lastCard.title)}</b><span>${esc(st.lastCard.text)}</span></div>`;
  }

  el.innerHTML = `
    <div class="center-panel">
      <div class="cp-emblem">
        <div class="cp-title"><span>БІЗНЕС</span><b>МОНОПОЛІЯ</b></div>
        <div class="cp-sub">бренди · угоди · великі гроші</div>
      </div>
      <div class="cp-top">
        <div class="cp-banner">Події гри</div>
        <div class="cp-dice-wrap">
          <div class="cp-dice">
            ${dieHTML(dice ? dice[0] : 0, anim)}
            ${dieHTML(dice ? dice[1] : 0, anim)}
          </div>
          ${dice ? `<div class="cp-sum"><span>${dice[0]} + ${dice[1]} =</span><b>${dice[0] + dice[1]}</b></div>` : ''}
        </div>
      </div>
      <div class="cp-feed" id="cpFeed">${items || '<div class="feed-empty">Гра от-от почнеться…</div>'}</div>
      ${CITY_SVG}
      <div class="cp-foot">
        <span class="cp-line">${esc(line)}</span>
        <span class="turn-clock" id="turnClock"></span>
        <span class="cp-bank">🏠 ${st.housesLeft} · 🏨 ${st.hotelsLeft}${potOn ? ` · 🅿️ ${money(st.pot || 0)}` : ''}</span>
      </div>
      ${card}
      <div class="cp-ribbon"></div>
    </div>`;
  const feed = $('cpFeed');
  if (feed) feed.scrollTop = feed.scrollHeight;
  S.turnLeft = Number(st.turnLeft || 0);
  S.turnLeftAt = Date.now();
  clockTick();
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function clockTick() {
  const el = document.getElementById('turnClock');
  if (!el) return;
  const st = S.state;
  const total = Number(st && st.turnLeft) || 0;
  if (!total) { el.textContent = ''; el.classList.remove('warn'); return; }
  const left = Math.max(0, total - (Date.now() - (S.turnLeftAt || 0)) / 1000);
  el.textContent = '⏳ ' + fmtClock(left);
  el.classList.toggle('warn', left <= 10);
}

function openTileInfo(i) {
  const st = S.state;
  if (!st) return;
  const t = S.boardData.board[i];
  const ts = st.tiles[i];
  const owner = ts.owner ? playerById(st, ts.owner) : null;
  const group = groupOf(t);
  const rm = rentMult(st);
  const isProp = ['street', 'rr', 'util'].includes(t.type);
  const full = owner && t.group ? ownsGroup(st, owner.id, t.group) : false;
  const headColor = t.brandColor || groupColor(t) || '#1d3f6e';
  const headLight = isLightColor(headColor);

  const logo = t.logo
    ? `<img class="tc-logo" src="/logos/${t.logo}" alt="" draggable="false">`
    : `<div class="tc-emoji">${tileIcon(t) || '🏠'}</div>`;

  const row = (icon, label, value) => `<div class="tc-row"><span class="tc-ico">${icon}</span><span class="tc-lbl">${label}</span><b>${value}</b></div>`;
  let table = '';
  if (t.type === 'street') {
    const rows = [
      row('💰', 'Ціна', money(t.price)),
      row('🏠', 'Базова', money(Math.round(t.rent[0] * (full ? 2 : 1) * rm))),
    ];
    for (let k = 1; k <= 4; k++) {
      rows.push(row('🏘', `З ${k} будинк${k === 1 ? 'ом' : 'ами'}`, money(Math.round(t.rent[k] * rm))));
    }
    rows.push(row('🏨', 'Готель', money(Math.round(t.rent[5] * rm))));
    table = `<div class="tc-table">${rows.join('')}</div>`;
  } else if (t.type === 'rr') {
    const rows = [row('💰', 'Ціна', money(t.price))];
    for (let k = 1; k <= 4; k++) {
      rows.push(row('🚉', `${k} вокзал${k === 1 ? '' : 'и'}`, money(Math.round(t.rent[k - 1] * rm))));
    }
    table = `<div class="tc-table">${rows.join('')}</div>`;
  } else if (t.type === 'util') {
    table = `<div class="tc-table">
      ${row('💰', 'Ціна', money(t.price))}
      ${row('⚡', 'Одна компанія', '4 × кубики')}
      ${row('⚡', 'Дві компанії', '10 × кубики')}
    </div>`;
  }

  let desc = '';
  if (!isProp && t.type !== 'tax') {
    const texts = {
      go: 'Коли ви проходите або зупиняєтесь тут — отримуєте 200 ₴.',
      jail: 'Ви просто відвідуєте тюрму. Нічого не платите.',
      parking: 'Безкоштовна парковка. Відпочиньте від оренди.',
      gotojail: 'Перейдіть до тюрми. 200 ₴ за проходження СТАРТу не нараховується.',
      chance: 'Витягніть картку «Шанс» і виконайте її умову.',
      chest: 'Витягніть картку «Скарбниця» і виконайте її умову.',
    };
    desc = `<div class="tc-desc">${texts[t.type] || t.sub || ''}</div>`;
  } else if (t.type === 'tax') {
    desc = `<div class="tc-desc">Зупинка тут коштує ${money(t.amount)}. Гроші йдуть у банк.</div>`;
  }

  const status = ts.mortgaged ? 'заставлена'
    : ts.houses === 5 ? 'готель'
      : ts.houses ? `${ts.houses} буд.` : '';
  const ownerPiece = owner && owner.piece
    ? `<span class="tc-owner-piece" style="border-color:${owner.hex}">${owner.piece}</span>`
    : '';
  const ownerLine = isProp
    ? `<div class="tc-owner"><span>Власник</span><span class="tc-owner-val">${ownerPiece}${owner ? esc(owner.name) : 'Банк — можна купити'}</span></div>`
    : '';

  let foot = '';
  if (t.type === 'street') foot = `<div class="tc-foot"><span>🏗 ${owner ? 'Наступна філія' : 'Філія від'}</span><b>${owner && ts.houses >= 5 ? '—' : money(t.house * ((ts.houses || 0) + 1))}</b></div>`;
  else if (isProp) foot = `<div class="tc-foot"><span>🏦 Залог</span><b>${money(Math.floor(t.price / 2))}</b></div>`;
  else if (t.type === 'tax') foot = `<div class="tc-foot"><span>💸 До сплати</span><b>${money(t.amount)}</b></div>`;

  const html = `
    <div class="tc-card">
      <div class="tc-top${headLight ? ' light' : ''}" style="background:linear-gradient(150deg, ${headColor}, ${shade(headColor)})">
        <div class="tc-top-logo">${logo}</div>
        <div class="tc-top-txt">
          <span class="tc-kicker">${isProp ? 'Картка власності' : 'Клітинка поля'}</span>
          <span class="tc-name">${esc(t.name)}</span>
          <span class="tc-group">${esc(group ? group.name : (t.sub || ''))}${status ? ' · ' + status : ''}</span>
        </div>
      </div>
      ${isProp ? '<div class="tc-ribbon">картка власності</div>' : ''}
      <div class="tc-hero">${logo}</div>
      ${table}
      ${desc}
      ${ownerLine}
      ${foot}
      <div class="tc-ornament">✦</div>
      <button class="tc-close" onclick="window.__closeModal()">Закрити</button>
    </div>`;
  openModal(html, { cls: 'tc-modal' });
}
window.__closeModal = closeModal;

/* ================= ЛОБІ ================= */
function renderLobby(st) {
  $('lobbyCode').textContent = st.code;
  const link = `${location.origin}/?code=${st.code}`;
  $('shareLink').value = link;

  const isHost = st.host === S.pid;
  const wrap = $('lobbyPlayers');
  wrap.innerHTML = st.players.map((p) => `
    <div class="lobby-player">
      <span class="piece" style="background:${p.hex}22;border-color:${p.hex}">${p.piece || '•'}</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="tag">${p.pieceName ? esc(p.pieceName) : 'гравець'}</span>
      ${p.bot ? '<span class="tag">бот</span>' : ''}
      ${p.id === st.host ? '<span class="tag host">власник</span>' : ''}
      ${p.id === S.pid ? '<span class="tag">це ви</span>' : ''}
      ${isHost && p.id !== S.pid ? `<button class="mini-btn" data-kick="${p.id}">прибрати</button>` : ''}
    </div>`).join('') + (st.players.length === 0 ? '<div class="lobby-empty">Поки нікого</div>' : '');

  wrap.querySelectorAll('[data-kick]').forEach((b) => {
    b.onclick = () => act('kick', { pid: b.dataset.kick });
  });

  /* тема поля */
  const theme = (st.options && st.options.theme) || 'brands';
  $('themeChips').innerHTML = `
    <button class="chip-btn ${theme === 'brands' ? 'active' : ''}" data-theme="brands">Бренди</button>
    <button class="chip-btn ${theme === 'classic' ? 'active' : ''}" data-theme="classic">Класика</button>`;
  $('themeChips').querySelectorAll('[data-theme]').forEach((b) => {
    b.onclick = () => {
      if (!isHost) return toast('Змінює лише власник кімнати');
      act('set_theme', { theme: b.dataset.theme });
    };
  });

  /* режим правил */
  const mode = (st.options && st.options.mode) || 'company';
  $('modeChips').innerHTML = `
    <button class="chip-btn ${mode === 'company' ? 'active' : ''}" data-mode="company">Під компанію</button>
    <button class="chip-btn ${mode === 'classic' ? 'active' : ''}" data-mode="classic">Офіційні</button>`;
  $('modeChips').querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => {
      if (!isHost) return toast('Змінює лише власник кімнати');
      act('set_mode', { mode: b.dataset.mode });
    };
  });

  const n = st.players.length;
  const sc = mode === 'classic'
    ? { startMoney: 1500, houses: 32, hotels: 12, rent: 1, label: 'Офіційні правила' }
    : scaleFor(n);
  const timer = Number((st.options && st.options.turnTimer) || 0);
  $('timerChips').innerHTML = [[30, '30 с'], [60, '60 с'], [90, '90 с'], [0, 'Вимк']]
    .map(([v, l]) => `<button class="chip-btn ${timer === v ? 'active' : ''}" data-timer="${v}">${l}</button>`).join('');
  $('timerChips').querySelectorAll('[data-timer]').forEach((b) => {
    b.onclick = () => {
      if (!isHost) return toast('Змінює лише власник кімнати');
      act('set_timer', { value: Number(b.dataset.timer) });
    };
  });
  $('rulesPreview').innerHTML = `
    <div class="rv"><span>Гравців</span><b>${n}</b></div>
    <div class="rv"><span>Стартовий капітал</span><b>${money(sc.startMoney)}</b></div>
    <div class="rv"><span>Банк будинків</span><b>${sc.houses} / ${sc.hotels} готелів</b></div>
    <div class="rv"><span>Рента</span><b>×${sc.rent}</b></div>
    <div class="rv"><span>Динамічна рента</span><b>${mode === 'classic' ? 'вимкнена' : '+10% кожні 5 кіл'}</b></div>
    <div class="rv"><span>Таймер хода</span><b>${timer ? timer + ' с · штраф 100 ₴' : 'вимкнено'}</b></div>
    <div class="rv"><span>Аукціон при відмові</span><b>так</b></div>`;

  const park = !!(st.options && st.options.parkingPot);
  const pt = $('parkingToggle');
  pt.checked = park;
  pt.disabled = !isHost;
  pt.onchange = () => {
    if (!isHost) return;
    act('set_parking', { value: pt.checked });
  };

  $('addBotBtn').style.display = isHost ? '' : 'none';
  $('delBotBtn').style.display = isHost ? '' : 'none';
  $('addBotBtn').onclick = () => act('add_bot');
  $('delBotBtn').onclick = () => act('remove_bot');

  $('startBtn').style.display = isHost ? '' : 'none';
  $('startBtn').disabled = n < 2;
  $('lobbyHint').textContent = n < 2
    ? 'Потрібно щонайменше 2 гравці — кличте друзів за посиланням.'
    : (isHost ? 'Усі в зборі? Тисніть «Почати гру».' : 'Чекаємо, коли власник почне гру…');
}

/* ================= ГРА ================= */
function renderGame(st) {
  const lastChatId = st.chat.length ? st.chat[st.chat.length - 1].id : 0;
  if (S.tab !== 'chat' && lastChatId > S.chatSeen) {
    S.chatUnread += 1;
    S.chatSeen = lastChatId;
  }
  renderStrip(st);
  renderBoard(st);
  renderStatus(st);
  renderActions(st);
  renderTab(st);
  maybeGameOver(st);
  maybeVibrate(st);
}

function renderStrip(st) {
  const strip = $('playersStrip');
  strip.innerHTML = st.players.map((p) => `
    <div class="pcard ${st.turn === p.id ? 'active' : ''} ${p.bankrupt ? 'off' : ''} ${p.afk ? 'afk' : ''}" title="${esc(p.name)}">
      <div class="pav" style="background:${p.hex}22;border-color:${p.hex}">${p.piece || initials(p.name)}</div>
      <div class="pmeta">
        <div class="pname">${esc(p.name)}</div>
        <div class="pmoney">${money(p.money)}</div>
      </div>
      <div class="pbadges">
        ${p.jail && !p.bankrupt ? '<span>🚔</span>' : ''}
        ${p.credit ? '<span>💳</span>' : ''}
        ${p.afk ? '<span>💤</span>' : ''}
        ${p.cards > 0 ? `<span>🎟${p.cards}</span>` : ''}
      </div>
    </div>`).join('');
}

function renderStatus(st) {
  const el = $('status');
  const cur = curP(st);
  if (!cur) { el.innerHTML = ''; return; }
  const mine = cur.id === S.pid;
  const aw = st.awaiting || {};
  let sub = '';
  if (st.phase === 'ended') sub = 'гру завершено';
  else if (cur.debt) sub = `винен ${money(cur.debt.amount)}`;
  else if (st.auction) sub = 'аукціон';
  else {
    sub = ({
      roll: 'кидає кубики',
      jail: 'у тюрмі',
      buy: aw.tile != null ? `вирішує щодо «${S.boardData.board[aw.tile].name}»` : 'думає',
      endturn: 'завершує хід',
      debt: 'рахує гроші',
    })[aw.type] || '';
  }
  const total = st.players.filter((p) => !p.bankrupt).reduce((s, p) => s + p.money, 0);
  el.className = 'status' + (mine && st.phase === 'playing' ? ' mine' : '');
  el.innerHTML = `
    <div class="avatar" style="background:${cur.hex}22;border-color:${cur.hex}">${cur.piece || initials(cur.name)}</div>
    <div class="txt">
      <div class="t1">${mine ? 'Ваш хід' : 'Хід ' + esc(cur.name)}</div>
      <div class="t2">${esc(sub)} · на столі ${money(total)}</div>
    </div>`;
}

function renderActions(st) {
  const el = $('actions');
  el.innerHTML = '';
  const me = meP(st);
  const cur = curP(st);
  const aw = st.awaiting || {};

  if (st.phase === 'ended') {
    el.innerHTML = `
      <div class="action-card">
        <div class="ac-title">Партію завершено</div>
        <div class="ac-sub">${st.winner ? esc(playerById(st, st.winner).name) + ' забирає все' : 'Нічия'}</div>
      </div>`;
    el.appendChild(btn('Підсумки', 'gold', () => showGameOver(st)));
    if (st.host === S.pid) el.appendChild(btn('Нова гра', '', () => act('restart')));
    return;
  }

  if (st.trade && (st.trade.to === S.pid || st.trade.from === S.pid)) {
    el.appendChild(tradeCard(st));
  }

  if (st.auction) {
    el.appendChild(auctionCard(st));
    return;
  }

  if (me && me.debt) {
    const d = me.debt;
    const card = document.createElement('div');
    card.className = 'action-card debt';
    card.innerHTML = `
      <div class="ac-title">Борг ${money(d.amount)}</div>
      <div class="ac-sub">У вас ${money(me.money)}. Продайте будинки або заставте вулиці в розділі «Мої».</div>`;
    card.appendChild(btn('Мої володіння', 'gold', () => switchTab('mine')));
    card.appendChild(btn('Оголосити банкрутство', 'danger', () => confirmBankrupt()));
    el.appendChild(card);
    return;
  }

  if (aw.type === 'buy' && st.turn === S.pid) {
    const t = S.boardData.board[aw.tile];
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = `
      <div class="ac-title">${esc(t.name)}</div>
      <div class="ac-sub">${t.type === 'street' ? 'Вулиця' : t.type === 'rr' ? 'Вокзал' : 'Компанія'} · ${money(t.price)} · у вас ${money(me.money)}</div>`;
    const row = document.createElement('div');
    row.className = 'ac-row';
    row.appendChild(btn('Купити', 'primary', () => act('buy')));
    row.appendChild(btn('На аукціон', 'ghost', () => act('decline_buy')));
    card.appendChild(row);
    el.appendChild(card);
    return;
  }

  if (aw.type === 'pay_rent' && st.turn === S.pid) {
    const t = S.boardData.board[aw.tile] || { name: '' };
    const owner = playerById(st, aw.to);
    const card = document.createElement('div');
    card.className = 'action-card rent';
    card.innerHTML = `
      <div class="ac-title">Рента ${money(aw.amount)}</div>
      <div class="ac-sub">«${esc(t.name)}» · ${owner ? esc(owner.name) : 'банк'} · у вас ${money(me.money)}</div>`;
    el.appendChild(card);
    el.appendChild(btn(`Сплатити ${money(aw.amount)}`, 'primary big', () => act('pay_rent')));
    if (me.money < aw.amount) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Не вистачає грошей — продайте будинки або заставте майно в «Мої».';
      el.appendChild(hint);
    }
    return;
  }

  if (aw.type === 'casino' && st.turn === S.pid) {    if (![100, 200, 500].includes(S.casinoBet)) S.casinoBet = 200;
    const canBet = me.money >= S.casinoBet;
    const card = document.createElement('div');
    card.className = 'action-card casino';
    card.innerHTML = `
      <div class="ac-title">🎰 Казино</div>
      <div class="ac-sub">Ставка ${money(S.casinoBet)} · у вас ${money(me.money)}. Зеро — на користь банку.</div>`;
    const chips = document.createElement('div');
    chips.className = 'chips casino-chips';
    [100, 200, 500].forEach((v) => {
      const b = btn(money(v), v === S.casinoBet ? 'gold' : 'ghost', () => {
        S.casinoBet = v;
        renderActions(S.state);
      });
      b.disabled = me.money < v;
      chips.appendChild(b);
    });
    card.appendChild(chips);
    const row = document.createElement('div');
    row.className = 'ac-row casino-row';
    const red = btn('♥ Червоне', 'danger', () => act('casino_bet', { bet: S.casinoBet, color: 'red' }));
    const black = btn('♠ Чорне', 'dark', () => act('casino_bet', { bet: S.casinoBet, color: 'black' }));
    red.disabled = !canBet;
    black.disabled = !canBet;
    row.appendChild(red);
    row.appendChild(black);
    card.appendChild(row);
    el.appendChild(card);
    el.appendChild(btn('Пропустити', 'ghost', () => act('casino_skip')));
    return;
  }

  if (st.turn !== S.pid) {
    const card = document.createElement('div');
    card.className = 'action-card';
    const nxt = cur ? cur.name : '';
    card.innerHTML = `<div class="ac-title">Чекаємо ${esc(nxt)}</div>
      <div class="ac-sub">${st.dice ? 'Випало ' + st.dice[0] + ' + ' + st.dice[1] : 'Скоро продовжимо'}</div>`;
    el.appendChild(card);
    return;
  }

  /* мій хід */
  if (aw.type === 'roll') {
    if (st.doubles > 0) {
      const c = document.createElement('div');
      c.className = 'action-card';
      c.innerHTML = '<div class="ac-sub">Дубль — кидайте ще раз!</div>';
      el.appendChild(c);
    }
    el.appendChild(btn('🎲 Кинути кубики', 'primary big', () => act('roll')));
  } else if (aw.type === 'jail') {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = `<div class="ac-title">Ви в тюрмі</div>
      <div class="ac-sub">Сплатіть ${money(50)} або викиньте дубль. З третьої спроби доведеться платити.</div>`;
    el.appendChild(card);
    el.appendChild(btn('🎲 Кинути дубль', 'primary', () => act('roll')));
    const row = document.createElement('div');
    row.className = 'row';
    const b1 = btn('Застава 50 ₴', '', () => act('jail_pay'));
    b1.disabled = me.money < 50;
    row.appendChild(b1);
    if (me.cards > 0) row.appendChild(btn(`Картка (${me.cards})`, 'gold', () => act('jail_card')));
    el.appendChild(row);
  } else if (aw.type === 'endturn') {
    el.appendChild(btn('Завершити хід', 'primary big', () => act('end_turn')));
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Будинки, застава й обмін — у вкладці «Мої».';
    el.appendChild(hint);
  } else {
    el.appendChild(btn('Завершити хід', '', () => act('end_turn')));
  }
}

function btn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + (cls || '');
  b.textContent = label;
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, true); }
    finally { setTimeout(() => { b.disabled = false; }, 400); }
  };
  return b;
}

function auctionCard(st) {
  const a = st.auction;
  const t = S.boardData.board[a.tile];
  const card = document.createElement('div');
  card.className = 'action-card auction';
  const leader = a.leader ? playerById(st, a.leader) : null;
  const left = Math.max(0, Math.round((a.deadline || 0) - (Date.now() / 1000 + S.clockOffset)));
  const mine = a.turn === S.pid;
  card.innerHTML = `
    <div class="ac-title">🔨 Аукціон: ${esc(t.name)}</div>
    <div class="auc-bid">${money(a.bid)}</div>
    <div class="ac-sub">${leader ? 'Лідирує ' + esc(leader.name) : 'Ставок ще немає'} · ${left} с</div>
    <div class="auc-players">${st.players.filter((p) => a.active.includes(p.id)).map((p) =>
      `<span class="auc-p ${p.id === a.leader ? 'lead' : ''}">${esc(p.name)}</span>`).join('')}</div>`;

  if (mine) {
    const row = document.createElement('div');
    row.className = 'auc-row';
    const min = a.bid ? a.bid + 10 : 10;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = String(min);
    inp.min = String(min);
    inp.step = '10';
    row.appendChild(inp);
    row.appendChild(btn('Ставка', 'gold', async () => {
      const val = Number(inp.value);
      if (!val || val < min) throw new Error(`Мінімум ${min} ₴`);
      await act('bid', { amount: val });
    }));
    card.appendChild(row);
    card.appendChild(btn('Пас', 'ghost', () => act('auction_pass')));
  } else {
    const p = a.turn ? playerById(st, a.turn) : null;
    card.appendChild(Object.assign(document.createElement('div'), {
      className: 'ac-sub', textContent: p ? 'Зараз ставить ' + p.name : '',
    }));
  }
  return card;
}

function tradeCard(st) {
  const tr = st.trade;
  const from = playerById(st, tr.from);
  const to = playerById(st, tr.to);
  const mine = tr.to === S.pid;
  const names = (arr) => arr.map((i) => S.boardData.board[i].name).join(', ');
  const side = (o) => {
    const parts = [];
    if (o.money) parts.push(money(o.money));
    if (o.tiles.length) parts.push(names(o.tiles));
    return parts.length ? parts.join(' + ') : 'нічого';
  };
  const card = document.createElement('div');
  card.className = 'action-card';
  card.innerHTML = `
    <div class="ac-title">🤝 Обмін: ${esc(from.name)} → ${esc(to.name)}</div>
    <div class="ac-sub">Дає: ${esc(side(tr.give))}<br>Хоче: ${esc(side(tr.want))}</div>`;
  if (mine) {
    const row = document.createElement('div');
    row.className = 'ac-row';
    row.appendChild(btn('Прийняти', 'primary', () => act('trade_respond', { accept: true, trade_id: tr.id })));
    row.appendChild(btn('Відхилити', 'ghost', () => act('trade_respond', { accept: false, trade_id: tr.id })));
    card.appendChild(row);
  } else {
    card.appendChild(Object.assign(document.createElement('div'), {
      className: 'ac-sub', textContent: 'Чекаємо відповіді…',
    }));
    card.appendChild(btn('Скасувати', 'ghost', () => act('trade_cancel')));
  }
  return card;
}

/* ---------- вкладки ---------- */
function renderTab(st) {
  const body = $('tabBody');
  const wasTab = body.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === S.tab);
  });
  $('chatDot').classList.toggle('on', S.chatUnread > 0 && S.tab !== 'chat');

  if (S.tab === 'chat') {
    if (wasTab !== 'chat') {
      body.dataset.tab = 'chat';
      body.innerHTML = `<div class="chat-wrap">
        <div class="chat-list" id="chatList"></div>
        <div class="chat-input-row">
          <input id="chatInput" maxlength="300" placeholder="Повідомлення…" autocomplete="off">
          <button id="chatSend" class="btn primary">→</button>
        </div>
      </div>`;
      $('chatSend').onclick = sendChat;
      $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    }
    renderChat(st);
    return;
  }
  body.dataset.tab = S.tab;
  if (S.tab === 'mine') return renderMine(st, body);
  return renderLog(st, body);
}

function sendChat() {
  const inp = $('chatInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  act('chat', { text });
}

function renderChat(st) {
  const list = $('chatList');
  if (!list) return;
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
  list.innerHTML = st.chat.map((m) => `
    <div class="msg ${m.pid === S.pid ? 'mine' : ''}">
      <span class="nm" style="color:${m.color}">${esc(m.name)}</span>
      <span>${esc(m.text)}</span>
    </div>`).join('') || '<div class="empty-note">Поки тихо</div>';
  if (S.chatUnread > 0) { S.chatUnread = 0; $('chatDot').classList.remove('on'); }
  S.chatSeen = st.chat.length ? st.chat[st.chat.length - 1].id : 0;
  if (atBottom) list.scrollTop = list.scrollHeight;
}

function renderMine(st, body) {
  const me = meP(st);
  if (!me) { body.innerHTML = ''; return; }
  const order = Object.keys(S.boardData.groups);
  const owned = st.tiles.map((t, i) => ({ t, i }))
    .filter((x) => x.t.owner === S.pid)
    .sort((a, b) => order.indexOf(a.t.group) - order.indexOf(b.t.group));

  const rows = owned.map((x) => propRow(st, x.i, me)).join('');
  const cr = me.credit;
  const cool = me.creditCool || 0;
  const missions = me.missions || [];
  const missionBox = missions.length ? `
    <div class="mission-box">
      <div class="mb-title">🎯 Місії <span>секретні</span></div>
      ${missions.map((m) => `<div class="mb-item${m.done ? ' done' : ''}">
        <span>${m.done ? '✅' : '⬜'}</span><b>${esc(m.text)}</b><i>+${m.reward} ₴</i>
      </div>`).join('')}
    </div>` : '';
  const creditBox = `
    <div class="credit-box${cr ? ' active' : ''}">
      <div class="cb-main">
        <span>💳 Кредит</span>
        <b>${cr ? `${money(cr.due)} · ${cr.turns} ход.` : (cool > 0 ? `через ${cool} ход.` : '500 ₴ → 600 ₴ · 15 ход.')}</b>
      </div>
      ${cr
      ? `<button class="pc-btn" id="repayCredit" ${me.money < cr.due ? 'disabled' : ''}>Погасити ${money(cr.due)}</button>`
      : `<button class="pc-btn" id="takeCredit" ${cool > 0 ? 'disabled' : ''}>Взяти 500 ₴</button>`}
    </div>`;
  body.innerHTML = `
    <div class="mine-head">
      <div>
        <div class="prop-meta">Ваш капітал</div>
        <div class="mine-money">${money(me.money)}</div>
      </div>
      <div class="row">
        ${me.cards ? `<span class="tag">🎟 ${me.cards}</span>` : ''}
        <button class="btn tiny gold" id="tradeBtn" ${typeof st.tradeLeft === 'number' && st.tradeLeft <= 0 ? 'disabled' : ''}>Обмін${typeof st.tradeLeft === 'number' ? ` (${st.tradeLeft}/3)` : ''}</button>
      </div>
    </div>
    ${creditBox}
    ${missionBox}
    ${owned.length
    ? `<div class="prop-list">${rows}</div>`
    : `<div class="hand-empty"><div class="hand-empty-card">?</div><p>Рука порожня. Купуйте клітинки, на які потрапляєте, — і тут з’являться картки власності.</p></div>`}`;

  const tb = $('tradeBtn');
  if (tb) tb.onclick = openTrade;
  const takeB = $('takeCredit');
  if (takeB) takeB.onclick = () => act('take_credit');
  const repayB = $('repayCredit');
  if (repayB) repayB.onclick = () => act('repay_credit');
  body.querySelectorAll('[data-pact]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      b.disabled = true;
      try { await act(b.dataset.pact, { tile: Number(b.dataset.i) }); }
      finally { b.disabled = false; }
    };
  });
  body.querySelectorAll('[data-open]').forEach((row) => {
    row.onclick = () => openPropCard(Number(row.dataset.open));
  });
}

/* компактний рядок у «Мої» */
function propRow(st, i, me) {
  const info = propState(st, i, me);
  const t = info.t;
  const logo = t.logo
    ? `<img src="/logos/${t.logo}" alt="" draggable="false">`
    : `<span>${tileIcon(t) || '🏠'}</span>`;
  const color = t.brandColor || groupColor(t) || '#2c5fa8';
  const acts = info.acts.map((a) => `<button class="pc-btn" data-pact="${a.pact}" data-i="${i}" ${a.disabled ? 'disabled' : ''}>${a.label}</button>`).join('');
  const houses = info.ts.houses;
  const hBadge = houses === 5 ? '🏨' : houses ? `🏠×${houses}` : '';
  return `<div class="prop-row${info.ts.mortgaged ? ' mortgaged' : ''}" data-open="${i}" style="--row-color:${color}" title="Відкрити картку">
      <div class="pr-line">
        <span class="pr-logo" style="border-color:${color}">${logo}</span>
        <span class="pr-main">
          <b>${esc(t.name)}</b>
          <i>${info.status}</i>
        </span>
        ${hBadge ? `<span class="pr-houses">${hBadge}</span>` : ''}
        <span class="pr-val">${t.price ? money(t.price) : ''}</span>
      </div>
      ${acts ? `<div class="pr-acts">${acts}</div>` : ''}
    </div>`;
}

function openPropCard(i) {
  const st = S.state;
  const me = meP(st);
  if (!st || !me) return;
  const modal = openModal(`<div class="pc-modal">${propCard(st, i, me)}</div>
    <div class="modal-actions"><button class="btn ghost" id="pcClose">Закрити</button></div>`);
  modal.querySelector('#pcClose').onclick = closeModal;
  modal.querySelectorAll('[data-pact]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await act(b.dataset.pact, { tile: Number(b.dataset.i) }); closeModal(); }
      finally { b.disabled = false; }
    };
  });
}

function propState(st, i, me) {
  const t = S.boardData.board[i];
  const ts = st.tiles[i];
  const full = t.group ? ownsGroup(st, S.pid, t.group) : false;
  const groupHouses = t.group ? groupTiles(t.group).map((x) => st.tiles[x].houses) : [0];
  const rm = rentMult(st);
  const acts = [];

  if (t.type === 'street' && full && !ts.mortgaged) {
    const evenOk = ts.houses === Math.min(...groupHouses);
    const buildCost = t.house * (ts.houses + 1);
    const canBuild = ts.houses < 5 && evenOk && me.money >= buildCost;
    if (canBuild) {
      acts.push({ pact: 'build', label: `+ ${ts.houses === 4 ? 'Готель' : 'Дім'} ${money(buildCost)}` });
    }
    if (ts.houses > 0 && ts.houses === Math.max(...groupHouses)) {
      const paid = t.house * ts.houses;
      const back = st.options.mode === 'classic' ? paid / 2 : paid;
      acts.push({ pact: 'sell_house', label: `− Дім +${money(back)}` });
    }
  }
  const groupHasHouses = t.group ? groupTiles(t.group).some((x) => st.tiles[x].houses > 0) : false;
  if (!ts.mortgaged && !groupHasHouses) {
    acts.push({ pact: 'mortgage', label: `Залог +${money(Math.floor(t.price / 2))}` });
  } else if (ts.mortgaged) {
    const cost = Math.round(t.price * 0.55);
    acts.push({ pact: 'unmortgage', label: `Викуп ${money(cost)}`, disabled: me.money < cost });
  }

  let status = 'вільна';
  if (ts.mortgaged) status = ts.mortgageLeft ? `застава · ${ts.mortgageLeft} ход.` : 'застава';
  else if (ts.houses === 5) status = 'готель';
  else if (ts.houses) status = `${ts.houses} буд.`;
  else if (full) status = 'монополія';

  return { t, ts, full, groupHouses, rm, acts, status };
}

function propCard(st, i, me) {
  const { t, ts, full, groupHouses, rm, acts, status } = propState(st, i, me);
  const color = groupColor(t) || '#2c5fa8';
  const headColor = t.brandColor || color;
  const headLight = isLightColor(headColor);

  const row = (icon, label, value) => `<div class="pc-row"><span class="pc-ico">${icon}</span><span class="pc-lbl">${label}</span><b>${value}</b></div>`;
  const rows = [row('💰', 'Ціна', money(t.price))];
  if (t.type === 'street') {
    rows.push(row('🏠', 'Оренда', money(Math.round(t.rent[0] * (full ? 2 : 1) * rm))));
    for (let k = 1; k <= 4; k++) {
      rows.push(row('🏘', `З ${k} будинк${k === 1 ? 'ом' : 'ами'}`, money(Math.round(t.rent[k] * rm))));
    }
    rows.push(row('🏨', 'Готель', money(Math.round(t.rent[5] * rm))));
  } else if (t.type === 'rr') {
    const n = groupTiles('rr').filter((x) => st.tiles[x].owner === S.pid).length;
    for (let k = 1; k <= 4; k++) {
      rows.push(row('🚉', `${k} вокзал${k === 1 ? '' : 'и'}`, money(Math.round(t.rent[k - 1] * rm))));
    }
    if (n) rows.push(row('📦', 'Ваших вокзалів', String(n)));
  } else {
    const n = groupTiles('util').filter((x) => st.tiles[x].owner === S.pid).length;
    rows.push(row('⚡', 'Одна компанія', '4 × кубики'));
    rows.push(row('⚡', 'Дві компанії', '10 × кубики'));
    if (n) rows.push(row('🔌', 'Ваших компаній', String(n)));
  }

  const logo = t.logo
    ? `<img class="pc-logo" src="/logos/${t.logo}" alt="" draggable="false">`
    : `<div class="pc-emoji">${tileIcon(t) || '🏠'}</div>`;

  const foot = t.type === 'street'
    ? `<div class="pc-foot"><span>🏗 Наступна філія</span><b>${ts.houses >= 5 ? '—' : money(t.house * (ts.houses + 1))}</b></div>`
    : `<div class="pc-foot"><span>🏦 Залог</span><b>${money(Math.floor(t.price / 2))}</b></div>`;

  return `<div class="prop-card${ts.mortgaged ? ' mortgaged' : ''}">
      <div class="pc-set" style="background:${color}"></div>
      <div class="pc-head${headLight ? ' light' : ''}" style="background:linear-gradient(135deg, ${headColor}, ${shade(headColor)})">
        <div class="pc-head-txt">
          <span class="pc-kicker">Картка власності</span>
          <span class="pc-head-name">${esc(t.name)}</span>
        </div>
        <span class="pc-status">${status}</span>
      </div>
      <div class="pc-art"><div class="pc-logo-wrap">${logo}</div></div>
      <div class="pc-table">${rows.join('')}</div>
      ${foot}
      ${acts.length ? `<div class="pc-actions">${acts.map((a) => `<button class="pc-btn" data-pact="${a.pact}" data-i="${i}" ${a.disabled ? 'disabled' : ''}>${a.label}</button>`).join('')}</div>` : ''}
    </div>`;
}

function renderLog(st, body) {
  const items = st.log.slice(-60).reverse();
  body.innerHTML = `<div class="log">${items.map((l) => {
    const ico = LOG_ICONS[l.kind] || '•';
    return `<div class="log-entry ${l.kind}"><span class="ico">${ico}</span><span>${esc(l.text)}</span></div>`;
  }).join('') || '<div class="empty-note">Подій поки немає</div>'}</div>`;
}

/* ---------- обмін ---------- */
function openTrade() {
  const st = S.state;
  const others = st.players.filter((p) => p.id !== S.pid && !p.bankrupt);
  if (!others.length) return toast('Нікого кликати');
  let target = others[0].id;

  openModal(`
    <h2>Обмін</h2>
    <div class="sub">Виберіть гравця та майно. Будинки перед обміном треба продати.</div>
    <div class="chips" id="tradeWho"></div>
    <div class="trade-cols">
      <div class="trade-col"><h4>Ви віддаєте</h4><div id="giveList"></div>
        <div class="money-input"><input id="giveMoney" type="number" min="0" step="10" placeholder="0"><span>₴</span></div></div>
      <div class="trade-col"><h4>Ви отримуєте</h4><div id="wantList"></div>
        <div class="money-input"><input id="wantMoney" type="number" min="0" step="10" placeholder="0"><span>₴</span></div></div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="tradeCancel">Скасувати</button>
      <button class="btn primary" id="tradeSend">Запропонувати</button>
    </div>`);

  const renderWho = () => {
    $('tradeWho').innerHTML = others.map((p) =>
      `<button class="chip-btn ${p.id === target ? 'active' : ''}" data-who="${p.id}">${esc(p.name)}</button>`).join('');
    $('tradeWho').querySelectorAll('[data-who]').forEach((b) => {
      b.onclick = () => { target = b.dataset.who; renderWho(); renderLists(); };
    });
  };
  const renderLists = () => {
    const mine = st.tiles.map((t, i) => ({ t, i })).filter((x) => x.t.owner === S.pid);
    const theirs = st.tiles.map((t, i) => ({ t, i })).filter((x) => x.t.owner === target);
    const list = (arr) => arr.map((x) => {
      const blocked = S.boardData.board[x.i].group && groupTiles(S.boardData.board[x.i].group).some((g) => st.tiles[g].houses > 0);
      return `<label class="trade-item"><input type="checkbox" value="${x.i}" ${blocked ? 'disabled' : ''}>
        <span>${esc(S.boardData.board[x.i].name)}</span>
        ${blocked ? '<span class="prop-meta">(будинки)</span>' : ''}</label>`;
    }).join('') || '<div class="prop-meta">Порожньо</div>';
    $('giveList').innerHTML = list(mine);
    $('wantList').innerHTML = list(theirs);
  };
  renderWho();
  renderLists();

  $('tradeCancel').onclick = closeModal;
  $('tradeSend').onclick = async () => {
    const give = [...$('giveList').querySelectorAll('input:checked')].map((x) => Number(x.value));
    const want = [...$('wantList').querySelectorAll('input:checked')].map((x) => Number(x.value));
    const gm = Number($('giveMoney').value || 0);
    const wm = Number($('wantMoney').value || 0);
    if (!give.length && !want.length && !gm && !wm) return toast('Виберіть хоч щось', true);
    closeModal();
    await act('trade_propose', {
      to: target, give: { tiles: give, money: gm }, want: { tiles: want, money: wm },
    });
  };
}

/* ---------- фінал ---------- */
function maybeGameOver(st) {
  if (st.phase !== 'ended') return;
  if (S.overShown === st.startedAt) return;
  S.overShown = st.startedAt;
  showGameOver(st);
}

function showGameOver(st) {
  const list = [...st.players].sort((a, b) => {
    if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
    return b.money - a.money;
  });
  const props = (p) => st.tiles.filter((t) => t.owner === p.id).length;
  openModal(`
    <h2>Партію завершено</h2>
    <div class="sub">${st.winner ? 'Переможець: ' + esc(playerById(st, st.winner).name) : 'Переможця немає'}</div>
    <div>
      ${list.map((p, n) => `<div class="winner-row">
        <span class="place">${n + 1}</span>
        <span class="piece small" style="background:${p.hex}22;border-color:${p.hex}">${p.piece || ''}</span>
        <span class="nm">${esc(p.name)}${p.id === S.pid ? ' <span class="badge-me">(ви)</span>' : ''}</span>
        <span class="prop-meta">${props(p)} кл.</span>
        <span class="val">${money(p.money)}</span>
      </div>`).join('')}
    </div>
    <div class="final-missions">
      ${st.players.map((p) => `<div class="fm-row"><b>${esc(p.name)}</b><span>${(p.missions || []).map((m) => `${m.done ? '✅' : '⬜'} ${esc(m.text)}`).join(' · ') || '—'}</span></div>`).join('')}
    </div>
    <div class="modal-actions">
      ${st.host === S.pid ? '<button class="btn primary" id="restartBtn">Нова гра</button>' : ''}
      <button class="btn ghost" onclick="window.__closeModal()">Закрити</button>
    </div>`, { static: true });
  const rb = $('restartBtn');
  if (rb) rb.onclick = () => { closeModal(); act('restart'); };
}

function confirmBankrupt() {
  openModal(`
    <h2>Оголосити банкрутство?</h2>
    <div class="sub">Усе майно перейде кредитору або банку, ви вийдете з гри.</div>
    <div class="modal-actions">
      <button class="btn ghost" onclick="window.__closeModal()">Скасувати</button>
      <button class="btn danger" id="yesBankrupt">Так, здаюся</button>
    </div>`);
  $('yesBankrupt').onclick = () => { closeModal(); act('bankrupt'); };
}

/* ---------- вібрація ---------- */
function maybeVibrate(st) {
  const mine = st.phase === 'playing' && st.turn === S.pid && st.awaiting &&
    ['roll', 'jail', 'buy', 'endturn', 'debt'].includes(st.awaiting.type) && !st.auction;
  if (mine && !S.myTurn) {
    if (navigator.vibrate && S.tapped) navigator.vibrate([70, 50, 70]);
    document.title = '● Ваш хід — Бізнес-Монополія';
  }
  if (!mine) document.title = 'Бізнес-Монополія — ' + (st.code || '');
  S.myTurn = !!mine;
}

/* ---------- дії ---------- */
async function act(type, extra) {
  try {
    await api('/api/action', { code: S.code, token: S.token, action: Object.assign({ type }, extra || {}) });
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

/* ---------- опитування ---------- */
async function startPolling() {
  const gen = ++S.pollGen;
  while (gen === S.pollGen && S.code) {
    try {
      const r = await fetch(`/api/state?code=${encodeURIComponent(S.code)}&token=${encodeURIComponent(S.token)}&since=${S.lastVersion}`, { cache: 'no-store' });
      if (gen !== S.pollGen) return;
      if (r.status === 400 || r.status === 404 || r.status === 401) {
        let j = {};
        try { j = await r.json(); } catch (e) { /* ignore */ }
        const had = !!S.state;
        clearSession();
        if (had) toast(j.error || 'Кімнату закрито', true);
        showScreen('home');
        return;
      }
      if (!r.ok) throw new Error('bad status');
      const st = await r.json();
      if (gen !== S.pollGen) return;
      S.connected = true;
      applyState(st);
    } catch (e) {
      if (gen !== S.pollGen) return;
      if (S.connected) { S.connected = false; toast('Звʼязок втрачено, перепідключаємось…', true); }
      await sleep(1200);
    }
  }
}

function applyState(st) {
  if (S.state && st.version === S.lastVersion) return;
  S.lastVersion = st.version;
  S.state = st;
  if (st.updated) S.clockOffset = st.updated - Date.now() / 1000;
  if (st.options && st.options.theme) applyTheme(st.options.theme);

  if (st.phase === 'lobby') {
    showScreen('lobby');
    renderLobby(st);
    return;
  }
  showScreen('game');
  renderGame(st);
}

/* ---------- сесія ---------- */
function useSession(code, token, pid, name) {
  S.code = code; S.token = token; S.pid = pid; S.name = name;
  S.lastVersion = -1; S.state = null; S.overShown = null;
  saveSession();
  startPolling();
}

/* ---------- події ---------- */
function wire() {
  document.addEventListener('pointerdown', () => { S.tapped = true; }, { once: true });
  $('createBtn').onclick = async () => {
    const name = $('nameInput').value.trim();
    if (!name) return toast('Як вас звати?', true);
    try {
      const r = await api('/api/create', { name });
      history.replaceState(null, '', location.pathname);
      useSession(r.code, r.token, r.playerId, name);
    } catch (e) { toast(e.message, true); }
  };
  $('joinBtn').onclick = joinByCode;
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
  $('nameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { $('codeInput').value ? joinByCode() : $('createBtn').click(); }
  });
  $('codeInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('startBtn').onclick = () => act('start');
  $('copyCodeBtn').onclick = $('copyLinkBtn').onclick = copyLink;
  $('leaveLobbyBtn').onclick = async () => {
    try { await act('leave'); } catch (e) { /* ignore */ }
    S.pollGen++;
    clearSession();
    showScreen('home');
  };

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    switchTab(b.dataset.tab);
  });

  $('menuBtn').onclick = openMenu;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.code && !S.connected) {
      S.pollGen++;
      startPolling();
    }
  });

  window.addEventListener('resize', fitBoard);
}

function joinByCode() {
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim().toUpperCase();
  if (!name) return toast('Як вас звати?', true);
  if (code.length < 4) return toast('Код із 5 символів', true);
  api('/api/join', { code, name }).then((r) => {
    history.replaceState(null, '', location.pathname);
    useSession(r.code, r.token, r.playerId, name);
  }).catch((e) => toast(e.message, true));
}

function copyLink() {
  const link = `${location.origin}/?code=${S.code || ''}`;
  const done = () => toast('Посилання скопійовано');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
  } else fallbackCopy(link, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Скопіюйте вручну: ' + text, true); }
  ta.remove();
}

function switchTab(tab) {
  S.tab = tab;
  if (tab === 'chat') { S.chatUnread = 0; $('chatDot').classList.remove('on'); }
  if (S.state) renderTab(S.state);
}

function openMenu() {
  const st = S.state || {};
  openModal(`
    <h2>Меню</h2>
    <div class="kv"><span>Кімната</span><span>${esc(st.code || '')}</span></div>
    <div class="kv"><span>Ви</span><span>${esc(S.name || '')}</span></div>
    <div class="kv"><span>Режим</span><span>${st.options && st.options.mode === 'classic' ? 'Офіційні правила' : 'Під компанію'}</span></div>
    <div class="row" style="gap:8px">
      <button class="btn wide" id="mCopy">Скопіювати посилання</button>
      <button class="btn wide ghost" id="mRules">Правила</button>
    </div>
    <div class="modal-actions">
      ${st.host === S.pid && st.phase === 'playing' && curP(st) && curP(st).id !== S.pid && !st.auction
      ? `<button class="btn" id="mSkip">Пропустити хід (${esc(curP(st).name)})</button>` : ''}
      <button class="btn danger" id="mLeave">Вийти з гри</button>
      <button class="btn ghost" onclick="window.__closeModal()">Закрити</button>
    </div>`);
  $('mCopy').onclick = copyLink;
  $('mRules').onclick = showRules;
  const ms = $('mSkip');
  if (ms) ms.onclick = () => {
    const nm = curP(st).name;
    openModal(`
      <h2>Пропустити хід?</h2>
      <div class="sub">${esc(nm)} не ходить — передати хід далі?</div>
      <div class="modal-actions">
        <button class="btn ghost" onclick="window.__closeModal()">Скасувати</button>
        <button class="btn primary" id="skipYes">Пропустити</button>
      </div>`);
    $('skipYes').onclick = () => { closeModal(); act('skip_turn'); };
  };
  $('mLeave').onclick = () => {
    openModal(`
      <h2>Вийти з гри?</h2>
      <div class="sub">Якщо партія триває, ви збанкрутуєте й вийдете.</div>
      <div class="modal-actions">
        <button class="btn ghost" onclick="window.__closeModal()">Залишитись</button>
        <button class="btn danger" id="leaveYes">Вийти</button>
      </div>`);
    $('leaveYes').onclick = async () => {
      try { await act('leave'); } catch (e) { /* ignore */ }
      S.pollGen++;
      clearSession();
      closeModal();
      showScreen('home');
    };
  };
}

function showRules() {
  const st = S.state || {};
  const sc = scaleFor(st.players ? st.players.length : 4);
  openModal(`
    <h2>Коротко про правила</h2>
    <div class="sub">Класична Монополія за офіційними правилами</div>
    <div class="kv"><span>Старт</span><span>${money(st.options ? st.options.startMoney || 1500 : 1500)}</span></div>
    <div class="kv"><span>Проходження СТАРТу</span><span>+200 ₴</span></div>
    <div class="kv"><span>Дубль</span><span>кидаєте ще раз, три дублі — тюрма</span></div>
    <div class="kv"><span>Купівля</span><span>відмова — аукціон серед усіх</span></div>
    <div class="kv"><span>Монополія</span><span>уся кольорова група — подвійна рента, можна будувати</span></div>
    <div class="kv"><span>Будинки</span><span>будуються рівномірно, 4 будинки → готель</span></div>
    <div class="kv"><span>Застава</span><span>50% ціни, викуп 55%, рента не сплачується</span></div>
    <div class="kv"><span>Тюрма</span><span>застава 50 ₴, картка або дубль</span></div>
    <div class="kv"><span>Кінець</span><span>коли залишився один гравець</span></div>
    <div class="kv"><span>Під компанію</span><span>старт ${money(sc.startMoney)}, банк ${sc.houses}/${sc.hotels}, рента ×${sc.rent}</span></div>
    <div class="kv"><span>Динамічна рента</span><span>+10% кожні 5 кіл (крім «Офіційних»)</span></div>
    <div class="kv"><span>Банк на парковці</span><span>необовʼязкове правило: штрафи збираються в центрі</span></div>
    <div class="modal-actions"><button class="btn" onclick="window.__closeModal()">Зрозуміло</button></div>`);
}

/* ---------- старт ---------- */
async function boot() {
  try {
    S.boardData = await fetch('/api/board').then((r) => r.json());
  } catch (e) {
    document.body.innerHTML = '<p style="padding:40px;font:16px system-ui">Сервер недоступний. Запустіть python server.py</p>';
    return;
  }
  buildBoard();
  wire();
  fitBoard();
  setInterval(clockTick, 250);
  if (window.ResizeObserver) {
    new ResizeObserver(fitBoard).observe($('board'));
  }
  const saved = loadSession();
  const url = new URL(location.href);
  const codeParam = (url.searchParams.get('code') || '').toUpperCase();
  if (codeParam) $('codeInput').value = codeParam;
  if (saved && codeParam && saved.code !== codeParam) {
    clearSession();
  }
  if (saved && saved.code && saved.token && (!codeParam || saved.code === codeParam)) {
    S.name = saved.name || '';
    useSession(saved.code, saved.token, saved.pid, saved.name || '');
  } else {
    $('nameInput').value = localStorage.getItem(LS_NAME) || '';
    if (codeParam) $('codeInput').focus(); else $('nameInput').focus();
  }
}

boot();
