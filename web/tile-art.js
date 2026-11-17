/* ============================================================
   TileArt — фоновый арт-слой клеток (тема «Бренди»)
   ------------------------------------------------------------
   API:
     TileArt.apply(state, boardData) — подставить арт по индексам 0..39;
       тема classic → арт снимается (clear), brands (или иная) → арт.
     TileArt.clear()               — снять арт со всех клеток.

   Арт — ТОЛЬКО фон клетки (CSS-переменная --tile-img + класс .has-art).
   Цены, владельцы, дома, фишки — реальные DOM-слои, остаются сверху.
   Никакой игровой логики.

   Ориентация арта выбирается по side-классу клетки (как sideClass()
   в app.js): bottom/top → portrait; left/right → landscape;
   corner → square. Если классов нет — по индексу:
   0/10/20/30 corner; 1–9 bottom; 11–19 left; 21–29 top; 31–39 right.

   Файлы берутся из tiles/manifest.json (маппинг position → файлы).
   Если файла нет (не загрузился) — класс не ставится, клетка
   остаётся в текущем виде (graceful fallback).
   ============================================================ */
(function () {
  'use strict';

  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';
  var BASE = SCRIPT_URL ? new URL('.', SCRIPT_URL).href : '';
  var MANIFEST_URL = BASE + 'tiles/manifest.json';

  /* side-класс клетки → ориентация арта */
  var SIDE_TO_ORIENTATION = {
    bottom: 'portrait',
    top: 'portrait',
    left: 'landscape',
    right: 'landscape',
    corner: 'square'
  };

  /* Мобильная оболочка из style.css — на узких экранах берём webp-вариант */
  var MOBILE_MEDIA = '(max-width: 980px)';

  var manifestPromise = null;   // Promise<Array|null>
  var imageOk = new Map();      // url -> Promise<boolean>
  var lastApply = null;         // { state, boardData }
  var mq = window.matchMedia ? window.matchMedia(MOBILE_MEDIA) : null;

  /* ---------- ориентация ---------- */

  function orientationByIndex(i) {
    if (i % 10 === 0) return 'square';   // 0, 10, 20, 30 — corner
    if (i < 10) return 'portrait';        // 1–9 — bottom
    if (i < 20) return 'landscape';       // 11–19 — left
    if (i < 30) return 'portrait';        // 21–29 — top
    return 'landscape';                   // 31–39 — right
  }

  function orientationFor(el, i) {
    if (el && el.classList) {
      for (var side in SIDE_TO_ORIENTATION) {
        if (Object.prototype.hasOwnProperty.call(SIDE_TO_ORIENTATION, side)
          && el.classList.contains(side)) {
          return SIDE_TO_ORIENTATION[side];
        }
      }
    }
    return orientationByIndex(i);
  }

  /* ---------- manifest ---------- */

  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(MANIFEST_URL, { cache: 'force-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .catch(function () { return null; });
    }
    return manifestPromise;
  }

  /* "tiles/desktop/portrait/x.png" → BASE + "tiles/portrait/x.png"
     "tiles/mobile/portrait/x.webp" → BASE + "tiles/mobile/portrait/x.webp"
     "tiles/icons/x.png"             → BASE + "tiles/icons/x.png" */
  function assetUrl(manifestPath) {
    if (!manifestPath || typeof manifestPath !== 'string') return null;
    var rel = manifestPath.replace(/^tiles\//, '').replace(/^desktop\//, '');
    return BASE + 'tiles/' + rel;
  }

  /* ---------- предзагрузка (graceful fallback) ---------- */

  function imageExists(url) {
    if (!url) return Promise.resolve(false);
    var cached = imageOk.get(url);
    if (!cached) {
      cached = new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(true); };
        img.onerror = function () { resolve(false); };
        img.src = url;
      });
      imageOk.set(url, cached);
    }
    return cached;
  }

  function applyToTile(el, url) {
    if (el.dataset.artUrl === url) return; // уже стоит
    imageExists(url).then(function (ok) {
      if (!ok || !el.isConnected) return; // файла нет — вид не меняем
      el.style.setProperty('--tile-img', 'url("' + url.replace(/"/g, '%22') + '")');
      el.classList.add('has-art');
      el.dataset.artUrl = url;
    });
  }

  /* ---------- публичное API ---------- */

  function clear() {
    lastApply = null;
    document.querySelectorAll('.tile.has-art').forEach(function (el) {
      el.classList.remove('has-art');
      el.style.removeProperty('--tile-img');
      delete el.dataset.artUrl;
    });
  }

  function apply(state, boardData) {
    var theme = (state && state.options && state.options.theme) || 'brands';
    if (theme === 'classic') { clear(); return; } // классика — без арта

    lastApply = { state: state, boardData: boardData };
    var els = document.querySelectorAll('#board .tile');
    if (!els.length) return;

    var boardLen = boardData && boardData.board ? boardData.board.length : 40;
    var wantMobile = mq ? mq.matches : false;

    loadManifest().then(function (manifest) {
      if (!manifest || !Array.isArray(manifest)) return;
      var byPos = new Map(manifest.map(function (e) { return [e.position, e]; }));

      els.forEach(function (el, idx) {
        var i = el.dataset && el.dataset.i != null ? parseInt(el.dataset.i, 10) : idx;
        if (!(i >= 0 && i < boardLen)) return;

        var entry = byPos.get(i);
        if (!entry) return; // нет в manifest — оставляем текущий вид

        var orientation = orientationFor(el, i);
        var files = (entry.files && entry.files[orientation]) || {};
        var path = wantMobile
          ? (files.mobile || files.desktop)
          : (files.desktop || files.mobile);
        var url = assetUrl(path);
        if (!url) return; // graceful fallback

        applyToTile(el, url);
      });
    });
  }

  /* При переходе через мобильный брейкпоинт перекладываем арт
     на webp/png-вариант последнего применённого состояния. */
  function watchMobile() {
    if (!mq) return;
    var onChange = function () {
      if (lastApply) apply(lastApply.state, lastApply.boardData);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  watchMobile();

  window.TileArt = { apply: apply, clear: clear };
})();
