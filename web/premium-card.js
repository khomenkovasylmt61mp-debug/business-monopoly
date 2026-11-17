/* ============================================================
   ПРЕМІУМ-КАРТКА ОБ'ЄКТА — окремий модуль
   Залежить від глобальних функцій app.js:
   openModal, closeModal, money, esc, act, S, playerById, groupTiles,
   ownsGroup, rentMult, groupColor, tileIcon, meP, openTrade.
   Публічний API: window.PremiumCard.open(st, idx)
   ============================================================ */
(function () {
  'use strict';

  var TYPE_LABELS = {
    street: 'Вулиця',
    rr: 'Вокзал',
    util: 'Комунальна компанія',
    go: 'СТАРТ',
    jail: 'Тюрма',
    parking: 'Парковка',
    gotojail: 'Прямуй до тюрми',
    chance: 'Шанс',
    chest: 'Скарбниця',
    tax: 'Податок',
    casino: 'Казино',
  };

  function safeColor(value, fallback) {
    var s = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\([\d\s.,%]+\)$/i.test(s)) return s;
    return fallback;
  }

  function formatNumber(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '1';
    return n.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
  }

  function housesLabel(count) {
    var n = Math.max(0, Math.min(5, Number(count) || 0));
    if (n === 5) return 'Готель';
    if (n === 1) return '1 будинок';
    if (n > 1) return n + ' будинки';
    return 'Без забудови';
  }

  function stationsLabel(count) {
    var n = Math.max(1, Math.min(4, Number(count) || 1));
    return n === 1 ? '1 вокзал' : n + ' вокзали';
  }

  function countOwned(state, groupKey, playerId) {
    return groupTiles(groupKey).filter(function (i) {
      return state.tiles[i] && state.tiles[i].owner === playerId;
    }).length;
  }

  function statusInfo(ts, full, owner) {
    var houses = Number(ts.houses) || 0;
    if (ts.mortgaged) {
      return {
        tone: 'mortgaged',
        text: ts.mortgageLeft ? 'Застава · ' + ts.mortgageLeft + ' ход.' : 'У заставі',
      };
    }
    if (houses >= 5) return { tone: 'hotel', text: 'Готель' };
    if (houses > 0) return { tone: 'built', text: housesLabel(houses) };
    if (full) return { tone: 'monopoly', text: 'Монополія' };
    if (owner) return { tone: 'owned', text: 'У власності' };
    return { tone: 'free', text: 'Вільна' };
  }

  function rentRows(state, t, ts, owner, displayFull) {
    var rmRaw = Number(rentMult(state));
    var rm = Number.isFinite(rmRaw) ? rmRaw : 1;
    var rows = [];
    var rent = Array.isArray(t.rent) ? t.rent : [];

    if (t.type === 'street') {
      if (rent[0] != null) {
        rows.push({
          label: 'Базова оренда',
          value: money(Math.round(rent[0] * (displayFull ? 2 : 1) * rm)),
          tier: 0,
          note: displayFull ? '×2' : '',
        });
      }
      for (var k = 1; k <= 4; k++) {
        if (rent[k] == null) continue;
        rows.push({
          label: housesLabel(k),
          value: money(Math.round(rent[k] * rm)),
          tier: k,
          note: '',
        });
      }
      if (rent[5] != null) {
        rows.push({
          label: 'Готель',
          value: money(Math.round(rent[5] * rm)),
          tier: 5,
          note: '',
        });
      }
    } else if (t.type === 'rr') {
      for (var s = 1; s <= 4; s++) {
        if (rent[s - 1] == null) continue;
        rows.push({
          label: stationsLabel(s),
          value: money(Math.round(rent[s - 1] * rm)),
          tier: s,
          note: '',
        });
      }
    } else if (t.type === 'util') {
      rows.push({ label: '1 компанія', value: '4 × кубики', tier: 1, note: '' });
      rows.push({ label: '2 компанії', value: '10 × кубики', tier: 2, note: '' });
    }

    var houses = Number(ts.houses) || 0;
    var currentTier = null;
    if (owner && !ts.mortgaged) {
      if (t.type === 'street') currentTier = houses;
      else if (t.type === 'rr') currentTier = countOwned(state, 'rr', owner.id);
      else if (t.type === 'util') currentTier = countOwned(state, 'util', owner.id);
    }
    rows.forEach(function (row) {
      row.current = currentTier != null && row.tier === currentTier;
    });

    return { rows: rows, rm: rm };
  }

  function rentNote(t, displayFull, rm) {
    var parts = [];
    if (t.type === 'street') {
      if (displayFull) parts.push('базова ×2 за монополію');
      if (rm !== 1) parts.push('множник ×' + formatNumber(rm));
    } else if (t.type === 'rr') {
      parts.push('залежить від кількості вокзалів');
      if (rm !== 1) parts.push('множник ×' + formatNumber(rm));
    } else if (t.type === 'util') {
      parts.push('4 × сума кубиків');
      if (rm !== 1) parts.push('множник ×' + formatNumber(rm));
    }
    if (!parts.length) parts.push('ставки з поля');
    return parts.join(' · ');
  }

  function actionsFor(state, t, ts, me, isMine, groupHouses, myFull, groupHasHouses) {
    var acts = [];
    if (!me || !isMine) return acts;

    var houses = Number(ts.houses) || 0;

    if (t.type === 'street' && myFull && !ts.mortgaged) {
      var evenOk = houses === Math.min.apply(null, groupHouses);
      var buildCost = Number(t.house) * (houses + 1);
      var canBuild = houses < 5 && evenOk && Number(me.money) >= buildCost;
      if (canBuild) {
        acts.push({
          type: 'build',
          label: 'Побудувати (' + money(buildCost) + ')',
          primary: true,
        });
      }
      if (houses > 0 && houses === Math.max.apply(null, groupHouses)) {
        var paid = Number(t.house) * houses;
        var back = (state.options && state.options.mode === 'classic') ? paid / 2 : paid;
        acts.push({
          type: 'sell_house',
          label: 'Продати дім (+' + money(back) + ')',
          ghost: true,
        });
      }
    }

    if (t.price != null) {
      if (!ts.mortgaged && !groupHasHouses) {
        acts.push({
          type: 'mortgage',
          label: 'Залог (+' + money(Math.floor(t.price / 2)) + ')',
          ghost: true,
        });
      } else if (ts.mortgaged) {
        var cost = Math.round(t.price * 0.6);
        var poor = Number(me.money) < cost;
        acts.push({
          type: 'unmortgage',
          label: 'Викуп (' + money(cost) + ')',
          primary: true,
          disabled: poor,
          title: poor ? 'Недостатньо коштів' : '',
        });
      }
    }

    return acts;
  }

  function actionHint(t, ts, me, isMine, acts, myFull, groupHouses, groupHasHouses, owner) {
    if (!isMine) {
      return owner
        ? 'Керування доступне лише власнику.'
        : 'Банк — придбати можна під час свого ходу.';
    }

    var houses = Number(ts.houses) || 0;
    if (t.type === 'street' && !ts.mortgaged && houses < 5) {
      if (!myFull) return 'Для будівництва потрібна повна група.';
      var evenOk = houses === Math.min.apply(null, groupHouses);
      if (!evenOk) return 'Щоб будувати, вирівняйте кількість будинків у групі.';
      var cost = Number(t.house) * (houses + 1);
      if (Number.isFinite(cost) && Number(me.money) < cost) {
        return 'Недостатньо коштів на наступну філію: ' + money(cost) + '.';
      }
    }
    if (acts.length) return '';
    if (groupHasHouses) {
      return myFull
        ? 'Спочатку продайте будинки в цій групі — тоді відкриється застава.'
        : 'Застава недоступна, поки в групі є будинки.';
    }
    return 'Зараз доступних дій немає.';
  }

  function open(st, idx) {
    var state = st || (typeof S !== 'undefined' ? S.state : null);
    if (!state || !state.tiles || !state.players) return;
    if (typeof S === 'undefined' || !S.boardData || !Array.isArray(S.boardData.board)) return;

    var tileIndex = Number(idx);
    var t = S.boardData.board[tileIndex];
    var ts = state.tiles[tileIndex];
    if (!t || !ts) return;

    var isProp = t.type === 'street' || t.type === 'rr' || t.type === 'util';
    var owner = ts.owner != null && ts.owner !== '' ? playerById(state, ts.owner) : null;
    var me = meP(state);
    var isMine = !!(owner && me && owner.id === S.pid);
    var houses = Number(ts.houses) || 0;

    var accent = safeColor(groupColor(t), '#D9B66B');
    var ownerHex = safeColor(owner && owner.hex, '#B99A5E');

    var groupHouses = t.group
      ? groupTiles(t.group).map(function (i) {
        return Number(state.tiles[i] && state.tiles[i].houses) || 0;
      })
      : [0];
    if (!groupHouses.length) groupHouses = [0];

    var myFull = !!(isMine && t.group && ownsGroup(state, S.pid, t.group));
    var displayFull = !!(owner && t.group && ownsGroup(state, owner.id, t.group));
    var groupHasHouses = !!(t.group && groupTiles(t.group).some(function (i) {
      return state.tiles[i] && (Number(state.tiles[i].houses) || 0) > 0;
    }));

    var acts = isProp ? actionsFor(state, t, ts, me, isMine, groupHouses, myFull, groupHasHouses) : [];
    var hint = isProp ? actionHint(t, ts, me, isMine, acts, myFull, groupHouses, groupHasHouses, owner) : '';

    var badge = isProp ? statusInfo(ts, displayFull, owner) : null;
    var rent = isProp ? rentRows(state, t, ts, owner, displayFull) : { rows: [], rm: 1 };
    var rows = rent.rows;

    /* ---------- шапка ---------- */
    var typeLabel = TYPE_LABELS[t.type] || t.sub || 'Клітинка';
    var metaLabel = t.type === 'street'
      ? 'Кольорова група'
      : t.type === 'rr'
        ? 'Вокзальна мережа'
        : t.type === 'util'
          ? 'Комунальна мережа'
          : (t.sub || 'Клітинка поля');

    var logo = t.logo
      ? '<img class="lux-logo-img" src="/logos/' + encodeURIComponent(t.logo) +
        '" alt="" draggable="false" decoding="async">'
      : '';
    var fallbackIcon = tileIcon(t) ||
      (t.name ? String(t.name).trim().charAt(0).toUpperCase() : '◆');

    var priceValue = t.price != null ? t.price : (t.amount != null ? t.amount : null);
    var priceLabel = t.price != null ? 'Ціна об\'єкта' : 'До сплати';
    var priceHtml = priceValue != null
      ? '<div class="lux-price">' +
          '<span class="lux-price-label">' + priceLabel + '</span>' +
          '<strong class="lux-price-value">' + money(priceValue) + '</strong>' +
        '</div>'
      : '';

    var badgeHtml = badge
      ? '<span class="lux-badge is-' + badge.tone + '">' + esc(badge.text) + '</span>'
      : '';

    var stampHtml = ts.mortgaged
      ? '<span class="lux-stamp">У заставі</span>'
      : '';

    var headerHtml =
      '<header class="lux-head">' +
        '<div class="lux-head-top">' +
          '<span class="lux-kicker">Бізнес-Монополія · Картка об\'єкта</span>' +
          badgeHtml +
        '</div>' +
        '<div class="lux-identity">' +
          '<div class="lux-logo-plate' + (ts.mortgaged ? ' is-mortgaged' : '') + '">' +
            '<span class="lux-logo-fallback"' + (t.logo ? ' hidden' : '') + '>' + esc(fallbackIcon) + '</span>' +
            logo +
            stampHtml +
          '</div>' +
          '<div class="lux-titles">' +
            '<span class="lux-type">' + esc(typeLabel) + '</span>' +
            '<h1 class="lux-title" id="luxCardTitle">' + esc(t.name) + '</h1>' +
            '<div class="lux-meta">' +
              '<span class="lux-swatch" aria-hidden="true"></span>' +
              '<span>' + esc(metaLabel) + '</span>' +
              (isProp
                ? '<span class="lux-meta-dot" aria-hidden="true"></span><span>оренда</span>'
                : '') +
            '</div>' +
          '</div>' +
          priceHtml +
        '</div>' +
      '</header>';

    /* ---------- власник ---------- */
    var ownerHtml = '';
    if (isProp) {
      if (owner) {
        var tags = [];
        if (owner.id === S.pid) tags.push('<span class="lux-tag is-me">Це ви</span>');
        if (owner.bankrupt) tags.push('<span class="lux-tag is-bankrupt">Банкрут</span>');
        ownerHtml =
          '<div class="lux-owner">' +
            '<span class="lux-owner-avatar" style="--lux-owner:' + esc(ownerHex) + '">' +
              (window.pieceHTML ? window.pieceHTML(owner.piece, 'lux-piece-img') : esc(owner.piece || '•')) +
            '</span>' +
            '<span class="lux-owner-text">' +
              '<span class="lux-owner-label">Власник</span>' +
              '<strong class="lux-owner-name">' + esc(owner.name) + '</strong>' +
              (tags.length ? '<span class="lux-owner-tags">' + tags.join('') + '</span>' : '') +
            '</span>' +
            '<span class="lux-owner-balance">' +
              '<span>Баланс</span>' +
              '<b>' + money(owner.money) + '</b>' +
            '</span>' +
          '</div>';
      } else {
        ownerHtml =
          '<div class="lux-owner">' +
            '<span class="lux-owner-avatar is-bank" aria-hidden="true">🏦</span>' +
            '<span class="lux-owner-text">' +
              '<span class="lux-owner-label">Власник</span>' +
              '<strong class="lux-owner-name">Банк — можна купити</strong>' +
            '</span>' +
          '</div>';
      }
    }

    /* ---------- факти ---------- */
    var facts = [];
    if (isProp && t.price != null) {
      facts.push({ label: 'Застава', value: money(Math.floor(t.price / 2)) });
      facts.push({ label: 'Викуп', value: money(Math.round(t.price * 0.6)) });
    }
    if (isProp && t.type === 'street' && t.house != null) {
      facts.push({
        label: 'Наступна філія',
        value: houses >= 5 ? '—' : money(Number(t.house) * (houses + 1)),
      });
    } else if (isProp && t.type === 'rr' && owner) {
      facts.push({ label: 'У власника', value: countOwned(state, 'rr', owner.id) + ' з 4' });
    } else if (isProp && t.type === 'util' && owner) {
      facts.push({ label: 'У власника', value: countOwned(state, 'util', owner.id) + ' з 2' });
    }

    var factsHtml = facts.length
      ? '<div class="lux-facts">' + facts.map(function (f) {
        return '<div class="lux-fact"><span>' + esc(f.label) + '</span><b>' + f.value + '</b></div>';
      }).join('') + '</div>'
      : '';

    /* ---------- забудова ---------- */
    var estateHtml = '';
    if (isProp && t.type === 'street' && houses > 0) {
      var units = '';
      if (houses >= 5) {
        units = '<span class="lux-hotel" aria-hidden="true"></span>';
      } else {
        for (var h = 0; h < houses; h++) {
          units += '<span class="lux-house" aria-hidden="true"></span>';
        }
      }
      estateHtml =
        '<div class="lux-estate">' +
          '<div class="lux-estate-copy">' +
            '<span>Забудова</span>' +
            '<b>' + esc(housesLabel(houses)) + '</b>' +
          '</div>' +
          '<div class="lux-estate-visual">' + units + '</div>' +
        '</div>';
    }

    /* ---------- рента ---------- */
    var rentHtml = '';
    if (isProp && rows.length) {
      var rowHtml = rows.map(function (row) {
        return '<li class="lux-rent-row' + (row.current ? ' is-current' : '') + '"' +
          (row.current ? ' aria-current="true"' : '') + '>' +
          '<span class="lux-rent-label">' + esc(row.label) +
            (row.note ? '<span class="lux-rent-note">' + esc(row.note) + '</span>' : '') +
          '</span>' +
          '<span class="lux-rent-dots" aria-hidden="true"></span>' +
          '<span class="lux-rent-value">' + esc(row.value) + '</span>' +
        '</li>';
      }).join('');

      var mortgageAlert = ts.mortgaged
        ? '<div class="lux-alert">Об\'єкт у заставі — оренда не нараховується.' +
          (ts.mortgageLeft ? ' Залишилось ходів: ' + esc(ts.mortgageLeft) + '.' : '') +
          '</div>'
        : '';

      rentHtml =
        '<section class="lux-section lux-rent" aria-labelledby="luxRentTitle">' +
          '<div class="lux-section-head">' +
            '<h2 class="lux-section-title" id="luxRentTitle">Оренда</h2>' +
            '<span class="lux-section-note">' + esc(rentNote(t, displayFull, rent.rm)) + '</span>' +
          '</div>' +
          '<ul class="lux-rent-list" aria-label="Таблиця оренди">' + rowHtml + '</ul>' +
          mortgageAlert +
          '<p class="lux-note">' +
            (t.type === 'util'
              ? 'Оренда залежить від суми кубиків; множник застосовується до результату.'
              : 'Ставки з картки поля.') +
          '</p>' +
        '</section>';
    } else if (!isProp) {
      rentHtml =
        '<p class="lux-desc">' +
          esc(t.sub || 'Ця клітинка не є об\'єктом власності.') +
        '</p>';
    }

    /* ---------- дії ---------- */
    var actionHtml = '';
    var mainButtons = acts.map(function (a, i) {
      var cls = 'lux-btn';
      if (a.primary) cls += ' is-primary';
      if (a.ghost) cls += ' is-ghost';
      if (acts.length === 1) cls += ' is-wide';
      return '<button type="button" class="' + cls + '" data-lux-act="' + a.type + '"' +
        (a.disabled ? ' disabled aria-disabled="true"' : '') +
        (a.title ? ' title="' + esc(a.title) + '"' : '') +
        '>' + esc(a.label) + '</button>';
    }).join('');

    var tradeButton = isMine
      ? '<button type="button" class="lux-btn is-ghost" data-lux-act="trade">Обмін</button>'
      : '';
    var closeButton = '<button type="button" class="lux-btn is-quiet" data-lux-act="close">Закрити</button>';

    if (isProp) {
      actionHtml =
        '<section class="lux-actions' + (isMine ? '' : ' is-single') + '" aria-label="Дії з об\'єктом">' +
          (hint ? '<p class="lux-hint">' + esc(hint) + '</p>' : '') +
          (mainButtons ? '<div class="lux-act-main">' + mainButtons + '</div>' : '') +
          '<div class="lux-act-foot">' + tradeButton + closeButton + '</div>' +
        '</section>';
    } else {
      actionHtml =
        '<section class="lux-actions is-single" aria-label="Дії">' +
          (hint ? '<p class="lux-hint">' + esc(hint) + '</p>' : '') +
          '<div class="lux-act-foot">' + closeButton + '</div>' +
        '</section>';
    }

    /* ---------- модалка ---------- */
    var html =
      '<article class="lux-card" role="dialog" aria-modal="true" aria-labelledby="luxCardTitle" ' +
        'dir="ltr" lang="uk" style="--lux-accent:' + esc(accent) + '">' +
        '<button type="button" class="lux-x" data-lux-act="close" aria-label="Закрити картку" title="Закрити">&times;</button>' +
        '<div class="lux-scroll">' +
          headerHtml +
          '<div class="lux-body">' +
            ownerHtml +
            factsHtml +
            estateHtml +
            rentHtml +
            actionHtml +
          '</div>' +
        '</div>' +
      '</article>';

    var modal = openModal(html, { cls: 'lux-modal' });
    if (!modal) return;
    var card = modal.querySelector('.lux-card');
    if (!card) return;

    /* Логотип: якщо файл не завантажився — показуємо емодзі-іконку з даних поля. */
    var logoImg = modal.querySelector('.lux-logo-img');
    if (logoImg) {
      var showFallback = function () {
        logoImg.hidden = true;
        var fb = modal.querySelector('.lux-logo-fallback');
        if (fb) fb.hidden = false;
      };
      logoImg.addEventListener('error', showFallback, { once: true });
      if (logoImg.complete && logoImg.naturalWidth === 0) showFallback();
    }

    var overlay = document.getElementById('overlay');
    var scroller = modal.querySelector('.lux-scroll');
    var previousFocus = document.activeElement;
    var observer = null;
    var closed = false;

    function onScroll() {
      if (scroller) card.classList.toggle('is-scrolled', scroller.scrollTop > 24);
    }

    function shutdown() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      if (overlay) overlay.removeEventListener('click', onOverlayClick);
      if (scroller) scroller.removeEventListener('scroll', onScroll);
      if (observer) observer.disconnect();
      if (previousFocus && previousFocus !== document.body && document.contains(previousFocus) &&
          typeof previousFocus.focus === 'function') {
        try { previousFocus.focus({ preventScroll: true }); }
        catch (e) { try { previousFocus.focus(); } catch (e2) { /* ignore */ } }
      }
    }

    function onOverlayClick(e) {
      if (e.target === overlay && (!overlay.dataset || overlay.dataset.static !== '1')) shutdown();
    }

    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!card.isConnected) { shutdown(); return; }
      e.preventDefault();
      shutdown();
      closeModal();
    }

    document.addEventListener('keydown', onKey);
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    if (overlay) {
      overlay.addEventListener('click', onOverlayClick);
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(function () {
          if (!card.isConnected) shutdown();
        });
        observer.observe(overlay, { childList: true });
      }
    }

    modal.querySelectorAll('[data-lux-act]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var kind = btn.dataset.luxAct;
        if (kind === 'close') {
          shutdown();
          closeModal();
          return;
        }
        if (kind === 'trade') {
          shutdown();
          closeModal();
          if (typeof openTrade === 'function') openTrade();
          return;
        }
        if (btn.disabled) return;

        modal.querySelectorAll('.lux-btn').forEach(function (b) { b.disabled = true; });
        var actionsBox = modal.querySelector('.lux-actions');
        if (actionsBox) actionsBox.classList.add('is-busy');

        try {
          await act(kind, { tile: tileIndex });
        } finally {
          shutdown();
          closeModal();
        }
      });
    });

    var closeX = modal.querySelector('.lux-x');
    if (closeX && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        if (card.isConnected) {
          try { closeX.focus({ preventScroll: true }); }
          catch (e) { closeX.focus(); }
        }
      });
    }
  }

  window.PremiumCard = { open: open };
})();
