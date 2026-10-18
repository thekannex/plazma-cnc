// Plasma Kontrol — Nesting (sac yerleşimi), sac seçimi, parça dışlama ve kesim sırası
// Motor: workers/plazma-nest/nest-engine.js (Web Worker)
(function() {
  'use strict';
  var G = window.PlazmaGeom;
  var KEY = 'plazmaNestV1';
  var QUALITY = { hizli: 4, normal: 2.5, ince: 1.5 };

  var st = load() || {
    parts: [],
    std: { w: 3000, h: 1500, use: true },
    remnants: [],
    opts: { gap: 5, margin: 10, rot: '15', fillHoles: true, quality: 'normal', time: 20 },
    order: 'part',
    result: null,
    view: 0
  };
  var NS = window.PlazmaNest = { state: st, active: null, stash: null, mode: null };

  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); }
    catch (e) { toast('Nesting verisi tarayıcı belleğine sığmadı (çok büyük çizim). Sonuç bu oturumda geçerli.', 'bg-orange fg-white'); }
  }
  function toast(m, c) { Metro.toast.create(m, null, 4000, c || 'bg-green fg-white'); }
  function fmt(v, d) { return (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toString(); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- geometri yardımcıları ----------
  function ringsBBox(rings) { return PlazmaNestEngine.bbox(rings); }
  function normalize(rings) {
    var b = ringsBBox(rings);
    return rings.map(function(r) { return r.map(function(p) { return [p[0] - b[0], p[1] - b[1]]; }); });
  }
  function placeRings(part, pl) {
    return PlazmaNestEngine.rotRings(part.rings, pl.deg).map(function(r) { return r.map(function(p) { return [p[0] + pl.dx, p[1] + pl.dy]; }); });
  }
  function outerIndex(rings) {
    var bi = 0, ba = -1;
    rings.forEach(function(r, i) { var b = ringsBBox([r]), a = (b[2] - b[0]) * (b[3] - b[1]); if (a > ba) { ba = a; bi = i; } });
    return bi;
  }
  function centroid(r) { var x = 0, y = 0; r.forEach(function(p) { x += p[0]; y += p[1]; }); return [x / r.length, y / r.length]; }

  // Seçili (yoksa tüm) kapalı konturları iç içeliğe göre parçalara ayır
  function partsFromScene() {
    if (window.plazmaFixDocs) plazmaFixDocs();
    var lines = [];
    objectsInScene.forEach(function(doc) {
      if (doc.userData && doc.userData.plazmaSheet) return;
      doc.children.forEach(function(l) { if (l.type === 'Line') lines.push({ l: l, doc: doc }); });
    });
    var sel = lines.filter(function(x) { return x.l.userData.selected; });
    if (sel.length) lines = sel;
    var closed = [], open = 0;
    lines.forEach(function(x) {
      var v = x.l.geometry.vertices, ox = x.l.position.x + x.doc.position.x, oy = x.l.position.y + x.doc.position.y;
      var pts = v.map(function(p) { return [p.x + ox, p.y + oy]; });
      if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.1) {
        pts.pop();
        closed.push({ pts: pts, name: x.doc.name, area: Math.abs(areaOf(pts)) });
      } else open++;
    });
    // iç içelik derinliği
    closed.forEach(function(c) {
      c.depth = 0; c.parent = null;
      closed.forEach(function(o) {
        if (o !== c && o.area > c.area && PlazmaNestEngine.pointIn(c.pts[0], o.pts)) {
          c.depth++;
          if (!c.parent || o.area < c.parent.area) c.parent = o;
        }
      });
    });
    var parts = [];
    closed.filter(function(c) { return c.depth % 2 === 0; }).forEach(function(o, i) {
      var rings = [o.pts];
      closed.forEach(function(h) { if (h.depth === o.depth + 1 && h.parent === o) rings.push(h.pts); });
      parts.push({ id: uid(), name: (o.name || 'Parça').replace(/\.(dxf|svg)$/i, '') + ' #' + (i + 1), rings: normalize(rings), qty: 1 });
    });
    return { parts: parts, open: open };
  }
  function areaOf(r) { var a = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2; }

  // ---------- arayüz ----------
  var ov;
  function css() {
    $('head').append('<style>' +
      '#pnOverlay{position:fixed;inset:20px;z-index:2000;background:#f4f4f4;border-radius:8px;box-shadow:0 6px 30px rgba(0,0,0,.45);display:none;font-size:12px;color:#222;}' +
      '#pnOverlay .pn-head{height:40px;background:#1b1b1b;color:#fff;display:flex;align-items:center;padding:0 12px;border-radius:8px 8px 0 0;border-bottom:3px solid #ff6a00;}' +
      '#pnOverlay .pn-head b{font-size:15px;flex:1}' +
      '#pnOverlay .pn-body{position:absolute;top:43px;bottom:0;left:0;right:0;display:flex;}' +
      '#pnOverlay .pn-left{width:390px;overflow:auto;padding:8px;border-right:1px solid #ccc;background:#fafafa;}' +
      '#pnOverlay .pn-right{flex:1;display:flex;flex-direction:column;min-width:0;}' +
      '#pnOverlay h4{margin:10px 0 4px;font-size:13px;color:#ff6a00;border-bottom:1px solid #ddd;padding-bottom:2px;}' +
      '#pnOverlay .pn-row{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px dotted #ddd;}' +
      '#pnOverlay input[type=number],#pnOverlay input[type=text],#pnOverlay select{height:22px;padding:0 4px;border:1px solid #bbb;border-radius:3px;font-size:12px;background:#fff;display:inline-block;width:auto;}' +
      '#pnOverlay select{-webkit-appearance:menulist !important;appearance:menulist !important;height:24px !important;min-width:90px;max-width:100%;opacity:1 !important;position:static !important;visibility:visible !important;}' +
      '#pnOverlay .pn-left select[data-k=order]{width:100%;}' +
      '#pnOverlay input[type=checkbox]{position:static;opacity:1;width:auto;height:auto;display:inline-block;margin:0 3px 0 0;}' +
      '#pnOverlay label{display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;}' +
      '#pnOverlay .pn-btn{border:1px solid #999;background:#fff;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:12px;margin:2px 2px 2px 0;}' +
      '#pnOverlay .pn-btn:hover{background:#ffe9d9;}' +
      '#pnOverlay .pn-btn.pri{background:#ff6a00;color:#fff;border-color:#e05500;font-weight:700;}' +
      '#pnOverlay .pn-btn.on{background:#333;color:#fff;}' +
      '#pnOverlay .pn-tabs{display:flex;gap:4px;padding:6px 8px 0;flex-wrap:wrap;border-bottom:1px solid #ccc;}' +
      '#pnOverlay .pn-tab{padding:4px 10px;border:1px solid #ccc;border-bottom:none;border-radius:4px 4px 0 0;cursor:pointer;background:#e8e8e8;}' +
      '#pnOverlay .pn-tab.act{background:#fff;font-weight:700;}' +
      '#pnOverlay .pn-tab .st{font-size:10px;margin-left:4px;padding:0 4px;border-radius:3px;color:#fff;}' +
      '#pnOverlay canvas.pn-view{flex:1;background:#fff;min-height:0;cursor:crosshair;}' +
      '#pnOverlay .pn-bar{padding:6px 8px;border-top:1px solid #ccc;background:#fafafa;}' +
      '#pnOverlay .pn-hint{color:#666;font-size:11px;}' +
      '#pnBanner{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:6;background:#1b1b1b;color:#fff;padding:5px 10px;border-radius:5px;border-left:4px solid #ff6a00;font-size:12px;display:none;box-shadow:0 2px 8px rgba(0,0,0,.4);}' +
      '#pnBanner button{margin-left:6px;}' +
      '</style>');
  }

  function build() {
    css();
    ov = $('<div id="pnOverlay"><div class="pn-head"><b><i class="fas fa-th-large"></i> Nesting — Sac Yerleşimi</b>' +
      '<button class="pn-btn" data-a="close">Kapat ✕</button></div><div class="pn-body"><div class="pn-left"></div>' +
      '<div class="pn-right"><div class="pn-tabs"></div><canvas class="pn-view"></canvas><div class="pn-bar"></div></div></div></div>');
    $('body').append(ov);
    ov.on('click', '[data-a]', function(e) { act($(this).data('a'), $(this)); e.stopPropagation(); });
    ov.on('change', '[data-k]', function() { setVal($(this).data('k'), this); });
    ov.find('canvas').on('click', canvasClick).on('mousemove', canvasHover);
    $(window).on('resize', function() { if (ov.is(':visible')) drawView(); });
    $('#renderArea').append('<div id="pnBanner"></div>');
    $('#pnBanner').on('click', '[data-a]', function() { act($(this).data('a'), $(this)); });
  }

  function setVal(k, el) {
    var v = el.type === 'checkbox' ? el.checked : el.value;
    var path = k.split('.');
    if (path[0] === 'part') { var p = st.parts.filter(function(x) { return x.id === path[1]; })[0]; if (p) p[path[2]] = path[2] === 'qty' ? Math.max(0, parseInt(v) || 0) : v; }
    else if (path[0] === 'rem') { var r = st.remnants.filter(function(x) { return x.id === path[1]; })[0]; if (r) r[path[2]] = path[2] === 'qty' ? Math.max(1, parseInt(v) || 1) : v; }
    else if (path[0] === 'sheetStatus') { st.result.sheets[+path[1]].status = v; renderTabs(); }
    else {
      var o = st;
      for (var i = 0; i < path.length - 1; i++) o = o[path[i]];
      var last = path[path.length - 1];
      o[last] = (typeof o[last] === 'number') ? (parseFloat(v) || 0) : v;
    }
    save();
    if (k === 'order') drawView();
  }

  function thumb(rings, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d'), b = ringsBBox(rings), s = Math.min((w - 4) / (b[2] - b[0] || 1), (h - 4) / (b[3] - b[1] || 1));
    x.fillStyle = '#ffb27a'; x.strokeStyle = '#a04000';
    x.beginPath();
    rings.forEach(function(r) { r.forEach(function(p, i) { var px = 2 + (p[0] - b[0]) * s, py = h - 2 - (p[1] - b[1]) * s; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); });
    x.fill('evenodd'); x.stroke();
    return c.toDataURL();
  }

  function renderLeft() {
    var o = st.opts, h = '';
    h += '<h4>1. Parçalar</h4><div class="pn-hint">CAM\'de parçaları seçip ekleyin (seçim yoksa tüm kapalı konturlar). İç içe konturlar delik olarak tanınır.</div>' +
      '<button class="pn-btn pri" data-a="addParts">+ Seçili çizimleri parça olarak ekle</button> <button class="pn-btn" data-a="clearParts">Temizle</button>';
    st.parts.forEach(function(p) {
      var b = ringsBBox(p.rings);
      h += '<div class="pn-row"><img src="' + thumb(p.rings, 44, 32) + '" width="44" height="32">' +
        '<input type="text" data-k="part.' + p.id + '.name" value="' + esc(p.name) + '" style="width:120px">' +
        '<span style="flex:1;color:#666">' + fmt(b[2] - b[0]) + '×' + fmt(b[3] - b[1]) + (p.rings.length > 1 ? ' · ' + (p.rings.length - 1) + ' delik' : '') + '</span>' +
        'Adet <input type="number" min="0" data-k="part.' + p.id + '.qty" value="' + p.qty + '" style="width:50px">' +
        '<button class="pn-btn" data-a="delPart" data-id="' + p.id + '">✕</button></div>';
    });
    var total = st.parts.reduce(function(s, p) { return s + (p.qty || 0); }, 0);
    h += '<div class="pn-hint">' + st.parts.length + ' parça tipi, toplam ' + total + ' adet</div>';

    h += '<h4>2. Saclar</h4>' +
      '<div class="pn-row"><label><input type="checkbox" data-k="std.use"' + (st.std.use ? ' checked' : '') + '> Standart sac</label>' +
      'X <input type="number" data-k="std.w" value="' + st.std.w + '" style="width:62px"> × Y <input type="number" data-k="std.h" value="' + st.std.h + '" style="width:62px"> mm</div>' +
      '<div class="pn-hint">Artık saclar önce kullanılır. Sacın sol alt köşesi makinede iş sıfırı (0,0) olmalı.</div>';
    st.remnants.forEach(function(r) {
      var b = ringsBBox(r.rings);
      h += '<div class="pn-row"><img src="' + thumb(r.rings, 44, 32) + '" width="44" height="32"><label><input type="checkbox" data-k="rem.' + r.id + '.use"' + (r.use !== false ? ' checked' : '') + '></label>' +
        (r.digitized ? '<i class="fas fa-crosshairs" title="Torçla tanıtıldı: kendi konumunu taşır, hizalama uygulanmaz" style="color:#ff6a00"></i>' : '') + '<input type="text" data-k="rem.' + r.id + '.name" value="' + esc(r.name) + '" style="width:110px"><span style="flex:1;color:#666">' + fmt(b[2] - b[0]) + '×' + fmt(b[3] - b[1]) + '</span>' +
        'Adet <input type="number" min="1" data-k="rem.' + r.id + '.qty" value="' + (r.qty || 1) + '" style="width:42px"><button class="pn-btn" data-a="delRem" data-id="' + r.id + '">✕</button></div>';
    });
    h += '<div>Artık ekle: X <input type="number" id="pnRemW" value="1000" style="width:58px"> × Y <input type="number" id="pnRemH" value="1500" style="width:58px"> ' +
      '<button class="pn-btn" data-a="addRemRect">+ Dikdörtgen</button><button class="pn-btn" data-a="addRemSel" title="CAM\'de çizdiğiniz kapalı konturu artık sac yapar (L şekli vb.)">+ Seçili kontur</button></div>';

    h += '<h4>3. Ayarlar</h4>' +
      '<div><label>Parça arası boşluk <input type="number" step="0.5" data-k="opts.gap" value="' + o.gap + '" style="width:50px"> mm</label>' +
      '<label>Sac kenar payı <input type="number" step="0.5" data-k="opts.margin" value="' + o.margin + '" style="width:50px"> mm</label></div>' +
      '<div><label>Döndürme <select data-k="opts.rot">' +
      [['15', 'Serbest (15° adım)'], ['5', 'Serbest ince (5° adım)'], ['90', '90° adım'], ['0', 'Döndürme yok']].map(function(x) { return '<option value="' + x[0] + '"' + (String(o.rot) === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') +
      '</select></label><label><input type="checkbox" data-k="opts.fillHoles"' + (o.fillHoles ? ' checked' : '') + '> Delik içine parça</label></div>' +
      '<div><label>Hassasiyet <select data-k="opts.quality">' +
      [['hizli', 'Hızlı'], ['normal', 'Normal'], ['ince', 'İnce (yavaş)']].map(function(x) { return '<option value="' + x[0] + '"' + (o.quality === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') +
      '</select></label><label>İyileştirme süresi <input type="number" min="0" data-k="opts.time" value="' + o.time + '" style="width:44px"> sn</label></div>' +
      '<div class="pn-hint">Gerçek boşluk istenenden biraz büyük çıkabilir (hassasiyete bağlı), hiçbir zaman küçük olmaz.</div>';

    h += '<h4>4. Kesim sırası</h4><div><select data-k="order">' +
      [['part', 'Parça parça: önce delikler, sonra dış kontur, en yakın parçaya geç'], ['holes', 'Önce tüm delikler, sonra tüm dış konturlar'], ['manual', 'Elle: sac üzerinde parçalara sırayla tıkla']].map(function(x) { return '<option value="' + x[0] + '"' + (st.order === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') +
      '</select></div>';

    h += '<div style="margin-top:12px"><button class="pn-btn pri" data-a="run" style="font-size:14px;padding:4px 16px">▶ Yerleştir</button> <button class="pn-btn" data-a="stop">Durdur</button> <span id="pnProg" class="pn-hint"></span></div>';
    ov.find('.pn-left').html(h);
  }

  var STATUS = { bekliyor: ['Kesilecek', '#1e88e5'], kesildi: ['Kesildi', '#43a047'], haric: ['Hariç', '#757575'] };
  function renderTabs() {
    var r = st.result, h = '';
    if (!r || !r.sheets.length) { ov.find('.pn-tabs').html('<span class="pn-hint" style="padding:6px">Henüz yerleşim yok. Soldan parça ekleyip ▶ Yerleştir\'e basın.</span>'); return; }
    r.sheets.forEach(function(s, i) {
      var sc = STATUS[s.status || 'bekliyor'];
      h += '<div class="pn-tab' + (i === st.view ? ' act' : '') + '" data-a="view" data-i="' + i + '">' + (i + 1) + '. ' + esc(s.name) + ' <span style="color:#888">%' + fmt(s.util * 100) + '</span><span class="st" style="background:' + sc[1] + '">' + sc[0] + '</span></div>';
    });
    ov.find('.pn-tabs').html(h);
  }

  function renderBar() {
    var r = st.result, s = r && r.sheets[st.view];
    if (!s) { ov.find('.pn-bar').html(''); return; }
    var ex = (s.excluded || []).length, n = s.placements.length;
    var h = '<b>' + (st.view + 1) + '. sac: ' + esc(s.name) + '</b> · ' + n + ' parça' + (ex ? ' (' + ex + ' hariç)' : '') + ' · doluluk %' + fmt(s.util * 100) + ' · kullanılan uzunluk ' + fmt(s.usedLength) + ' mm' +
      ' · Durum <select data-k="sheetStatus.' + st.view + '">' + Object.keys(STATUS).map(function(k) { return '<option value="' + k + '"' + ((s.status || 'bekliyor') === k ? ' selected' : '') + '>' + STATUS[k][0] + '</option>'; }).join('') + '</select>' +
      '<div style="margin-top:4px"><button class="pn-btn pri" data-a="activate">✂ Bu sacı kes → çalışma alanına al</button>' +
      '<button class="pn-btn' + (NS.mode === 'exclude' ? ' on' : '') + '" data-a="modeExclude" title="Tıklanan parçalar kesilmez">Parça dışla</button>' +
      '<button class="pn-btn' + (NS.mode === 'order' ? ' on' : '') + '" data-a="modeOrder" title="Parçalara kesim sırasına göre tıklayın">Sırayı elle belirle</button>' +
      '<button class="pn-btn" data-a="clearOrder">Sırayı sıfırla</button>' +
      '<button class="pn-btn" data-a="saveRemnant" title="Sacın kullanılmayan sağ tarafını artık sac olarak kaydeder">Kalanı artık olarak kaydet</button></div>';
    if (r.unplaced && r.unplaced.length) h += '<div style="color:#c62828;margin-top:3px">⚠ ' + r.unplaced.length + ' parça hiçbir saca sığmadı (sac boyu / adet / kenar payını kontrol edin).</div>';
    h += '<div class="pn-hint">' + (NS.mode === 'exclude' ? 'Dışla modu: kesilmeyecek parçalara tıklayın (gri olur), tekrar tıklayınca geri alınır.' :
      NS.mode === 'order' ? 'Sıra modu: parçalara kesilecekleri sırayla tıklayın. Tıklanmayanlar sona en yakın sırayla eklenir.' :
      'Sayılar kesim sırasıdır. Her parçada önce delikler, sonra dış kontur kesilir.') + '</div>';
    ov.find('.pn-bar').html(h);
  }

  function renderAll() { renderLeft(); renderTabs(); renderBar(); drawView(); }

  // ---------- sac önizleme ----------
  var viewTf = null;
  function sheetDef(s) {
    if (s.remnant) { var r = st.remnants.filter(function(x) { return x.id === s.sheetId; })[0]; return r ? r.rings : s.rings; }
    return s.rings || [[[0, 0], [st.std.w, 0], [st.std.w, st.std.h], [0, st.std.h]]];
  }
  function partById(id) { return st.parts.filter(function(p) { return p.id === id; })[0]; }
  function keyOf(pl) { return pl.partId + ':' + pl.inst; }

  // Sacın parçaları: yerleşmiş halkalar, dış kontur, merkez ve "deliğimde duran parçalar"
  NS.sheetItems = function(s) {
    var items = s.placements.filter(function(pl) { return (s.excluded || []).indexOf(keyOf(pl)) < 0; }).map(function(pl) {
      var part = partById(pl.partId); if (!part) return null;
      var rings = placeRings(part, pl), oi = outerIndex(rings);
      return { key: keyOf(pl), rings: rings, outer: rings[oi], holes: rings.filter(function(r, i) { return i !== oi; }), c: centroid(rings[oi]), inside: [] };
    }).filter(Boolean);
    // A, B'nin bir deliğinin içindeyse A önce kesilmeli (B'nin deliği düşünce A da düşer)
    items.forEach(function(a) {
      items.forEach(function(b) {
        if (a === b) return;
        if (b.holes.some(function(h) { return PlazmaNestEngine.pointIn(a.outer[0], h) && PlazmaNestEngine.pointIn(a.c, h); })) b.inside.push(a.key);
      });
    });
    return items;
  };

  // Kesim sırası (parça anahtarları): delik içindeki parçalar her zaman içeren parçadan önce;
  // elle seçilenler sırayla, kalanlar en yakın komşu
  NS.sequence = function(s) {
    var items = NS.sheetItems(s), byKey = {};
    items.forEach(function(x) { byKey[x.key] = x; });
    var seq = [], done = {}, cur = [0, 0];
    function push(k) {
      if (done[k] || !byKey[k]) return;
      done[k] = true; // döngüye karşı
      byKey[k].inside.forEach(push); // önce içindekiler
      seq.push(k); cur = byKey[k].c;
    }
    if (st.order === 'manual' || (s.manual && s.manual.length)) (s.manual || []).forEach(push);
    var left = items.filter(function(x) { return !done[x.key]; });
    while (left.length) {
      // sadece içindekiler bitmiş parçalar aday
      var cand = left.filter(function(x) { return x.inside.every(function(k) { return done[k]; }); });
      if (!cand.length) cand = left;
      var best = null, bd = Infinity;
      cand.forEach(function(x) { var d = Math.hypot(x.c[0] - cur[0], x.c[1] - cur[1]); if (d < bd) { bd = d; best = x; } });
      push(best.key);
      left = left.filter(function(x) { return !done[x.key]; });
    }
    return seq;
  };

  // Etiket noktası: içinde parça taşıyan parçalarda merkez yerine malzeme üstünde bir nokta
  function labelPoint(item) {
    if (!item.inside.length) return item.c;
    var b = ringsBBox([item.outer]), w = b[2] - b[0], h = b[3] - b[1];
    var cands = [[b[0] + w * 0.12, b[1] + h * 0.12], [b[2] - w * 0.12, b[1] + h * 0.12], [b[0] + w * 0.12, b[3] - h * 0.12], [b[2] - w * 0.12, b[3] - h * 0.12], [b[0] + w * 0.5, b[1] + h * 0.1]];
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i];
      if (PlazmaNestEngine.pointIn(p, item.outer) && !item.holes.some(function(hh) { return PlazmaNestEngine.pointIn(p, hh); })) return p;
    }
    return [b[0] + w * 0.15, b[1] + h * 0.15];
  }
  NS.labelPoint = labelPoint;

  function drawView() {
    var cv = ov.find('canvas')[0];
    cv.width = cv.clientWidth; cv.height = cv.clientHeight;
    var x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    var r = st.result, s = r && r.sheets[st.view];
    if (!s) return;
    var sr = sheetDef(s), b = ringsBBox(sr);
    var sc = Math.min((cv.width - 40) / (b[2] - b[0]), (cv.height - 40) / (b[3] - b[1]));
    var ox = 20 - b[0] * sc, oy = cv.height - 20 + b[1] * sc;
    viewTf = { sc: sc, ox: ox, oy: oy };
    function path(rings) { x.beginPath(); rings.forEach(function(rr) { rr.forEach(function(p, i) { var px = ox + p[0] * sc, py = oy - p[1] * sc; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); }); }
    path(sr); x.fillStyle = '#d9dde2'; x.fill('evenodd'); x.strokeStyle = '#555'; x.lineWidth = 1.5; x.stroke();
    // kenar payı çizgisi
    x.setLineDash([4, 4]); x.strokeStyle = '#999'; x.lineWidth = 1;
    var inner = PlazmaNestEngine.offsetRings(sr, -st.opts.margin); path(inner); x.stroke(); x.setLineDash([]);
    var seq = NS.sequence(s), ex = s.excluded || [], itemMap = {};
    NS.sheetItems(s).forEach(function(it) { itemMap[it.key] = it; });
    s.placements.forEach(function(pl) {
      var part = partById(pl.partId); if (!part) return;
      var rings = placeRings(part, pl), k = keyOf(pl), excluded = ex.indexOf(k) >= 0;
      path(rings);
      x.fillStyle = excluded ? 'rgba(150,150,150,.35)' : (hoverKey === k ? '#ffd0a8' : '#ff9a4a');
      x.fill('evenodd');
      x.strokeStyle = excluded ? '#888' : '#8a3500'; x.lineWidth = 1; x.stroke();
      var c = itemMap[k] ? labelPoint(itemMap[k]) : centroid(rings[outerIndex(rings)]), n = seq.indexOf(k);
      x.font = 'bold ' + Math.max(10, Math.min(16, 14 * sc * 20)) + 'px Arial';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      if (excluded) { x.fillStyle = '#555'; x.fillText('✕', ox + c[0] * sc, oy - c[1] * sc); }
      else if (n >= 0) {
        x.fillStyle = 'rgba(0,0,0,.65)'; var tw = x.measureText(String(n + 1)).width + 8;
        x.fillRect(ox + c[0] * sc - tw / 2, oy - c[1] * sc - 9, tw, 18);
        x.fillStyle = '#fff'; x.fillText(String(n + 1), ox + c[0] * sc, oy - c[1] * sc);
      }
    });
    // kesim sırası rotası
    x.strokeStyle = 'rgba(30,136,229,.55)'; x.lineWidth = 1; x.beginPath();
    var cur = [0, 0]; x.moveTo(ox, oy);
    seq.forEach(function(k) {
      var pl = s.placements.filter(function(p) { return keyOf(p) === k; })[0]; var part = pl && partById(pl.partId); if (!part) return;
      var rings = placeRings(part, pl), c = centroid(rings[outerIndex(rings)]);
      x.lineTo(ox + c[0] * sc, oy - c[1] * sc);
    });
    x.stroke();
    x.fillStyle = '#1e88e5'; x.fillRect(ox - 3, oy - 3, 6, 6);
    x.fillStyle = '#333'; x.font = '11px Arial'; x.textAlign = 'left'; x.fillText('0,0 (iş sıfırı)', ox + 6, oy - 6);
  }

  var hoverKey = null;
  function hitTest(e) {
    var r = st.result, s = r && r.sheets[st.view];
    if (!s || !viewTf) return null;
    var rect = e.target.getBoundingClientRect();
    var wx = (e.clientX - rect.left - viewTf.ox) / viewTf.sc, wy = (viewTf.oy - (e.clientY - rect.top)) / viewTf.sc;
    var hit = null;
    s.placements.forEach(function(pl) {
      var part = partById(pl.partId); if (!part) return;
      var rings = placeRings(part, pl), inside = false;
      rings.forEach(function(rr) { if (PlazmaNestEngine.pointIn([wx, wy], rr)) inside = !inside; });
      if (inside) hit = keyOf(pl);
    });
    return hit;
  }
  function canvasHover(e) { var k = hitTest(e); if (k !== hoverKey) { hoverKey = k; drawView(); } }
  function canvasClick(e) {
    var k = hitTest(e), s = st.result && st.result.sheets[st.view];
    if (!k || !s) return;
    if (NS.mode === 'exclude') {
      s.excluded = s.excluded || [];
      var i = s.excluded.indexOf(k);
      if (i >= 0) s.excluded.splice(i, 1); else s.excluded.push(k);
    } else if (NS.mode === 'order') {
      s.manual = s.manual || [];
      var j = s.manual.indexOf(k);
      if (j >= 0) s.manual.splice(j, 1);
      s.manual.push(k);
    } else return;
    save(); renderBar(); drawView();
  }

  // ---------- eylemler ----------
  var worker = null, lastBest = null;
  function act(a, el) {
    var s = st.result && st.result.sheets[st.view];
    switch (a) {
      case 'close': ov.hide(); break;
      case 'addParts':
        var res = partsFromScene();
        if (!res.parts.length) { toast('Kapalı kontur bulunamadı. Parçalar kapalı olmalı (gerekirse Birleştir kullanın).', 'bg-red fg-white'); break; }
        st.parts = st.parts.concat(res.parts);
        save(); renderLeft();
        toast(res.parts.length + ' parça eklendi' + (res.open ? ' (' + res.open + ' açık çizgi atlandı)' : ''));
        break;
      case 'clearParts': st.parts = []; save(); renderLeft(); break;
      case 'delPart': st.parts = st.parts.filter(function(p) { return p.id !== el.data('id'); }); save(); renderLeft(); break;
      case 'addRemRect':
        var w = parseFloat($('#pnRemW').val()), h = parseFloat($('#pnRemH').val());
        if (!(w > 0 && h > 0)) break;
        st.remnants.push({ id: uid(), name: 'Artık ' + fmt(w) + '×' + fmt(h), rings: [[[0, 0], [w, 0], [w, h], [0, h]]], qty: 1, use: true });
        save(); renderLeft(); break;
      case 'addRemSel':
        var pr = partsFromScene().parts;
        if (pr.length !== 1) { toast('CAM\'de artık sacın dış hatlarını çizip yalnızca onu seçin', 'bg-red fg-white'); break; }
        var b = ringsBBox(pr[0].rings);
        st.remnants.push({ id: uid(), name: 'Artık ' + fmt(b[2] - b[0]) + '×' + fmt(b[3] - b[1]), rings: pr[0].rings, qty: 1, use: true });
        save(); renderLeft(); toast('Artık sac eklendi (içindeki konturlar kusurlu bölge sayılır)'); break;
      case 'delRem': st.remnants = st.remnants.filter(function(r) { return r.id !== el.data('id'); }); save(); renderLeft(); break;
      case 'run': run(); break;
      case 'stop':
        if (worker) { worker.terminate(); worker = null; if (lastBest) finish(lastBest, true); else $('#pnProg').text('Durduruldu'); }
        break;
      case 'view': st.view = +el.data('i'); save(); renderTabs(); renderBar(); drawView(); break;
      case 'modeExclude': NS.mode = NS.mode === 'exclude' ? null : 'exclude'; renderBar(); break;
      case 'modeOrder': NS.mode = NS.mode === 'order' ? null : 'order'; if (NS.mode && s) s.manual = []; renderBar(); drawView(); break;
      case 'clearOrder': if (s) { s.manual = []; save(); drawView(); } break;
      case 'saveRemnant': saveRemnant(s); break;
      case 'activate': activate(st.view); break;
      case 'backToDrawing': deactivate(); break;
      case 'openNest': NS.open(); break;
    }
  }

  function run() {
    var parts = st.parts.filter(function(p) { return p.qty > 0; });
    if (!parts.length) { toast('Önce parça ekleyin ve adet girin', 'bg-red fg-white'); return; }
    var sheets = st.remnants.filter(function(r) { return r.use !== false; }).map(function(r) { return { id: r.id, name: r.name, remnant: true, rings: r.rings, qty: r.qty || 1 }; });
    if (st.std.use) sheets.push({ id: 'std', name: fmt(st.std.w) + '×' + fmt(st.std.h), rings: [[[0, 0], [st.std.w, 0], [st.std.w, st.std.h], [0, st.std.h]]], qty: 0 });
    if (!sheets.length) { toast('En az bir sac seçin', 'bg-red fg-white'); return; }
    var o = st.opts;
    var input = { parts: parts, sheets: sheets, opts: { gap: +o.gap || 0, margin: +o.margin || 0, cell: QUALITY[o.quality] || 2.5, rotStep: parseFloat(o.rot) || 0, fillHoles: !!o.fillHoles, timeLimit: (+o.time || 0) * 1000, seed: Date.now() & 0xffff } };
    if (worker) worker.terminate();
    lastBest = null;
    worker = new Worker('workers/plazma-nest/nest-engine.js');
    $('#pnProg').html('<i class="fas fa-spinner fa-spin"></i> Hesaplanıyor…');
    worker.onmessage = function(e) {
      var m = e.data;
      if (m.type === 'best') { lastBest = m.result; lastBest.sheetsIn = sheets; showResult(lastBest, sheets, true); }
      if (m.type === 'progress') $('#pnProg').html('<i class="fas fa-spinner fa-spin"></i> Deneme ' + m.p.iter + ' · ' + m.p.sheets + ' sac · son sac ' + fmt(m.p.lastLen) + ' mm' + (m.p.unplaced ? ' · ' + m.p.unplaced + ' sığmayan' : '') + ' · ' + fmt(m.p.elapsed / 1000, 1) + ' sn');
      if (m.type === 'done') { worker.terminate(); worker = null; finish(m.result, false, sheets); }
      if (m.type === 'error') { worker.terminate(); worker = null; $('#pnProg').text('Hata: ' + m.message.split('\n')[0]); console.error(m.message); }
    };
    worker.onerror = function(err) { $('#pnProg').text('Hata: ' + err.message); };
    worker.postMessage({ cmd: 'nest', input: input });
  }

  function showResult(res, sheets, partial) {
    st.result = {
      sheets: res.sheets.map(function(s) {
        var def = sheets.filter(function(d) { return d.id === s.sheetId; })[0];
        return { sheetId: s.sheetId, name: s.name, remnant: s.remnant, rings: def ? def.rings : null, placements: s.placements, util: s.util, usedLength: s.usedLength, status: 'bekliyor', excluded: [], manual: [] };
      }),
      unplaced: res.unplaced
    };
    st.view = 0;
    renderTabs(); renderBar(); drawView();
  }
  function finish(res, stopped, sheets) {
    showResult(res, sheets || res.sheetsIn || [], false);
    save();
    var placed = res.sheets.reduce(function(n, s) { return n + s.placements.length; }, 0);
    $('#pnProg').text((stopped ? 'Durduruldu: ' : 'Bitti: ') + placed + ' parça, ' + res.sheets.length + ' sac, ' + res.iterations + ' deneme, ' + fmt(res.elapsed / 1000, 1) + ' sn' + (res.unplaced.length ? ', ' + res.unplaced.length + ' sığmadı' : ''));
  }

  function saveRemnant(s) {
    if (!s) return;
    if (s.remnant) { toast('Artık sacın kalanını CONTROL\'de "Artık Tanıt" ile torçla yeniden tanıtın (şekli düzensiz olabilir)', 'bg-orange fg-white'); return; }
    var maxX = 0;
    s.placements.forEach(function(pl) { var part = partById(pl.partId); if (part) maxX = Math.max(maxX, ringsBBox(placeRings(part, pl))[2]); });
    var b = ringsBBox(sheetDef(s));
    var x0 = Math.ceil(maxX + Math.max(st.opts.gap, 5)), w = b[2] - x0, h = b[3] - b[1];
    if (w < 100) { toast('Kayda değer artık kalmıyor (' + fmt(w) + ' mm)', 'bg-orange fg-white'); return; }
    st.remnants.push({ id: uid(), name: 'Artık ' + fmt(w) + '×' + fmt(h) + ' (' + s.name + ')', rings: [[[0, 0], [w, 0], [w, h], [0, h]]], qty: 1, use: true });
    save(); renderLeft();
    toast('Artık sac kaydedildi: ' + fmt(w) + ' × ' + fmt(h) + ' mm. Sacın X=' + fmt(x0) + ' mm\'den sonrası. Bir sonraki kesimde bu parçanın sol alt köşesini sıfır alın.');
  }

  // ---------- sacı çalışma alanına al ----------
  var DEFAULT_TP = { camOperation: 'Plasma: Vector (path outside)', camToolDia: '6.35', camStepover: '40', camZClearance: '10', camZStart: '0', camPasses: '1', camDragOffset: '1',
    camLaserPower: '100', camSpindleRpm: '', camZStep: '1', camZDepth: '6', camFeedrate: '2700', camPlungerate: '300', camPlasmaKerf: '1.2', camPlasmaZHeight: '1.5',
    camPlasmaPierceHeight: '4', camPlasmaPierceDelay: '1.5', camPlasmaLeadinDist: '3', camPlasmaIHS: 'Yes', camUnion: 'No', camDirection: 'Climb', camSpotSize: '0.1',
    camFillAngle: '0', camTabDepth: '0', camTabWidth: '6', camTabSpace: '50', tRampPlunge: 'No', camPenUp: '255', camPenDown: '0', advanced: false };

  function tpTemplate() {
    var last = null;
    try { last = JSON.parse(localStorage.getItem('lastCamOperation')); } catch (e) {}
    if (last && String(last.camOperation || '').indexOf('Plasma') === 0) return $.extend({}, DEFAULT_TP, last);
    return $.extend({}, DEFAULT_TP);
  }

  function activate(idx) {
    var s = st.result && st.result.sheets[idx];
    if (!s) return;
    if (window.PlazmaDraw && PlazmaDraw.tool) PlazmaDraw.stop();
    if (!NS.stash) NS.stash = { objects: objectsInScene.slice(), toolpaths: toolpathsInScene.slice() };
    objectsInScene.length = 0;
    toolpathsInScene.length = 0;
    trashGcode();

    var doc = new THREE.Group();
    doc.name = 'Sac ' + (idx + 1) + ' — ' + s.name;
    doc.userData.plazmaSheet = true;
    var ex = s.excluded || [], holes = [], outers = [], parts = [];
    var seq = NS.sequence(s), itemMap2 = {};
    NS.sheetItems(s).forEach(function(it) { itemMap2[it.key] = it; });
    s.placements.forEach(function(pl) {
      var k = keyOf(pl); if (ex.indexOf(k) >= 0) return;
      var part = partById(pl.partId); if (!part) return;
      var rings = placeRings(part, pl), oi = outerIndex(rings), n = seq.indexOf(k) + 1;
      rings.forEach(function(r, i) {
        var pts = r.map(function(p) { return { x: p[0], y: p[1] }; });
        pts.push({ x: r[0][0], y: r[0][1] });
        var line = PlazmaDraw.makeLine(pts, 'P' + n + (i === oi ? ' dış' : ' delik'), null);
        line.userData.nestKey = k;
        doc.add(line);
        (i === oi ? outers : holes).push(line);
      });
      parts.push({ key: k, outer: rings[oi], n: n, lp: itemMap2[k] ? labelPoint(itemMap2[k]) : centroid(rings[oi]) });
    });
    objectsInScene.push(doc);

    var tpl = tpTemplate();
    function mkTp(lines, op, name) {
      if (!lines.length) return;
      var tp = new THREE.Group();
      lines.forEach(function(l) { var c = l.clone(); c.userData = { closed: true, nestKey: l.userData.nestKey }; tp.add(c); });
      tp.name = name;
      tp.userData = $.extend({}, tpl, { camOperation: op, visible: true, plazmaNest: true });
      toolpathsInScene.push(tp);
    }
    mkTp(holes, 'Plasma: Vector (path inside)', 'Sac ' + (idx + 1) + ' - Delikler');
    mkTp(outers, 'Plasma: Vector (path outside)', 'Sac ' + (idx + 1) + ' - Dış konturlar');

    NS.active = { idx: idx, parts: parts, order: st.order, seq: seq };
    drawSheetOverlay(s);
    fillTree();
    clearSceneFlag = true;
    for (var i = 0; i < toolpathsInScene.length; i++) toolpathPreview(i);
    setTimeout(function() { makeGcode(); }, 400);
    setTimeout(function() { resetView(); }, 300);
    ov.hide();
    banner();
    toast('Sac ' + (idx + 1) + ' yüklendi: ' + parts.length + ' parça. G-code hazırlanıyor. Kesim ayarları: toolpath\'lerin "Edit" düğmesi.');
  }

  function deactivate() {
    if (!NS.stash) return;
    objectsInScene.length = 0; toolpathsInScene.length = 0;
    NS.stash.objects.forEach(function(o) { objectsInScene.push(o); });
    NS.stash.toolpaths.forEach(function(t) { toolpathsInScene.push(t); });
    NS.stash = null; NS.active = null;
    clearSheetOverlay();
    trashGcode();
    fillTree();
    clearSceneFlag = true;
    $('#pnBanner').hide();
    setTimeout(function() { resetView(); }, 200);
  }

  function banner() {
    var a = NS.active, s = a && st.result.sheets[a.idx];
    if (!s) { $('#pnBanner').hide(); return; }
    $('#pnBanner').html('<i class="fas fa-cut" style="color:#ff6a00"></i> <b>Sac ' + (a.idx + 1) + '</b> kesim modu · ' + a.parts.length + ' parça · sıra: ' +
      ({ part: 'parça parça', holes: 'önce delikler', manual: 'elle' }[a.order]) +
      ' <button class="pn-btn" data-a="openNest" style="color:#222">Nesting</button><button class="pn-btn" data-a="backToDrawing" style="color:#222">Çizimlere dön</button>').show();
  }

  // Çalışma alanında sac sınırı ve sıra numaraları (kesilmez, sadece gösterim)
  var sheetGroup = new THREE.Group();
  sheetGroup.name = 'PlazmaSheet';
  function clearSheetOverlay() {
    while (sheetGroup.children.length) { var c = sheetGroup.children[0]; sheetGroup.remove(c); if (c.geometry) c.geometry.dispose(); if (c.material && c.material.map) c.material.map.dispose(); }
  }
  function drawSheetOverlay(s) {
    clearSheetOverlay();
    if (sheetGroup.parent !== workspace) workspace.add(sheetGroup);
    function addRing(r, color, z) {
      var g = new THREE.Geometry();
      r.forEach(function(p) { g.vertices.push(new THREE.Vector3(p[0], p[1], z || -0.1)); });
      g.vertices.push(new THREE.Vector3(r[0][0], r[0][1], z || -0.1));
      sheetGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: color })));
    }
    sheetDef(s).forEach(function(r) { addRing(r, 0x2979ff); });
    PlazmaNestEngine.offsetRings(sheetDef(s), -st.opts.margin).forEach(function(r) { addRing(r, 0x9e9e9e); });
    (s.excluded || []).forEach(function(k) {
      var pl = s.placements.filter(function(p) { return keyOf(p) === k; })[0], part = pl && partById(pl.partId);
      if (part) placeRings(part, pl).forEach(function(r) { addRing(r, 0xbdbdbd); });
    });
    NS.active.parts.forEach(function(p) {
      var c = p.lp || centroid(p.outer), b = ringsBBox([p.outer]);
      var size = Math.max(8, Math.min(40, Math.min(b[2] - b[0], b[3] - b[1]) * 0.35));
      sheetGroup.add(label(String(p.n), c, size));
    });
  }
  function label(text, c, size) {
    var cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    var x = cv.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(0, 0, 128, 64);
    x.fillStyle = '#fff'; x.font = 'bold 44px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 64, 34);
    var tex = new THREE.Texture(cv); tex.needsUpdate = true;
    var m = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    m.position.set(c[0], c[1], 1);
    return m;
  }

  // ---------- G-code kesim sırası ----------
  // Bloklar: "move to z-safe height" satırından "; Tool Off" satırına kadar (her biri kendi güvenli Z, delme ve IHS'si ile)
  function reorderGcode(g) {
    var a = NS.active;
    if (!a || a.order === 'holes') return g;
    var lines = g.split('\n'), blocks = [], op = '', i = 0, head = [], tail = [], first = -1, lastEnd = -1;
    while (i < lines.length) {
      var ln = lines[i];
      if (/^; Operation \d+:/.test(ln)) op = ln;
      if (/move to z-safe height/.test(ln)) {
        var j = i;
        while (j < lines.length && !/;\s*Tool Off/.test(lines[j])) j++;
        // bindirme vb. Tool Off'tan önceki satırlar bloğun içinde; Tool Off dahil
        var body = lines.slice(i, j + 1);
        var pts = body.filter(function(l) { return /^\s*G0*[123]\b/i.test(l) && /X/i.test(l) && /Y/i.test(l); }).map(function(l) { return [parseFloat(/X\s*(-?[\d.]+)/i.exec(l)[1]), parseFloat(/Y\s*(-?[\d.]+)/i.exec(l)[1])]; });
        if (first < 0) first = i;
        blocks.push({ lines: body, inside: /inside/.test(op), start: pts[0], end: pts[pts.length - 1] });
        lastEnd = j;
        i = j + 1;
        continue;
      }
      i++;
    }
    if (!blocks.length) return g;
    head = lines.slice(0, first);
    // son bloktan sonrası: geri çekilme ve bitiş kodu
    tail = lines.slice(lastEnd + 1).filter(function(l) { return !/^; Operation \d+:/.test(l) && !/^; Plasma Kerf/.test(l); });
    // bloğu parçaya eşle (başlangıç noktası, parçanın biraz genişletilmiş dış konturunun içinde)
    var zones = a.parts.map(function(p) { var r = PlazmaNestEngine.offsetRings([p.outer], 4)[0] || p.outer; return { key: p.key, n: p.n, ring: r, area: Math.abs(areaOf(r)) }; });
    var byKey = {};
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b], z = null;
      // delik içine yerleşmiş parçalar için en küçük (en içteki) bölge
      if (blk.start) for (var q = 0; q < zones.length; q++) if (PlazmaNestEngine.pointIn(blk.start, zones[q].ring) && (!z || zones[q].area < z.area)) z = zones[q];
      if (!z) { console.warn('Plazma sıra: blok parçaya eşlenemedi, sıra değiştirilmedi'); return g; }
      (byKey[z.key] = byKey[z.key] || []).push(blk);
    }
    var out = [], cur = [0, 0];
    a.seq.forEach(function(k) {
      var bl = byKey[k]; if (!bl) return;
      var zn = zones.filter(function(z) { return z.key === k; })[0];
      out.push('', '; ---- Parça ' + (zn ? zn.n : '?') + ' ----');
      var hs = bl.filter(function(x) { return x.inside; }), os = bl.filter(function(x) { return !x.inside; });
      while (hs.length) { // delikler: en yakından
        var bi = 0, bd = Infinity;
        hs.forEach(function(x, ii) { var d = Math.hypot(x.start[0] - cur[0], x.start[1] - cur[1]); if (d < bd) { bd = d; bi = ii; } });
        var h = hs.splice(bi, 1)[0]; out = out.concat(h.lines); cur = h.end || cur;
      }
      os.forEach(function(x) { out = out.concat(x.lines); cur = x.end || cur; });
      delete byKey[k];
    });
    Object.keys(byKey).forEach(function(k) { byKey[k].forEach(function(x) { out = out.concat(x.lines); }); });
    return head.concat(out, tail).join('\n');
  }

  // İş sıfırı köşesi (Settings → Plasma: İş Sıfırı Köşesi): fl sol ön, fr sağ ön, bl sol arka, br sağ arka
  var CORNER_NAMES = { fl: 'sol on', fr: 'sag on', bl: 'sol arka', br: 'sag arka' };
  function zeroCorner() {
    var c = $('#plazmaZeroCorner').val() || localStorage.getItem('plazmaZeroCorner') || 'fl';
    return CORNER_NAMES[c] ? c : 'fl';
  }
  // Mutlak (G90) XY hareketlerini (dx, dy) kadar geri öteler; yay merkezleri (I/J) göreli olduğu için değişmez.
  // G53 / G10 / G92 / G28 / G30 satırlarına ve notlara dokunulmaz.
  function translateGcode(g, dx, dy) {
    var rel = false;
    return g.split('\n').map(function(line) {
      var ci = line.search(/[;(]/), code = ci >= 0 ? line.slice(0, ci) : line, cmt = ci >= 0 ? line.slice(ci) : '';
      if (/G\s*0*91(?![\d.])/i.test(code)) rel = true;
      if (/G\s*0*90(?![\d.])/i.test(code)) rel = false;
      if (rel || /G\s*0*(53|10|92|28|30)(?![\d.])/i.test(code) || /^\s*\$/.test(code)) return line;
      var out = code.replace(/([XY])\s*(-?[\d.]+)/gi, function(m, l, v) {
        return l + (parseFloat(v) - (l.toUpperCase() === 'X' ? dx : dy)).toFixed(4);
      });
      return out + cmt;
    }).join('\n');
  }
  NS.zeroCorner = zeroCorner;
  NS.translateGcode = translateGcode;

  if (typeof window.prepgcodefile === 'function') {
    var origPrep = window.prepgcodefile;
    window.prepgcodefile = function() {
      var g = origPrep.apply(this, arguments);
      try { if (NS.active) g = reorderGcode(g); } catch (e) { console.error('Plazma kesim sırası hatası, orijinal sıra kullanıldı', e); }
      try {
        var sh = NS.active && st.result && st.result.sheets[NS.active.idx];
        var rem = sh && sh.remnant && st.remnants.filter(function(r) { return r.id === sh.sheetId; })[0];
        var corner = zeroCorner();
        if (sh) { // CONTROL iş öncesi kontrol: kesim sac sınırları içinde mi
          var sb = ringsBBox(sheetDef(sh));
          // İş sıfırı köşesi sol ön değilse sac G-code'da o köşe X0 Y0 olacak şekilde kaydırılır.
          // Torçla tanıtılmış artıkta kaydırma yok: şekil zaten ilk köşeye (iş sıfırı) göredir.
          var dx = 0, dy = 0;
          if (!(rem && rem.digitized)) { dx = corner.charAt(1) === 'r' ? sb[2] : sb[0]; dy = corner.charAt(0) === 'b' ? sb[3] : sb[1]; }
          if (dx || dy) g = translateGcode(g, dx, dy);
          g = '; PLAZMA-SAC: X' + fmt(sb[0] - dx) + ' Y' + fmt(sb[1] - dy) + ' X' + fmt(sb[2] - dx) + ' Y' + fmt(sb[3] - dy) + ' (' + sh.name + ')\n' + g;
        }
        if (corner !== 'fl') g = '; PLAZMA-SIFIR-KOSE: ' + corner + ' (' + CORNER_NAMES[corner] + ')\n' + g;
        if (rem && rem.digitized) {
          var hdr = '; PLAZMA: HIZALAMA YOK (torcla tanitilmis artik sac: ' + rem.name + ')\n' +
            (rem.origin ? '; PLAZMA-SIFIR: X' + rem.origin.x + ' Y' + rem.origin.y + '\n' : '');
          g = hdr + g;
        }
      } catch (e2) { console.error(e2); }
      return g;
    };
  }
  NS.reorderGcode = reorderGcode;

  // CONTROL'de torçla tanıtılan artık saclar (/api/plazma/remnants)
  function fetchRemnants() {
    var base = (typeof plazmaControlUrl === 'function') ? plazmaControlUrl() : 'http://localhost:3100';
    $.getJSON(base + '/api/plazma/remnants').done(function(list) {
      st.importedRem = st.importedRem || [];
      var added = 0;
      (list || []).forEach(function(r) {
        if (st.importedRem.indexOf(r.id) >= 0 || !r.points || r.points.length < 3) return;
        st.importedRem.push(r.id);
        st.remnants.push({ id: 'dg' + r.id, name: r.name + ' (tanıtılan)', rings: [r.points], qty: 1, use: true, digitized: true, origin: r.origin });
        added++;
      });
      if (added) { save(); if (ov && ov.is(':visible')) renderLeft(); toast(added + ' tanıtılmış artık sac eklendi'); }
    });
  }
  var remPoll = null;

  NS.open = function() {
    if (!ov) build();
    renderAll();
    ov.show();
    setTimeout(drawView, 30);
    fetchRemnants();
    clearInterval(remPoll);
    remPoll = setInterval(function() { if (ov.is(':visible')) fetchRemnants(); else clearInterval(remPoll); }, 4000);
  };
  NS.addSelectedParts = function() { NS.open(); act('addParts'); };

  $(function() { if (!ov) build(); });
})();
