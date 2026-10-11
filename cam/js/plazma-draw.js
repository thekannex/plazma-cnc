// Plasma Kontrol — CAM çizim araçları (ek özellik)
// Çizgi/çoklu çizgi, dikdörtgen, daire, yay (3 nokta), çokgen, kanal ve düğüm düzenleme.
// Orijinal fare koduna girmemek için olaylar #renderArea üzerinde "capture" aşamasında yakalanır;
// sağ tık (kaydırma) ve tekerlek (yakınlaştırma) orijinal kontrollere bırakılır.
(function() {
  'use strict';
  var G = window.PlazmaGeom;
  var P = G.P;

  var PD = window.PlazmaDraw = {
    tool: null,       // 'polyline' | 'rect' | 'circle' | 'arc' | 'polygon' | 'slot' | 'node'
    pts: [],          // tıklanan noktalar
    cursor: null,     // yakalanmış imleç noktası
    snap: null,       // { p, kind: 'vertex'|'center'|'grid'|'first' }
    node: { line: null, sel: -1, drag: false, moved: false },
    sc: { drag: null } // ölçekleme sürüklemesi
  };

  var TOOLS = {
    polyline: { name: 'Çizgi', hint: 'Tıkla: nokta ekle · İlk noktaya tıkla: kapat · Enter / çift tık: bitir · Backspace: son noktayı sil · Shift: 45° kilit' },
    rect: { name: 'Dikdörtgen', hint: 'İlk köşe, sonra karşı köşe · veya ilk köşeden sonra En/Boy yazıp Enter' },
    circle: { name: 'Daire', hint: 'Merkez, sonra çap noktası · veya merkezden sonra Çap yazıp Enter' },
    arc: { name: 'Yay', hint: 'Başlangıç, bitiş, sonra yay üzerindeki bir nokta' },
    polygon: { name: 'Çokgen', hint: 'Merkez, sonra köşe noktası · veya Yarıçap yazıp Enter' },
    slot: { name: 'Kanal', hint: 'Birinci merkez, sonra ikinci merkez (genişlik paneldeki değer)' },
    trim: { name: 'Kırp (Trim)', hint: 'Silinecek parçanın üzerine gel (kırmızı) ve tıkla · Diğer çizgiler kesme kenarıdır · Kesişmeyen çizgi tamamen silinir · Ctrl+Z: geri al · Esc: çık' },
    scale: { name: 'Ölçekle', hint: 'Şekle tıkla (Shift+tık: çoklu seçim) · Köşeden sürükle: oranlı büyüt/küçült (Shift: serbest) · Kenardan: tek yön · Alt: merkezden · İçinden sürükle: taşı · Esc: bırak' },
    node: { name: 'Düğüm Düzenle', hint: 'Çizgiye tıkla · Noktayı sürükle · Shift+tık: nokta ekle · Del: seçili noktayı sil · Burada böl: açık çizgiyi ikiye ayırır, kapalı konturu bu noktadan sonraki kenarı kaldırarak açar · Esc: bırak' }
  };

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(msg, cls) { Metro.toast.create(msg, null, 3000, cls || 'bg-green fg-white'); }
  function fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }

  // ---------- önizleme ----------
  var preview = new THREE.Group();
  preview.name = 'PlazmaPreview';
  function ensurePreview() {
    if (typeof workspace !== 'undefined' && preview.parent !== workspace) workspace.add(preview);
  }
  function clearPreview() {
    while (preview.children.length) {
      var c = preview.children[0];
      preview.remove(c);
      if (c.geometry) c.geometry.dispose();
    }
  }
  function addPreviewLine(pts, color, dashed) {
    if (!pts || pts.length < 2) return;
    var g = new THREE.Geometry();
    pts.forEach(function(p) { g.vertices.push(new THREE.Vector3(p.x, p.y, 0.05)); });
    var m = new THREE.LineBasicMaterial({ color: color || 0xff6a00, transparent: true, opacity: dashed ? 0.6 : 1 });
    preview.add(new THREE.Line(g, m));
  }
  function addMarker(p, color, sizePx, cross) {
    var s = (sizePx || 5) * pxW();
    if (cross) {
      addPreviewLine([P(p.x - s, p.y), P(p.x + s, p.y)], color);
      addPreviewLine([P(p.x, p.y - s), P(p.x, p.y + s)], color);
    } else {
      addPreviewLine([P(p.x - s, p.y - s), P(p.x + s, p.y - s), P(p.x + s, p.y + s), P(p.x - s, p.y + s), P(p.x - s, p.y - s)], color);
    }
  }

  // ---------- koordinatlar ----------
  var lastEvt = null;
  function worldAt(clientX, clientY) {
    var w = mouseToWorldCoord({ clientX: clientX, clientY: clientY });
    return P(w.x, w.y);
  }
  // 1 pikselin dünya ölçüsü (mm)
  function pxW() {
    var e = lastEvt || { clientX: 300, clientY: 300 };
    return G.dist(worldAt(e.clientX, e.clientY), worldAt(e.clientX + 10, e.clientY)) / 10 || 0.1;
  }

  function docLinesWorld(cb) {
    objectsInScene.forEach(function(doc) {
      doc.children.forEach(function(line) {
        if (line.type !== 'Line' || !line.geometry || !line.geometry.vertices) return;
        var ox = line.position.x + doc.position.x, oy = line.position.y + doc.position.y;
        cb(line, ox, oy, doc);
      });
    });
  }

  // Yakalama: köşe/uç noktaları, şekil merkezleri, ilk nokta (kapatma), ızgara; Shift: 45° kilit
  function snapPoint(raw, e) {
    var tol = 10 * pxW(), best = null;
    function consider(p, kind) {
      var d = G.dist(p, raw);
      if (d < tol && (!best || d < best.d)) best = { p: P(p.x, p.y), kind: kind, d: d };
    }
    if (ls('plazmaSnapVertex', '1') === '1') {
      docLinesWorld(function(line, ox, oy) {
        if (PD.tool === 'node' && PD.node.drag && line === PD.node.line) return;
        if (PD.tool === 'scale' && PD.sc.drag && line.userData.selected) return; // kendi noktalarına yapışmasın
        var v = line.geometry.vertices;
        if (v.length > 3000) { consider(P(v[0].x + ox, v[0].y + oy), 'vertex'); return; }
        for (var i = 0; i < v.length; i++) consider(P(v[i].x + ox, v[i].y + oy), 'vertex');
        var sh = line.userData.plazmaShape;
        if (sh && sh.cx !== undefined) consider(P(sh.cx + ox, sh.cy + oy), 'center');
      });
    }
    PD.pts.forEach(function(p, i) { consider(p, i === 0 ? 'first' : 'vertex'); });
    if (best) return best;
    var p = raw;
    if (e && e.shiftKey && PD.pts.length && PD.tool !== 'node') {
      var b = PD.pts[PD.pts.length - 1], L = G.dist(b, raw), a = G.ang(b, raw);
      a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      p = P(b.x + L * Math.cos(a), b.y + L * Math.sin(a));
    }
    var grid = parseFloat(ls('plazmaSnapGrid', '1'));
    if (ls('plazmaSnapGridOn', '1') === '1' && grid > 0) {
      if (!(e && e.shiftKey && PD.pts.length)) p = P(Math.round(p.x / grid) * grid, Math.round(p.y / grid) * grid);
      return { p: p, kind: 'grid', d: 0 };
    }
    return { p: p, kind: 'free', d: 0 };
  }

  // ---------- doküman / varlık oluşturma ----------
  function drawDoc() {
    var doc = objectsInScene.filter(function(o) { return o.userData && o.userData.plazmaDoc; })[0];
    if (!doc) {
      doc = new THREE.Group();
      doc.name = 'Çizim';
      doc.userData.plazmaDoc = true;
      objectsInScene.push(doc);
    }
    return doc;
  }

  function makeLine(pts, name, shape) {
    var g = new THREE.Geometry();
    pts.forEach(function(p) { g.vertices.push(new THREE.Vector3(p.x, p.y, 0)); });
    var line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color((window.Theme && Theme.CAM_DOC_DEFAULT_COLOR) || 0x333333) }));
    line.name = name;
    if (shape) line.userData.plazmaShape = shape;
    return line;
  }

  function linePts(line) { return line.geometry.vertices.map(function(v) { return P(v.x, v.y); }); }

  // Three.js (r92) eski Geometry'de nokta SAYISI değişince WebGL tamponu yeniden boyutlanmaz: fazla eski
  // noktalar ekranda "fırlayan" çizgiler olarak kalır, eksik yeni noktalar görünmez. Bu yüzden her zaman
  // yeni geometri nesnesi verilir (aynı uuid: toolpath bağları kopmaz) ve eskisi atılır.
  function setLinePts(line, pts) {
    var old = line.geometry, ng = new THREE.Geometry();
    pts.forEach(function(p) { ng.vertices.push(new THREE.Vector3(p.x, p.y, 0)); });
    ng.uuid = old.uuid;
    ng.computeBoundingBox();
    ng.computeBoundingSphere();
    line.geometry = ng;
    if (old !== ng && old.dispose) old.dispose();
  }

  // Toolpath'leri güncelle ve ağacı yenile
  function sceneChanged(geomChanged) {
    fillTree();
    clearSceneFlag = true;
    if (geomChanged && typeof plazmaRefreshToolpaths === 'function') plazmaRefreshToolpaths();
  }

  function commit(pts, name, shape) {
    pts = G.dedupe(pts);
    if (pts.length < 2) return null;
    storeUndo(true);
    changePositionToGeoTranslate();
    var line = makeLine(pts, name, shape);
    drawDoc().add(line);
    sceneChanged(false);
    return line;
  }

  // Şekil parametrelerinden nokta üret (parametrik düzenleme de bunu kullanır)
  PD.shapePts = function(sh) {
    switch (sh.type) {
      case 'rect': return G.rectPts(sh.x, sh.y, sh.w, sh.h, sh.r, sh.rot);
      case 'circle': return G.circlePts(P(sh.cx, sh.cy), sh.d / 2, sh.a || 0);
      case 'polygon': return G.polygonPts(P(sh.cx, sh.cy), sh.R, sh.n, sh.rot);
      case 'slot': return G.slotPts(P(sh.x1, sh.y1), P(sh.x2, sh.y2), sh.w);
      case 'arc': return G.arcPts(P(sh.cx, sh.cy), sh.r, sh.a0 * Math.PI / 180, sh.sweep * Math.PI / 180);
    }
    return null;
  };

  // ---------- panel ----------
  var panel;
  function buildPanel() {
    // Metro stilleri girişleri tam genişlik/blok yapıyor: panel içinde satır içi düzen
    $('head').append('<style>' +
      '#plazmaDrawPanel label{display:inline-flex !important; align-items:center; gap:4px; margin:2px 8px 2px 0 !important; color:#eee; font-size:12px; width:auto !important;}' +
      '#plazmaDrawPanel input[type=number]{display:inline-block !important; height:22px !important; min-height:0 !important; line-height:20px; border:1px solid #666; border-radius:3px; background:#fff; margin:0 !important;}' +
      '#plazmaDrawPanel input[type=checkbox]{display:inline-block !important; width:auto !important; height:auto !important; margin:0 3px 0 0 !important; position:static !important; opacity:1 !important;}' +
      '#plazmaDrawPanel .button.mini{height:22px; line-height:20px; padding:0 8px; font-size:11px;}' +
      '#plazmaDrawPanel select{display:inline-block !important; width:auto !important; height:22px !important; min-height:0 !important; padding:0 4px !important; font-size:12px !important; line-height:20px; border:1px solid #666; border-radius:3px; background:#fff; color:#111; margin:0 !important;}' +
      '</style>');
    panel = $('<div id="plazmaDrawPanel"></div>').css({
      position: 'absolute', top: '10px', left: '58px', zIndex: 5, display: 'none', minWidth: '260px', maxWidth: '420px',
      background: 'rgba(30,30,30,0.92)', color: '#eee', borderRadius: '6px', padding: '8px 10px', fontSize: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,.4)', borderLeft: '4px solid #ff6a00'
    });
    $('#renderArea').append(panel);
    panel.on('mousedown mouseup click dblclick', function(e) { e.stopPropagation(); });
    panel.on('keydown', 'input', function(e) {
      e.stopPropagation();
      if (e.key === 'Tab') { // panel içindeki sayı alanları arasında dolaş
        e.preventDefault();
        var ins = panel.find('input[type=number]:visible').not('[data-ls=plazmaSnapGrid]'), i = ins.index(this);
        var nx = ins.get((i + (e.shiftKey ? -1 : 1) + ins.length) % ins.length);
        nx.focus();
        try { nx.select(); } catch (err) {} // jQuery .select() odağı düşürüyor, yerel metot kullan
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); applyInput(); }
      if (e.key === 'Escape') { this.blur(); cancel(); }
    });
    panel.on('change', 'input[data-ls]', function() { lsSet($(this).data('ls'), this.type === 'checkbox' ? (this.checked ? '1' : '0') : this.value); render(); });
    panel.on('click', '[data-act]', function() { action($(this).data('act')); });
    panel.on('input', '#pdScW, #pdScH, #pdScP', scaleFieldInput);
  }

  function field(id, label, val, lsKey, w) {
    return '<label style="margin-right:8px; white-space:nowrap;">' + label + ' <input id="' + id + '" type="number" step="any" value="' + (val === undefined ? '' : val) + '"' +
      (lsKey ? ' data-ls="' + lsKey + '"' : '') + ' style="width:' + (w || 64) + 'px; padding:1px 4px; color:#111;"></label>';
  }
  function btn(act, label) {
    return '<button data-act="' + act + '" class="button mini" style="margin:2px 4px 0 0;">' + label + '</button>';
  }

  function panelHtml() {
    var t = PD.tool, h = '<div style="font-weight:700; color:#ff9a4a; margin-bottom:2px;">' + TOOLS[t].name + '</div>' +
      '<div style="opacity:.8; margin-bottom:6px;">' + TOOLS[t].hint + '</div>';
    if (t === 'polyline') h += field('pdX', 'X', '', null, 60) + field('pdY', 'Y', '', null, 60) + '<br>' + field('pdL', 'Uzunluk', '', null, 60) + field('pdA', 'Açı°', '', null, 50) +
      '<div>' + btn('finish', 'Bitir') + btn('close', 'Kapat') + btn('undoPt', 'Son noktayı sil') + '</div>';
    if (t === 'rect') h += field('pdW', 'En', '', null) + field('pdH', 'Boy', '', null) + field('pdR', 'Köşe R', ls('plazmaRectR', '0'), 'plazmaRectR', 50);
    if (t === 'circle') h += field('pdD', 'Çap', '', null) + field('pdCX', 'Merkez X', '', null, 56) + field('pdCY', 'Y', '', null, 56) + '<div>' + btn('circleAt', 'Bu merkeze çiz') + '</div>';
    if (t === 'polygon') h += field('pdN', 'Kenar', ls('plazmaPolyN', '6'), 'plazmaPolyN', 44) + field('pdPR', 'Yarıçap', '', null, 56);
    if (t === 'slot') h += field('pdSW', 'Genişlik', ls('plazmaSlotW', '10'), 'plazmaSlotW', 56);
    if (t === 'scale') h += '<div id="pdScInfo" style="margin-bottom:4px;"></div>' +
      field('pdScW', 'En', '', null, 70) + field('pdScH', 'Boy', '', null, 70) + field('pdScP', '%', '', null, 54) + '<br>' +
      '<label><input type="checkbox" data-ls="plazmaScaleKeep" ' + (ls('plazmaScaleKeep', '1') === '1' ? 'checked' : '') + '> Oranı koru</label>' +
      '<label>Referans <select id="pdScRef" style="height:22px; color:#111;">' +
      [['bl', 'Sol alt'], ['tl', 'Sol üst'], ['br', 'Sağ alt'], ['tr', 'Sağ üst'], ['c', 'Merkez']].map(function(o) { return '<option value="' + o[0] + '"' + (ls('plazmaScaleRef', 'bl') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<div>' + btn('scApply', 'Uygula') + btn('scAll', 'Tümünü seç') + btn('scNone', 'Seçimi bırak') + '</div>';
    if (t === 'node') h += '<div id="pdNodeInfo" style="margin-bottom:4px;">Düzenlenecek çizgiye tıklayın.</div>' +
      '<div id="pdNodeEdit" style="display:none;">' + field('pdNX', 'X', '', null, 70) + field('pdNY', 'Y', '', null, 70) + '<br>' +
      field('pdNL', 'Sonraki kenar', '', null, 64) + field('pdNA', 'Açı°', '', null, 50) +
      '<div>' + btn('nodeApply', 'Uygula') + btn('nodeDel', 'Noktayı sil') + btn('nodeSplit', 'Burada böl / aç') + '</div></div>';
    h += '<div style="margin-top:6px; border-top:1px solid #444; padding-top:4px;">' +
      '<label style="margin-right:8px;"><input type="checkbox" data-ls="plazmaSnapVertex" ' + (ls('plazmaSnapVertex', '1') === '1' ? 'checked' : '') + '> Noktaya yapış</label>' +
      '<label style="margin-right:4px;"><input type="checkbox" data-ls="plazmaSnapGridOn" ' + (ls('plazmaSnapGridOn', '1') === '1' ? 'checked' : '') + '> Izgara</label>' +
      '<input type="number" step="any" data-ls="plazmaSnapGrid" value="' + ls('plazmaSnapGrid', '1') + '" style="width:44px; padding:1px 4px; color:#111;"> mm' +
      '<span id="pdReadout" style="float:right; opacity:.85; font-family:monospace;"></span></div>';
    return h;
  }

  function num(id) { var v = parseFloat($('#' + id).val()); return isFinite(v) ? v : null; }

  // ---------- araç başlat / bitir ----------
  var activating = false;
  PD.start = function(tool) {
    if (PD.tool === tool) { PD.stop(); return; }
    if (PD.tool) PD.stop(); // önceki aracı düzgün kapat (yarım çizgi kaydedilir)
    var keepSel = tool === 'scale' ? selLines() : null; // ölçekleme: önceden seçilenlerle başla
    activating = true;
    try { mouseSelectMode(); } finally { activating = false; }
    deselectAllObjects();
    if (keepSel) keepSel.forEach(function(l) { l.userData.selected = true; });
    PD.tool = tool;
    if (window.plazmaFixDocs) plazmaFixDocs();
    if (tool === 'trim' || tool === 'node' || tool === 'scale') changePositionToGeoTranslate();
    PD.sc = { drag: null };
    PD.trimPlan = null;
    PD.pts = [];
    PD.node = { line: null, sel: -1, drag: false, moved: false };
    $('.sidemenu .tbtn').removeClass('tbtnactive');
    $('.plazmaToolBtn[data-tool="' + tool + '"]').addClass('tbtnactive');
    ensurePreview();
    panel.html(panelHtml()).show();
    $('#renderArea').css('cursor', 'crosshair');
    if (typeof helpoverlay !== 'undefined') helpoverlay.innerHTML = TOOLS[tool].hint + ' · <kbd>Sağ tık</kbd> = Kaydır / <kbd>Tekerlek</kbd> = Yakınlaştır';
    if (tool === 'scale') scaleFill();
    render();
  };

  PD.stop = function() {
    if (!PD.tool) return;
    if (PD.tool === 'polyline' && PD.pts.length >= 2) finishPolyline(false); // yarım çizgiyi kaybetme
    PD.tool = null;
    PD.pts = [];
    PD.node = { line: null, sel: -1, drag: false, moved: false };
    PD.sc = { drag: null };
    clearPreview();
    panel.hide();
    $('.plazmaToolBtn').removeClass('tbtnactive');
    $('#renderArea').css('cursor', '');
    if (!activating) mouseSelectMode(); // orijinal seçim modu ve yardım satırı geri gelsin
  };

  // Orijinal mod düğmelerine basılınca çizim aracı kapansın
  ['mouseSelectMode', 'mouseMoveMode', 'mouseEraseMode', 'mouseScaleMode'].forEach(function(name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function() {
      if (!activating) PD.stop();
      return orig.apply(this, arguments);
    };
  });

  function cancel() {
    if (PD.tool === 'scale') {
      if (PD.sc.drag) { PD.sc.drag = null; render(); }
      else if (selLines().length) { deselectAllObjects(); scaleFill(); render(); }
      else PD.stop();
      return;
    }
    if (PD.tool === 'node') {
      if (PD.node.line) { PD.node = { line: null, sel: -1, drag: false, moved: false }; updateNodePanel(); render(); }
      else PD.stop();
      return;
    }
    if (PD.pts.length) { PD.pts = []; render(); } else PD.stop();
  }

  // ---------- çizim mantığı ----------
  function rubber() {
    var t = PD.tool, pts = PD.pts, c = PD.cursor;
    if (!c) return [];
    if (t === 'polyline') return pts.length ? [pts.concat([c])] : [];
    if (t === 'rect' && pts.length === 1) return [G.rectPts(Math.min(pts[0].x, c.x), Math.min(pts[0].y, c.y), c.x - pts[0].x, c.y - pts[0].y, parseFloat(ls('plazmaRectR', '0')) || 0)];
    if (t === 'circle' && pts.length === 1) return [G.circlePts(pts[0], G.dist(pts[0], c)), [pts[0], c]];
    if (t === 'arc' && pts.length === 1) return [[pts[0], c]];
    if (t === 'arc' && pts.length === 2) { var a = G.arc3(pts[0], pts[1], c); return a ? [G.arcPts(a.c, a.r, a.a0, a.sweep)] : [[pts[0], pts[1]]]; }
    if (t === 'polygon' && pts.length === 1) return [G.polygonPts(pts[0], G.dist(pts[0], c), parseInt(ls('plazmaPolyN', '6')), G.ang(pts[0], c) * 180 / Math.PI)];
    if (t === 'slot' && pts.length === 1) return [G.slotPts(pts[0], c, parseFloat(ls('plazmaSlotW', '10')) || 10), [pts[0], c]];
    return [];
  }

  function render() {
    if (!PD.tool) return;
    clearPreview();
    var c = PD.cursor;
    rubber().forEach(function(pts, i) { addPreviewLine(pts, 0xff6a00, i > 0); });
    PD.pts.forEach(function(p) { addMarker(p, 0xff6a00, 3); });
    if (PD.tool === 'node') renderNode();
    if (PD.tool === 'scale') { renderScale(); return; }
    if (PD.tool === 'trim' && PD.trimPlan && PD.trimPlan.removed) PD.trimPlan.removed.forEach(function(r) { addPreviewLine(r, 0xff1744); });
    if (c && PD.snap) {
      var col = { vertex: 0x00c853, center: 0x2979ff, first: 0xffd600 }[PD.snap.kind] || 0x888888;
      addMarker(c, col, PD.snap.kind === 'grid' || PD.snap.kind === 'free' ? 4 : 6, PD.snap.kind === 'grid' || PD.snap.kind === 'free');
    }
    // okuma
    var r = '';
    if (c) {
      r = 'X ' + c.x.toFixed(2) + '  Y ' + c.y.toFixed(2);
      var last = PD.pts[PD.pts.length - 1];
      if (last) r += '  L ' + G.dist(last, c).toFixed(2) + '  ∠ ' + (G.ang(last, c) * 180 / Math.PI).toFixed(1) + '°';
      if (PD.tool === 'rect' && PD.pts.length === 1) r = 'En ' + Math.abs(c.x - last.x).toFixed(2) + '  Boy ' + Math.abs(c.y - last.y).toFixed(2);
      if (PD.tool === 'circle' && PD.pts.length === 1) r = 'Çap ' + (2 * G.dist(last, c)).toFixed(2);
    }
    $('#pdReadout').text(r);
  }

  function finishPolyline(close) {
    var pts = G.dedupe(PD.pts);
    if (pts.length < 2) { PD.pts = []; render(); return; }
    if (close && pts.length > 2) pts.push(P(pts[0].x, pts[0].y));
    commit(pts, close ? 'Kapalı çizgi' : 'Çizgi', null);
    PD.pts = [];
    render();
  }

  function click(p) {
    var t = PD.tool, pts = PD.pts;
    if (t === 'polyline') {
      if (pts.length > 2 && G.dist(p, pts[0]) < 1e-6) { finishPolyline(true); return; }
      pts.push(p);
    } else if (t === 'rect') {
      if (!pts.length) pts.push(p);
      else makeRect(pts[0], p.x - pts[0].x, p.y - pts[0].y);
    } else if (t === 'circle') {
      if (!pts.length) pts.push(p);
      else makeCircle(pts[0], 2 * G.dist(pts[0], p));
    } else if (t === 'arc') {
      pts.push(p);
      if (pts.length === 3) {
        var a = G.arc3(pts[0], pts[1], pts[2]);
        if (a) commit(G.arcPts(a.c, a.r, a.a0, a.sweep), 'Yay', { type: 'arc', cx: a.c.x, cy: a.c.y, r: a.r, a0: a.a0 * 180 / Math.PI, sweep: a.sweep * 180 / Math.PI });
        else commit([pts[0], pts[1]], 'Çizgi', null);
        PD.pts = [];
      }
    } else if (t === 'polygon') {
      if (!pts.length) pts.push(p);
      else makePolygon(pts[0], G.dist(pts[0], p), G.ang(pts[0], p) * 180 / Math.PI);
    } else if (t === 'slot') {
      if (!pts.length) pts.push(p);
      else {
        var w = parseFloat(ls('plazmaSlotW', '10')) || 10;
        var sh = { type: 'slot', x1: pts[0].x, y1: pts[0].y, x2: p.x, y2: p.y, w: w };
        commit(PD.shapePts(sh), 'Kanal', sh);
        PD.pts = [];
      }
    }
    render();
  }

  function makeRect(p0, w, h) {
    var x = Math.min(p0.x, p0.x + w), y = Math.min(p0.y, p0.y + h);
    if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return;
    var sh = { type: 'rect', x: x, y: y, w: Math.abs(w), h: Math.abs(h), r: parseFloat(ls('plazmaRectR', '0')) || 0, rot: 0 };
    commit(PD.shapePts(sh), 'Dikdörtgen', sh);
    PD.pts = [];
  }
  function makeCircle(c, d) {
    if (!(d > 0)) return;
    var sh = { type: 'circle', cx: c.x, cy: c.y, d: d };
    commit(PD.shapePts(sh), 'Daire', sh);
    PD.pts = [];
  }
  function makePolygon(c, R, rot) {
    if (!(R > 0)) return;
    var sh = { type: 'polygon', cx: c.x, cy: c.y, R: R, n: parseInt(ls('plazmaPolyN', '6')) || 6, rot: rot || 0 };
    commit(PD.shapePts(sh), 'Çokgen', sh);
    PD.pts = [];
  }

  // Paneldeki sayılarla uygula (Enter)
  function applyInput() {
    var t = PD.tool, pts = PD.pts, last = pts[pts.length - 1];
    if (t === 'polyline') {
      var x = num('pdX'), y = num('pdY'), L = num('pdL'), A = num('pdA');
      if (L !== null && last) {
        var a = (A === null ? 0 : A) * Math.PI / 180;
        click(P(last.x + L * Math.cos(a), last.y + L * Math.sin(a)));
      } else if (x !== null && y !== null) click(P(x, y));
      else if (pts.length >= 2) { finishPolyline(false); return; }
      $('#pdX, #pdY, #pdL').val('');
    } else if (t === 'rect' && last) {
      var W = num('pdW'), H = num('pdH');
      if (W && H) {
        var c = PD.cursor || P(last.x + 1, last.y + 1);
        makeRect(last, (c.x >= last.x ? 1 : -1) * W, (c.y >= last.y ? 1 : -1) * H);
      }
    } else if (t === 'circle') {
      var D = num('pdD');
      if (D && last) makeCircle(last, D);
      else action('circleAt');
    } else if (t === 'polygon' && last) {
      var R = num('pdPR');
      if (R) makePolygon(last, R, 90);
    } else if (t === 'node') action('nodeApply');
    else if (t === 'scale') action('scApply');
    render();
  }

  function action(a) {
    if (a === 'finish') finishPolyline(false);
    else if (a === 'close') finishPolyline(true);
    else if (a === 'undoPt') { PD.pts.pop(); render(); }
    else if (a === 'circleAt') {
      var cx = num('pdCX'), cy = num('pdCY'), D = num('pdD');
      if (cx !== null && cy !== null && D) makeCircle(P(cx, cy), D);
      else toast('Merkez X, Y ve Çap girin', 'bg-red fg-white');
      render();
    } else if (a.indexOf('node') === 0) nodeAction(a);
    else if (a.indexOf('sc') === 0) scaleAction(a);
  }

  // ---------- düğüm düzenleme ----------
  // Fareye en yakın çizgi (8 piksel içinde). Three.js r92 raycast'i sınır küresini toleransla
  // büyütmediği için dairelere dışarıdan yakın tıklamaları kaçırıyordu; bu yüzden doğrudan mesafe.
  function pickLine(e) {
    var q = worldAt(e.clientX, e.clientY), tol = 8 * pxW(), best = null, bd = tol;
    docLinesWorld(function(line, ox, oy) {
      var v = line.geometry.vertices;
      if (v.length < 2) return;
      var lq = P(q.x - ox, q.y - oy); // (önbellekteki boundingBox orijinal döndürmeden sonra eski kalabiliyor; kullanma)
      var cp = G.closestOnPoly(v, lq);
      if (cp && cp.d < bd) { bd = cp.d; best = line; }
    });
    return best;
  }

  function nodeWorldPts() {
    var l = PD.node.line;
    if (!l) return [];
    var doc = l.parent || { position: { x: 0, y: 0 } };
    return linePts(l).map(function(p) { return P(p.x + l.position.x + doc.position.x, p.y + l.position.y + doc.position.y); });
  }

  function renderNode() {
    var l = PD.node.line;
    if (!l) return;
    var pts = nodeWorldPts();
    addPreviewLine(pts, 0x00b0ff);
    if (pts.length <= 2000) {
      var closed = G.isClosed(pts);
      pts.forEach(function(p, i) {
        if (closed && i === pts.length - 1) return;
        addMarker(p, i === PD.node.sel ? 0xff1744 : 0x00b0ff, i === PD.node.sel ? 5 : 3);
      });
    }
  }

  function updateNodePanel() {
    var l = PD.node.line, i = PD.node.sel;
    if (!l) { $('#pdNodeInfo').text('Düzenlenecek çizgiye tıklayın.'); $('#pdNodeEdit').hide(); return; }
    var pts = linePts(l), closed = G.isClosed(pts);
    var info = (l.name || 'Çizgi') + ' · ' + (closed ? pts.length - 1 : pts.length) + ' nokta · ' + G.polyLength(pts).toFixed(2) + ' mm' + (closed ? ' · kapalı' : '');
    if (pts.length > 2000) info += ' (çok noktalı: noktalar gösterilmiyor)';
    $('#pdNodeInfo').text(info);
    if (i < 0) { $('#pdNodeEdit').hide(); return; }
    var p = pts[i], nIdx = nextIdx(pts, i);
    $('#pdNX').val(fmt(p.x)); $('#pdNY').val(fmt(p.y));
    if (nIdx >= 0) { $('#pdNL').val(fmt(G.dist(p, pts[nIdx]))); $('#pdNA').val(fmt(G.ang(p, pts[nIdx]) * 180 / Math.PI)); }
    else { $('#pdNL').val(''); $('#pdNA').val(''); }
    $('#pdNodeEdit').show();
  }

  function nextIdx(pts, i) {
    var closed = G.isClosed(pts);
    if (i < pts.length - 1) return (closed && i === pts.length - 2) ? 0 : i + 1;
    return closed ? 1 : -1;
  }

  // Noktayı taşı (kapalı çizgide ilk/son nokta birlikte)
  function setNode(pts, i, p) {
    var closed = G.isClosed(pts);
    pts[i] = P(p.x, p.y);
    if (closed && (i === 0 || i === pts.length - 1)) { pts[0] = P(p.x, p.y); pts[pts.length - 1] = P(p.x, p.y); }
  }

  function localOf(p) {
    var l = PD.node.line, doc = l.parent || { position: { x: 0, y: 0 } };
    return P(p.x - l.position.x - doc.position.x, p.y - l.position.y - doc.position.y);
  }

  function nodeEdited() {
    delete PD.node.line.userData.plazmaShape; // serbest düzenleme: parametrik bilgi geçersiz
    sceneChanged(true);
    updateNodePanel();
    render();
  }

  function nodeAction(a) {
    var l = PD.node.line, i = PD.node.sel;
    if (!l || i < 0) return;
    var pts = linePts(l);
    if (a === 'nodeApply') {
      storeUndo(true);
      var x = num('pdNX'), y = num('pdNY'), L = num('pdNL'), A = num('pdNA');
      if (x !== null && y !== null) setNode(pts, i, P(x, y));
      var n = nextIdx(pts, i);
      if (n >= 0 && L !== null && L > 0) {
        var ang = (A === null ? G.ang(pts[i], pts[n]) * 180 / Math.PI : A) * Math.PI / 180;
        setNode(pts, n, P(pts[i].x + L * Math.cos(ang), pts[i].y + L * Math.sin(ang)));
      }
      setLinePts(l, pts);
      nodeEdited();
    } else if (a === 'nodeDel') deleteNode();
    else if (a === 'nodeSplit') {
      var closed = G.isClosed(pts);
      storeUndo(true);
      if (closed) {
        // kapalı konturu aç: seçili noktadan sonraki kenar kaldırılır (çizgi o noktada biter)
        var core = pts.slice(0, -1), k = i % core.length;
        var opened = core.slice(k + 1).concat(core.slice(0, k + 1));
        setLinePts(l, opened);
        PD.node.sel = opened.length - 1;
      } else {
        if (i === 0 || i === pts.length - 1) return;
        setLinePts(l, pts.slice(0, i + 1));
        var second = makeLine(pts.slice(i), l.name, null);
        (l.parent || drawDoc()).add(second);
      }
      nodeEdited();
      toast('Çizgi bölündü');
    }
  }

  function deleteNode() {
    var l = PD.node.line, i = PD.node.sel;
    if (!l || i < 0) return;
    var pts = linePts(l), closed = G.isClosed(pts);
    if ((closed && pts.length <= 4) || (!closed && pts.length <= 2)) { toast('Daha az nokta kalamaz', 'bg-red fg-white'); return; }
    storeUndo(true);
    if (closed && (i === 0 || i === pts.length - 1)) { pts.shift(); pts[pts.length - 1] = P(pts[0].x, pts[0].y); }
    else pts.splice(i, 1);
    setLinePts(l, pts);
    PD.node.sel = -1;
    nodeEdited();
  }

  function nodeDown(e, p) {
    var pts = nodeWorldPts(), tol = 12 * pxW();
    if (PD.node.line && pts.length <= 2000) {
      var bi = -1, bd = tol;
      pts.forEach(function(q, i) { var d = G.dist(q, p); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0) {
        if (G.isClosed(pts) && bi === pts.length - 1) bi = 0;
        PD.node.sel = bi;
        PD.node.drag = true;
        PD.node.moved = false;
        updateNodePanel();
        render();
        return;
      }
      if (e.shiftKey) { // segmente nokta ekle
        var cp = G.closestOnPoly(pts, p);
        if (cp && cp.d < tol) {
          storeUndo(true);
          var lp = linePts(PD.node.line);
          lp.splice(cp.i + 1, 0, localOf(cp.p));
          setLinePts(PD.node.line, lp);
          PD.node.sel = cp.i + 1;
          nodeEdited();
          return;
        }
      }
    }
    var line = pickLine(e);
    PD.node.line = line;
    PD.node.sel = -1;
    updateNodePanel();
    render();
  }

  function nodeMove(e) {
    if (!PD.node.drag || !PD.node.line) return;
    if (!PD.node.moved) { storeUndo(true); PD.node.moved = true; }
    var pts = linePts(PD.node.line);
    setNode(pts, PD.node.sel, localOf(PD.cursor));
    setLinePts(PD.node.line, pts);
    clearSceneFlag = true;
  }

  function nodeUp() {
    if (PD.node.drag && PD.node.moved) nodeEdited();
    PD.node.drag = false;
  }

  // ---------- trim (kırp) ----------
  // Tıklanan çizgi parçası, diğer çizgilerle (ve kendisiyle) en yakın iki kesişmesi arasında silinir.
  // a-b kenarı üzerinde c-d ile kesişme parametreleri (0..1). DXF'lerde uçlar çoğu zaman diğer çizgiye
  // birkaç mikron uzak kalır: TRIM_TOL kadar açık/kısa uçlar da kesişme sayılır. Üst üste binen
  // paralel kenarlarda örtüşmenin uçları kesişmedir.
  var TRIM_TOL = 0.02;
  function segInter(a, b, c, d) {
    var rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    var la = Math.hypot(rx, ry), lc = Math.hypot(sx, sy);
    if (la < 1e-12 || lc < 1e-12) return [];
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9 * la * lc) {
      // paralel: aynı doğru üzerindeyse örtüşme uçları
      var off = Math.abs((c.x - a.x) * ry - (c.y - a.y) * rx) / la;
      if (off > TRIM_TOL) return [];
      var out = [];
      [c, d].forEach(function(p) {
        var t = ((p.x - a.x) * rx + (p.y - a.y) * ry) / (la * la);
        if (t > -TRIM_TOL / la && t < 1 + TRIM_TOL / la) out.push(Math.max(0, Math.min(1, t)));
      });
      [a, b].forEach(function(p, k) {
        var u = ((p.x - c.x) * sx + (p.y - c.y) * sy) / (lc * lc);
        if (u > -TRIM_TOL / lc && u < 1 + TRIM_TOL / lc) out.push(k);
      });
      return out;
    }
    var t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    var tt = TRIM_TOL / la, tu = TRIM_TOL / lc;
    if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) return [];
    return [Math.max(0, Math.min(1, t))];
  }
  function cumLen(pts) { var c = [0]; for (var i = 1; i < pts.length; i++) c.push(c[i - 1] + G.dist(pts[i - 1], pts[i])); return c; }
  function pointAt(pts, cum, s) {
    for (var i = 1; i < pts.length; i++) if (cum[i] >= s - 1e-12) {
      var L = cum[i] - cum[i - 1], t = L ? (s - cum[i - 1]) / L : 0;
      return P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t);
    }
    return P(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  function slice(pts, cum, sa, sb) {
    var out = [pointAt(pts, cum, sa)];
    for (var i = 0; i < pts.length; i++) if (cum[i] > sa + 1e-9 && cum[i] < sb - 1e-9) out.push(P(pts[i].x, pts[i].y));
    out.push(pointAt(pts, cum, sb));
    return G.dedupe(out);
  }
  function bboxOf(pts) { var b = G.bbox([pts]); return b; }
  function bbOverlap(a, b, m) { return !(a.x0 > b.x1 + m || a.x1 < b.x0 - m || a.y0 > b.y1 + m || a.y1 < b.y0 - m); }

  // Trim planı: { line, keep: [nokta dizileri], removed: [nokta dizileri] } veya { error }
  function trimPlan(e) {
    var line = pickLine(e);
    if (!line) return null;
    var raw = worldAt(e.clientX, e.clientY);
    var pts = linePts(line);
    if (pts.length < 2) return null;
    var closed = G.isClosed(pts), cum = cumLen(pts), total = cum[cum.length - 1];
    var cp = G.closestOnPoly(pts, raw);
    var sc = cum[cp.i] + cp.t * (cum[cp.i + 1] - cum[cp.i]);
    // kesişmeler
    var cuts = [], tb = bboxOf(pts);
    objectsInScene.forEach(function(doc) {
      doc.children.forEach(function(o) {
        if (o.type !== 'Line' || !o.geometry || !o.geometry.vertices) return;
        var op = o === line ? pts : linePts(o);
        if (op.length < 2 || !bbOverlap(tb, bboxOf(op), 1e-6)) return;
        for (var i = 0; i < pts.length - 1; i++) {
          var a = pts[i], b = pts[i + 1];
          var sb = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
          for (var j = 0; j < op.length - 1; j++) {
            if (o === line && Math.abs(i - j) <= 1) continue; // kendi komşu kenarları
            if (o === line && closed && ((i === 0 && j === op.length - 2) || (j === 0 && i === pts.length - 2))) continue;
            var c = op[j], d = op[j + 1], m = TRIM_TOL;
            if (Math.max(c.x, d.x) < sb.x0 - m || Math.min(c.x, d.x) > sb.x1 + m || Math.max(c.y, d.y) < sb.y0 - m || Math.min(c.y, d.y) > sb.y1 + m) continue;
            segInter(a, b, c, d).forEach(function(t) { cuts.push(cum[i] + t * (cum[i + 1] - cum[i])); });
          }
        }
      });
    });
    cuts.sort(function(x, y) { return x - y; });
    var uniq = [];
    cuts.forEach(function(s) { if (!uniq.length || s - uniq[uniq.length - 1] > 1e-6) uniq.push(s); });
    var keep = [], removed = [];
    if (!closed) {
      var lo = null, hi = null;
      uniq.forEach(function(s) { if (s < sc - 1e-9) lo = s; else if (s > sc + 1e-9 && hi === null) hi = s; });
      if (lo === null && hi === null) return { line: line, keep: [], removed: [pts], all: true };
      var a0 = lo === null ? 0 : lo, b0 = hi === null ? total : hi;
      if (lo !== null && lo > 1e-6) keep.push(slice(pts, cum, 0, lo));
      if (hi !== null && total - hi > 1e-6) keep.push(slice(pts, cum, hi, total));
      removed.push(slice(pts, cum, a0, b0));
    } else {
      // kapalıda başlangıç/bitiş noktası (s=0 ve s=total) aynı yer: tekrarı at
      uniq = uniq.filter(function(s) { return s < total - 1e-6; });
      if (uniq.length < 2) return { error: 'Kapalı konturu kırpmak için en az 2 kesişme gerekir' };
      var s1 = null, s2 = null;
      uniq.forEach(function(s) { if (s < sc) s1 = s; if (s > sc && s2 === null) s2 = s; });
      if (s1 === null) s1 = uniq[uniq.length - 1];
      if (s2 === null) s2 = uniq[0];
      // silinen: s1 -> s2 (sarmalı), kalan: s2 -> s1 (sarmalı)
      removed.push(s1 < s2 ? slice(pts, cum, s1, s2) : slice(pts, cum, s1, total).concat(slice(pts, cum, 0, s2).slice(1)));
      keep.push(s2 < s1 ? slice(pts, cum, s2, s1) : slice(pts, cum, s2, total).concat(slice(pts, cum, 0, s1).slice(1)));
    }
    return { line: line, keep: keep.filter(function(k) { return k.length >= 2; }), removed: removed };
  }

  PD.trimPlanAt = trimPlan; // test/hata ayıklama için

  function trimApply(plan) {
    if (!plan) return;
    if (plan.error) { toast(plan.error, 'bg-orange fg-white'); return; }
    storeUndo(true);
    var line = plan.line, parent = line.parent, uuid = line.geometry.uuid;
    // bu çizgiyi içeren toolpath'ler: bölünen parçalar onlara da eklenir (silinenler yenilemede çıkar)
    var tps = toolpathsInScene.filter(function(tp) { return tp.children.some(function(c) { return c.geometry && c.geometry.uuid === uuid; }); });
    if (!plan.keep.length) {
      parent.remove(line);
      if (plan.all) toast('Kesişme yoktu: çizgi silindi');
    } else {
      setLinePts(line, plan.keep[0]);
      delete line.userData.plazmaShape;
      for (var i = 1; i < plan.keep.length; i++) {
        var piece = makeLine(plan.keep[i], line.name, null);
        parent.add(piece);
        tps.forEach(function(tp) { var c = piece.clone(); c.userData = { closed: false }; tp.add(c); });
      }
    }
    PD.trimPlan = null;
    sceneChanged(true);
    render();
  }

  // ---------- ölçekleme (köşeden tut) ----------
  // Seçim, orijinal seçimle aynı bayrak (userData.selected): araçtan çıkınca seçim korunur.
  function selLines() { var out = []; docLinesWorld(function(l) { if (l.userData.selected) out.push(l); }); return out; }
  function worldPtsOf(l) {
    var doc = l.parent || { position: { x: 0, y: 0 } }, ox = l.position.x + doc.position.x, oy = l.position.y + doc.position.y;
    return linePts(l).map(function(p) { return P(p.x + ox, p.y + oy); });
  }
  function selBox() {
    var s = selLines();
    if (!s.length) return null;
    var b = G.bbox(s.map(worldPtsOf));
    b.w = b.x1 - b.x0; b.h = b.y1 - b.y0;
    return b;
  }
  // tutamaçlar: kutu içindeki oran (0 / 0.5 / 1)
  var HANDLES = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
  function handlePt(b, h) { return P(b.x0 + b.w * h[0], b.y0 + b.h * h[1]); }
  function hitHandle(b, q) {
    var tol = 8 * pxW(), best = null, bd = tol;
    HANDLES.forEach(function(h) {
      if ((h[0] === 0.5 && b.w < 1e-6) || (h[1] === 0.5 && b.h < 1e-6)) return;
      var d = G.dist(handlePt(b, h), q);
      if (d < bd) { bd = d; best = h; }
    });
    return best;
  }
  function inBox(b, q) { var m = 4 * pxW(); return q.x > b.x0 - m && q.x < b.x1 + m && q.y > b.y0 - m && q.y < b.y1 + m; }
  // dönüşüm: sabit nokta (ax, ay) etrafında sx, sy ölçek + (dx, dy) öteleme
  function xf(p, t) { return P(t.ax + (p.x - t.ax) * t.sx + t.dx, t.ay + (p.y - t.ay) * t.sy + t.dy); }

  function dragXf(e, q) {
    var d = PD.sc.drag, b = d.box;
    if (d.mode === 'move') return { ax: 0, ay: 0, sx: 1, sy: 1, dx: q.x - d.q0.x, dy: q.y - d.q0.y };
    var h = d.h, center = e.altKey;
    var ax = center ? b.x0 + b.w / 2 : b.x0 + b.w * (1 - h[0]), ay = center ? b.y0 + b.h / 2 : b.y0 + b.h * (1 - h[1]);
    var hp = handlePt(b, h);
    var sx = h[0] === 0.5 || Math.abs(hp.x - ax) < 1e-9 ? 1 : (q.x - ax) / (hp.x - ax);
    var sy = h[1] === 0.5 || Math.abs(hp.y - ay) < 1e-9 ? 1 : (q.y - ay) / (hp.y - ay);
    if (h[0] !== 0.5 && h[1] !== 0.5 && !e.shiftKey) { // köşe: oranı koru (fare köşegen üzerine izdüşürülür)
      var vx = hp.x - ax, vy = hp.y - ay, L2 = vx * vx + vy * vy;
      sx = sy = L2 > 1e-12 ? ((q.x - ax) * vx + (q.y - ay) * vy) / L2 : 1;
    }
    // Izgara yakalaması açıksa yeni ölçü ızgara adımına yuvarlanır (oranlıda büyük kenar esas alınır)
    var grid = parseFloat(ls('plazmaSnapGrid', '1'));
    if (ls('plazmaSnapGridOn', '1') === '1' && grid > 0 && PD.snap && PD.snap.kind === 'grid') {
      var rnd = function(len, k) { return len > 1e-6 ? Math.max(grid, Math.round(len * k / grid) * grid) / len : k; };
      if (sx === sy && h[0] !== 0.5 && h[1] !== 0.5) sx = sy = b.w >= b.h ? rnd(b.w, sx) : rnd(b.h, sy);
      else { if (h[0] !== 0.5) sx = rnd(b.w, sx); if (h[1] !== 0.5) sy = rnd(b.h, sy); }
    }
    var min = 0.01; // ters çevirme (aynalama) yok
    return { ax: ax, ay: ay, sx: Math.max(min, sx), sy: Math.max(min, sy), dx: 0, dy: 0 };
  }

  // Parametrik şekil bilgisini dönüşümle günceller; uyumsuzsa null (şekil serbest çizgi olur)
  function scaleShape(sh, t, pts) {
    var c = JSON.parse(JSON.stringify(sh)), uni = Math.abs(t.sx - t.sy) < 1e-9, s = t.sx;
    function mv(kx, ky) { var p = xf(P(c[kx], c[ky]), t); c[kx] = p.x; c[ky] = p.y; }
    if (c.type === 'rect' && (uni || !c.rot)) { mv('x', 'y'); c.w *= t.sx; c.h *= t.sy; c.r = (c.r || 0) * Math.min(t.sx, t.sy); }
    else if (!uni) return null;
    else if (c.type === 'circle') { mv('cx', 'cy'); c.d *= s; }
    else if (c.type === 'polygon') { mv('cx', 'cy'); c.R *= s; }
    else if (c.type === 'slot') { mv('x1', 'y1'); mv('x2', 'y2'); c.w *= s; }
    else if (c.type === 'arc') { mv('cx', 'cy'); c.r *= s; }
    else return null;
    Object.keys(c).forEach(function(k) { if (typeof c[k] === 'number') c[k] = Math.round(c[k] * 1e6) / 1e6; });
    // doğrulama: parametrelerden üretilen şekil, ölçeklenen çizgiyle aynı yerde mi
    var gen = PD.shapePts(c);
    if (!gen) return null;
    var a = G.bbox([gen]), b = G.bbox([pts]);
    return Math.abs(a.x0 - b.x0) + Math.abs(a.y0 - b.y0) + Math.abs(a.x1 - b.x1) + Math.abs(a.y1 - b.y1) < 0.05 ? c : null;
  }

  function applyXf(t) {
    var s = selLines();
    if (!s.length || (Math.abs(t.sx - 1) < 1e-9 && Math.abs(t.sy - 1) < 1e-9 && !t.dx && !t.dy)) return;
    storeUndo(true);
    changePositionToGeoTranslate(); // konumlar geometriye işlenir: yerel = dünya koordinatı
    s.forEach(function(l) {
      var pts = linePts(l).map(function(p) { return xf(p, t); });
      setLinePts(l, pts);
      var sh = l.userData.plazmaShape;
      if (sh) { var ns = scaleShape(sh, t, pts); if (ns) l.userData.plazmaShape = ns; else delete l.userData.plazmaShape; }
    });
    sceneChanged(true);
    scaleFill();
  }

  // Paneldeki En / Boy / % alanlarını mevcut seçime göre doldurur
  function scaleFill() {
    var b = selBox(), n = selLines().length;
    $('#pdScInfo').html(n ? '<b>' + n + '</b> şekil seçili: ' + fmt(b.w) + ' × ' + fmt(b.h) + ' mm' : 'Ölçeklenecek şekle tıklayın.');
    if (!$('#pdScW, #pdScH, #pdScP').is(':focus')) { $('#pdScW').val(b ? fmt(b.w) : ''); $('#pdScH').val(b ? fmt(b.h) : ''); $('#pdScP').val(b ? 100 : ''); }
  }
  // Oran korunuyorsa alanlar birbirini izler
  function scaleFieldInput() {
    var b = selBox();
    if (!b || ls('plazmaScaleKeep', '1') !== '1') return;
    var id = this.id, v = parseFloat(this.value);
    if (!(v > 0)) return;
    var k = id === 'pdScP' ? v / 100 : id === 'pdScW' ? (b.w > 1e-6 ? v / b.w : null) : (b.h > 1e-6 ? v / b.h : null);
    if (!k) return;
    if (id !== 'pdScW') $('#pdScW').val(fmt(b.w * k));
    if (id !== 'pdScH') $('#pdScH').val(fmt(b.h * k));
    if (id !== 'pdScP') $('#pdScP').val(fmt(k * 100));
  }

  function scaleAction(a) {
    if (a === 'scAll') { docLinesWorld(function(l) { l.userData.selected = true; }); scaleFill(); render(); return; }
    if (a === 'scNone') { deselectAllObjects(); scaleFill(); render(); return; }
    if (a !== 'scApply') return;
    var b = selBox();
    if (!b) { toast('Önce ölçeklenecek şekli seçin', 'bg-red fg-white'); return; }
    var W = num('pdScW'), H = num('pdScH'), pc = num('pdScP');
    var sx = W > 0 && b.w > 1e-6 ? W / b.w : 1, sy = H > 0 && b.h > 1e-6 ? H / b.h : 1;
    if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9 && pc > 0) sx = sy = pc / 100; // sadece % girildiyse
    if (b.w < 1e-6) sx = sy; if (b.h < 1e-6) sy = sx; // düz yatay/dikey çizgi
    var ref = $('#pdScRef').val() || 'bl';
    lsSet('plazmaScaleRef', ref);
    var ax = ref === 'c' ? b.x0 + b.w / 2 : ref.charAt(1) === 'r' ? b.x1 : b.x0;
    var ay = ref === 'c' ? b.y0 + b.h / 2 : ref.charAt(0) === 't' ? b.y1 : b.y0;
    applyXf({ ax: ax, ay: ay, sx: sx, sy: sy, dx: 0, dy: 0 });
    render();
  }

  var CURSORS = { '0,0': 'nesw-resize', '1,1': 'nesw-resize', '1,0': 'nwse-resize', '0,1': 'nwse-resize', '0.5,0': 'ns-resize', '0.5,1': 'ns-resize', '0,0.5': 'ew-resize', '1,0.5': 'ew-resize' };
  function scaleDown(e, raw) {
    var b = selBox();
    if (!b) return;
    var h = hitHandle(b, raw);
    if (h) PD.sc.drag = { mode: 'scale', h: h, box: b, q0: PD.cursor, moved: false };
    else if (inBox(b, raw)) PD.sc.drag = { mode: 'move', box: b, q0: PD.cursor, moved: false, pending: true };
  }
  function scaleMove(e) {
    var d = PD.sc.drag, raw = worldAt(e.clientX, e.clientY);
    if (d && (e.buttons & 1)) {
      if (d.pending && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4) return; // tıklama mı sürükleme mi
      d.pending = false; d.moved = true;
      d.t = dragXf(e, PD.cursor);
      return;
    }
    var b = selBox(), h = b && hitHandle(b, raw);
    $('#renderArea').css('cursor', h ? CURSORS[h.join(',')] : b && inBox(b, raw) ? 'move' : 'pointer');
  }
  function scaleUp(e) {
    var d = PD.sc.drag;
    PD.sc.drag = null;
    if (d && d.moved && d.t) { applyXf(d.t); render(); return; }
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= 6) return;
    // tıklama: şekil seç (Shift: ekle / çıkar), boşluğa tıklama seçimi bırakır
    var line = pickLine(e);
    if (line) {
      if (e.shiftKey) line.userData.selected = !line.userData.selected;
      else if (!line.userData.selected) { deselectAllObjects(); line.userData.selected = true; }
    } else if (!(d && d.mode === 'move')) deselectAllObjects();
    scaleFill();
    render();
  }

  function renderScale() {
    var d = PD.sc.drag, t = d && d.moved ? d.t : null, s = selLines(), b = selBox();
    if (b) {
      s.forEach(function(l) { // sürüklerken yeni hâli, değilse seçimi turuncu göster
        var w = worldPtsOf(l);
        addPreviewLine(t ? w.map(function(p) { return xf(p, t); }) : w, 0xff6a00, !t);
      });
      var tb = t ? { x0: xf(P(b.x0, b.y0), t).x, y0: xf(P(b.x0, b.y0), t).y, x1: xf(P(b.x1, b.y1), t).x, y1: xf(P(b.x1, b.y1), t).y } : b;
      tb.w = tb.x1 - tb.x0; tb.h = tb.y1 - tb.y0;
      addPreviewLine([P(tb.x0, tb.y0), P(tb.x1, tb.y0), P(tb.x1, tb.y1), P(tb.x0, tb.y1), P(tb.x0, tb.y0)], 0x2979ff, true);
      HANDLES.forEach(function(h) {
        if ((h[0] === 0.5 && tb.w < 1e-6) || (h[1] === 0.5 && tb.h < 1e-6)) return;
        addMarker(handlePt(tb, h), d && d.h === h ? 0xff6a00 : 0x2979ff, 4);
      });
      var r = fmt(tb.w) + ' × ' + fmt(tb.h) + ' mm';
      if (t && d.mode === 'scale') r += '  (' + (t.sx === t.sy ? fmt(t.sx * 100) + '%' : fmt(t.sx * 100) + '% × ' + fmt(t.sy * 100) + '%') + ')';
      if (t && d.mode === 'move') r = 'ΔX ' + t.dx.toFixed(2) + '  ΔY ' + t.dy.toFixed(2);
      $('#pdReadout').text(r);
    } else $('#pdReadout').text(PD.cursor ? 'X ' + PD.cursor.x.toFixed(2) + '  Y ' + PD.cursor.y.toFixed(2) : '');
    if (d && PD.snap && PD.snap.kind !== 'free') addMarker(PD.cursor, { vertex: 0x00c853, center: 0x2979ff }[PD.snap.kind] || 0x888888, 5, PD.snap.kind === 'grid');
  }

  // ---------- olaylar ----------
  var downAt = null;
  function onDown(e) {
    if (!PD.tool || e.button !== 0) return;
    if ($(e.target).closest('#plazmaDrawPanel').length) return;
    e.stopPropagation(); e.preventDefault();
    lastEvt = e;
    downAt = { x: e.clientX, y: e.clientY };
    var raw = worldAt(e.clientX, e.clientY);
    PD.snap = snapPoint(raw, e);
    PD.cursor = PD.snap.p;
    if (PD.tool === 'node') nodeDown(e, raw);
    if (PD.tool === 'scale') scaleDown(e, raw);
  }
  function onUp(e) {
    if (!PD.tool || e.button !== 0) return;
    if ($(e.target).closest('#plazmaDrawPanel').length) return;
    e.stopPropagation(); e.preventDefault();
    if (PD.tool === 'node') { nodeUp(); downAt = null; return; }
    if (PD.tool === 'scale') { scaleUp(e); downAt = null; return; }
    if (PD.tool === 'trim') {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) trimApply(trimPlan(e));
      downAt = null;
      return;
    }
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && PD.cursor) click(PD.cursor);
    downAt = null;
  }
  function onMove(e) {
    if (!PD.tool) return;
    lastEvt = e;
    var raw = worldAt(e.clientX, e.clientY);
    PD.snap = snapPoint(raw, e);
    PD.cursor = PD.snap.p;
    if (PD.tool === 'node') nodeMove(e);
    if (PD.tool === 'scale') scaleMove(e);
    if (PD.tool === 'trim' && !(e.buttons & 7) && Date.now() - (PD.trimT || 0) > 40) { PD.trimT = Date.now(); PD.trimPlan = trimPlan(e); $('#renderArea').css('cursor', PD.trimPlan && !PD.trimPlan.error ? 'pointer' : 'crosshair'); }
    render();
    if (!(e.buttons & 2) && !(e.buttons & 4)) e.stopPropagation(); // sağ/orta sürükleme kaydırma için geçsin
  }
  function onDbl(e) {
    if (!PD.tool) return;
    e.stopPropagation(); e.preventDefault();
    if (PD.tool === 'polyline') finishPolyline(false);
  }
  function onKey(e) {
    if (!PD.tool) return;
    var tag = (e.target.nodeName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var k = e.key, handled = true;
    if (k === 'Escape') cancel();
    else if (k === 'Enter') applyInput();
    else if (k === 'Backspace' || k === 'Delete') {
      if (PD.tool === 'node') deleteNode();
      else { PD.pts.pop(); render(); }
    } else if (/^[0-9.\-]$/.test(k)) {
      // Doğrudan sayı yazınca ilgili alana git
      var target = { polyline: PD.pts.length ? '#pdL' : '#pdX', rect: '#pdW', circle: '#pdD', polygon: '#pdPR', slot: '[data-ls=plazmaSlotW]', scale: '#pdScW' }[PD.tool];
      var el = target && $(target);
      if (el && el.length) { el.val('').focus(); el.val(k); } else handled = false;
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  $(function() {
    buildPanel();
    var ra = document.getElementById('renderArea');
    ra.addEventListener('mousedown', onDown, true);
    ra.addEventListener('mouseup', onUp, true);
    ra.addEventListener('mousemove', onMove, true);
    ra.addEventListener('dblclick', onDbl, true);
    window.addEventListener('keydown', onKey, true);
    // Ölçekleme sürüklemesi çizim alanının dışına taşarsa da sürsün / bitsin
    window.addEventListener('mousemove', function(e) { if (PD.tool === 'scale' && PD.sc.drag && !ra.contains(e.target)) onMove(e); }, true);
    window.addEventListener('mouseup', function(e) { if (PD.tool === 'scale' && PD.sc.drag && !ra.contains(e.target)) { scaleUp(e); downAt = null; } }, true);
    $(document).on('click', '.plazmaToolBtn', function() { PD.start($(this).data('tool')); });
  });

  PD.editLine = function(line) {
    if (PD.tool !== 'node') PD.start('node');
    PD.node = { line: line, sel: -1, drag: false, moved: false };
    updateNodePanel();
    render();
  };
  PD.linePts = linePts;
  PD.setLinePts = setLinePts;
  PD.makeLine = makeLine;
  PD.drawDoc = drawDoc;
  PD.sceneChanged = sceneChanged;
})();
