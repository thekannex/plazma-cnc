// Plasma Kontrol — seçili çizimler üzerinde işlemler (ek özellik)
// Kopyala, dizi, dairesel dizi, köşe yuvarlat, birleştir, ofset, özellikler (parametrik ölçü düzenleme)
(function() {
  'use strict';
  var G = window.PlazmaGeom, PD = window.PlazmaDraw, P = G.P;

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(msg, cls) { Metro.toast.create(msg, null, 3500, cls || 'bg-green fg-white'); }
  function fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function selectedLines() {
    var out = [];
    objectsInScene.forEach(function(doc) {
      doc.children.forEach(function(l) { if (l.type === 'Line' && l.userData.selected) out.push(l); });
    });
    return out;
  }

  function needSelection(min) {
    var s = selectedLines();
    if (s.length < (min || 1)) {
      toast('Önce çizimden ' + (min > 1 ? 'en az ' + min + ' ' : '') + 'çizgi seçin (tıklayın veya kutu ile seçin)', 'bg-red fg-white');
      return null;
    }
    return s;
  }

  // Basit form penceresi: fields = [{id, label, val, type}]
  function form(title, fields, okText, onOk, note) {
    var html = (note ? '<div class="text-small mb-2">' + note + '</div>' : '') + fields.map(function(f) {
      if (f.type === 'select') {
        return '<div class="row mb-1"><div class="cell-6">' + f.label + '</div><div class="cell-6"><select id="pe_' + f.id + '">' +
          f.options.map(function(o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(f.val) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>';
      }
      if (f.type === 'check') {
        return '<div class="row mb-1"><div class="cell-12"><label><input type="checkbox" id="pe_' + f.id + '"' + (f.val ? ' checked' : '') + '> ' + f.label + '</label></div></div>';
      }
      return '<div class="row mb-1"><div class="cell-6">' + f.label + '</div><div class="cell-6"><input type="number" step="any" id="pe_' + f.id + '" value="' + f.val + '"></div></div>';
    }).join('');
    Metro.dialog.create({
      title: title, width: 420, content: html,
      actions: [{
        caption: okText, cls: 'js-dialog-close success',
        onclick: function() {
          var v = {};
          fields.forEach(function(f) {
            var el = $('#pe_' + f.id);
            v[f.id] = f.type === 'check' ? el.is(':checked') : f.type === 'select' ? el.val() : parseFloat(el.val());
            if (f.ls) lsSet(f.ls, f.type === 'check' ? (v[f.id] ? '1' : '0') : el.val());
          });
          onOk(v);
        }
      }, { caption: 'İptal', cls: 'js-dialog-close' }]
    });
  }

  // ---------- şekil parametrelerini dönüştür ----------
  function rotP(p, c, deg) { return G.rotate([p], c, deg)[0]; }

  function transformShape(sh, dx, dy, deg, c) {
    if (!sh) return null;
    var s = JSON.parse(JSON.stringify(sh));
    function tp(x, y) { var p = P(x, y); if (deg) p = rotP(p, c, deg); return P(p.x + dx, p.y + dy); }
    var q;
    switch (s.type) {
      case 'rect': q = tp(s.x, s.y); s.x = q.x; s.y = q.y; s.rot = (s.rot || 0) + (deg || 0); break;
      case 'circle': q = tp(s.cx, s.cy); s.cx = q.x; s.cy = q.y; s.a = (s.a || 0) + (deg || 0); break;
      case 'polygon': q = tp(s.cx, s.cy); s.cx = q.x; s.cy = q.y; s.rot = (s.rot || 0) + (deg || 0); break;
      case 'arc': q = tp(s.cx, s.cy); s.cx = q.x; s.cy = q.y; s.a0 = s.a0 + (deg || 0); break;
      case 'slot': q = tp(s.x1, s.y1); var q2 = tp(s.x2, s.y2); s.x1 = q.x; s.y1 = q.y; s.x2 = q2.x; s.y2 = q2.y; break;
      default: return null;
    }
    return s;
  }

  function copyLine(line, dx, dy, deg, c) {
    var pts = PD.linePts(line);
    if (deg) pts = G.rotate(pts, c, deg);
    pts = pts.map(function(p) { return P(p.x + dx, p.y + dy); });
    var nl = PD.makeLine(pts, line.name, transformShape(line.userData.plazmaShape, dx, dy, deg, c));
    line.parent.add(nl);
    return nl;
  }

  function begin() {
    if (window.PlazmaDraw && PlazmaDraw.tool) PlazmaDraw.stop();
    if (window.plazmaFixDocs) plazmaFixDocs();
    storeUndo(true);
    changePositionToGeoTranslate();
  }

  // ---------- Kopyala ----------
  window.plazmaCopy = function() {
    var sel = needSelection();
    if (!sel) return;
    form('<i class="far fa-copy"></i> Kopyala / Taşıyarak Çoğalt', [
      { id: 'dx', label: 'X kaydırma (mm)', val: ls('plazmaCopyDX', '20'), ls: 'plazmaCopyDX' },
      { id: 'dy', label: 'Y kaydırma (mm)', val: ls('plazmaCopyDY', '0'), ls: 'plazmaCopyDY' },
      { id: 'n', label: 'Kopya sayısı', val: ls('plazmaCopyN', '1'), ls: 'plazmaCopyN' }
    ], 'Kopyala', function(v) {
      var n = Math.max(1, Math.min(500, Math.round(v.n) || 1));
      begin();
      for (var k = 1; k <= n; k++) sel.forEach(function(l) { copyLine(l, (v.dx || 0) * k, (v.dy || 0) * k); });
      PD.sceneChanged(false);
      toast(sel.length * n + ' çizgi kopyalandı');
    }, sel.length + ' çizgi seçili.');
  };

  // ---------- Dizi ----------
  window.plazmaArray = function() {
    var sel = needSelection();
    if (!sel) return;
    var b = G.bbox(sel.map(PD.linePts));
    form('<i class="fas fa-th"></i> Dizi (Satır × Sütun)', [
      { id: 'cols', label: 'Sütun (X yönünde adet)', val: ls('plazmaArrCols', '3'), ls: 'plazmaArrCols' },
      { id: 'rows', label: 'Satır (Y yönünde adet)', val: ls('plazmaArrRows', '2'), ls: 'plazmaArrRows' },
      { id: 'gx', label: 'Parçalar arası X boşluk (mm)', val: ls('plazmaArrGX', '5'), ls: 'plazmaArrGX' },
      { id: 'gy', label: 'Parçalar arası Y boşluk (mm)', val: ls('plazmaArrGY', '5'), ls: 'plazmaArrGY' }
    ], 'Diz', function(v) {
      var cols = Math.max(1, Math.round(v.cols) || 1), rows = Math.max(1, Math.round(v.rows) || 1);
      if (cols * rows > 2000) { toast('En fazla 2000 kopya', 'bg-red fg-white'); return; }
      var px = (b.x1 - b.x0) + (v.gx || 0), py = (b.y1 - b.y0) + (v.gy || 0);
      begin();
      var count = 0;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        if (!r && !c) continue;
        sel.forEach(function(l) { copyLine(l, c * px, r * py); });
        count++;
      }
      PD.sceneChanged(false);
      toast(cols + '×' + rows + ' dizi oluşturuldu (' + count + ' kopya). Parça boyu: ' + fmt(b.x1 - b.x0) + ' × ' + fmt(b.y1 - b.y0) + ' mm');
    }, 'Seçili parça boyutu: ' + fmt(b.x1 - b.x0) + ' × ' + fmt(b.y1 - b.y0) + ' mm. Boşluk, kesim için parçalar arasında bırakılacak mesafedir (kerf + birkaç mm önerilir).');
  };

  // ---------- Dairesel dizi ----------
  window.plazmaPolarArray = function() {
    var sel = needSelection();
    if (!sel) return;
    var b = G.bbox(sel.map(PD.linePts));
    form('<i class="fas fa-sync-alt"></i> Dairesel Dizi (Döndürerek Kopyala)', [
      { id: 'n', label: 'Toplam adet (orijinal dahil)', val: ls('plazmaPolN', '6'), ls: 'plazmaPolN' },
      { id: 'ang', label: 'Toplam açı (°)', val: ls('plazmaPolAng', '360'), ls: 'plazmaPolAng' },
      { id: 'cmode', label: 'Döndürme merkezi', type: 'select', val: ls('plazmaPolC', 'origin'), ls: 'plazmaPolC', options: [['origin', 'Orijin (0,0)'], ['sel', 'Seçimin merkezi'], ['custom', 'Aşağıdaki X/Y']] },
      { id: 'cx', label: 'Merkez X', val: ls('plazmaPolCX', '0'), ls: 'plazmaPolCX' },
      { id: 'cy', label: 'Merkez Y', val: ls('plazmaPolCY', '0'), ls: 'plazmaPolCY' }
    ], 'Oluştur', function(v) {
      var n = Math.max(2, Math.min(720, Math.round(v.n) || 2));
      var total = v.ang || 360;
      var step = Math.abs(Math.abs(total) - 360) < 1e-6 ? total / n : total / (n - 1);
      var c = v.cmode === 'sel' ? P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) : v.cmode === 'custom' ? P(v.cx || 0, v.cy || 0) : P(0, 0);
      begin();
      for (var k = 1; k < n; k++) sel.forEach(function(l) { copyLine(l, 0, 0, step * k, c); });
      PD.sceneChanged(false);
      toast((n - 1) + ' döndürülmüş kopya oluşturuldu (' + fmt(step) + '° aralık)');
    }, 'Örn. flanş delikleri: bir delik çizin, seçin, merkezi flanşın merkezi yapın.');
  };

  // ---------- Köşe yuvarlat ----------
  window.plazmaFillet = function() {
    var sel = needSelection();
    if (!sel) return;
    form('<i class="fas fa-bezier-curve"></i> Köşe Yuvarlat', [
      { id: 'r', label: 'Yarıçap (mm)', val: ls('plazmaFilletR', '5'), ls: 'plazmaFilletR' },
      { id: 'min', label: 'En az köşe dönüşü (°)', val: ls('plazmaFilletMin', '20'), ls: 'plazmaFilletMin' }
    ], 'Yuvarlat', function(v) {
      if (!(v.r > 0)) return;
      begin();
      var changed = 0;
      sel.forEach(function(l) {
        var sh = l.userData.plazmaShape;
        if (sh && sh.type === 'rect') { // dikdörtgende köşe yarıçapı parametre olarak kalsın
          sh.r = v.r;
          PD.setLinePts(l, PD.shapePts(sh));
          changed++;
          return;
        }
        var before = PD.linePts(l), after = G.fillet(before, v.r, isFinite(v.min) ? v.min : 20);
        if (after.length !== before.length) {
          PD.setLinePts(l, after);
          delete l.userData.plazmaShape;
          changed++;
        }
      });
      PD.sceneChanged(true);
      toast(changed ? changed + ' çizginin köşeleri yuvarlatıldı' : 'Yuvarlatılacak köşe bulunamadı (kenarlar yarıçap için kısa olabilir)', changed ? null : 'bg-orange fg-white');
    }, 'Her köşede iki kenarın da yarıçaptan yeterince uzun olması gerekir. Dairelerin küçük kırıklarına dokunmamak için "en az köşe dönüşü" kullanılır.');
  };

  // ---------- Birleştir ----------
  window.plazmaJoin = function() {
    var sel = needSelection(2);
    if (!sel) return;
    form('<i class="fas fa-link"></i> Çizgileri Birleştir', [
      { id: 'tol', label: 'Uç noktası toleransı (mm)', val: ls('plazmaJoinTol', '0.1'), ls: 'plazmaJoinTol' }
    ], 'Birleştir', function(v) {
      var open = sel.filter(function(l) { return !G.isClosed(PD.linePts(l)); });
      if (open.length < 2) { toast('Birleştirilecek en az 2 açık çizgi seçin', 'bg-red fg-white'); return; }
      begin();
      var merged = G.join(open.map(PD.linePts), v.tol > 0 ? v.tol : 0.1);
      var doc = open[0].parent;
      open.forEach(function(l) { l.parent.remove(l); });
      var closedCount = 0;
      merged.forEach(function(pts) {
        var c = G.isClosed(pts);
        if (c) closedCount++;
        doc.add(PD.makeLine(pts, c ? 'Kapalı çizgi' : 'Çizgi', null));
      });
      PD.sceneChanged(true);
      toast(open.length + ' çizgi → ' + merged.length + ' çizgi (' + closedCount + ' kapalı)');
    }, 'Uçları birbirine değen açık çizgiler tek çizgiye dönüşür; uçları buluşursa kapalı kontur olur (plazma kesimi için gerekir).');
  };

  // ---------- Ofset ----------
  window.plazmaOffset = function() {
    var sel = needSelection();
    if (!sel) return;
    form('<i class="fas fa-clone"></i> Ofset (Paralel Kontur)', [
      { id: 'd', label: 'Mesafe (mm)', val: ls('plazmaOffD', '5'), ls: 'plazmaOffD' },
      { id: 'dir', label: 'Yön', type: 'select', val: ls('plazmaOffDir', 'out'), ls: 'plazmaOffDir', options: [['out', 'Dışa'], ['in', 'İçe']] },
      { id: 'keep', label: 'Orijinali koru', type: 'check', val: ls('plazmaOffKeep', '1') === '1', ls: 'plazmaOffKeep' }
    ], 'Uygula', function(v) {
      if (!(v.d > 0)) return;
      var closed = sel.filter(function(l) { return G.isClosed(PD.linePts(l)); });
      if (!closed.length) { toast('Ofset sadece kapalı konturlarda çalışır', 'bg-red fg-white'); return; }
      begin();
      var made = 0;
      closed.forEach(function(l) {
        var res = G.offset(PD.linePts(l), v.dir === 'in' ? -v.d : v.d) || [];
        res.forEach(function(pts) { if (pts.length > 3) { l.parent.add(PD.makeLine(pts, 'Ofset', null)); made++; } });
        if (!v.keep) l.parent.remove(l);
      });
      PD.sceneChanged(!v.keep);
      toast(made ? made + ' ofset kontur oluşturuldu' : 'Ofset sonucu boş (içe ofset parçadan büyük olabilir)', made ? null : 'bg-orange fg-white');
    }, 'Bu bir çizim işlemidir. Kesimdeki kerf telafisi zaten toolpath ayarlarında yapılır.');
  };

  // ---------- Özellikler (parametrik ölçü düzenleme) ----------
  var SHAPE_FIELDS = {
    rect: [['x', 'Sol alt X'], ['y', 'Sol alt Y'], ['w', 'En'], ['h', 'Boy'], ['r', 'Köşe yarıçapı'], ['rot', 'Döndürme (°)']],
    circle: [['cx', 'Merkez X'], ['cy', 'Merkez Y'], ['d', 'Çap']],
    polygon: [['cx', 'Merkez X'], ['cy', 'Merkez Y'], ['R', 'Köşe yarıçapı'], ['n', 'Kenar sayısı'], ['rot', 'Döndürme (°)']],
    slot: [['x1', '1. merkez X'], ['y1', '1. merkez Y'], ['x2', '2. merkez X'], ['y2', '2. merkez Y'], ['w', 'Genişlik']],
    arc: [['cx', 'Merkez X'], ['cy', 'Merkez Y'], ['r', 'Yarıçap'], ['a0', 'Başlangıç açısı (°)'], ['sweep', 'Yay açısı (°, + saat yönü tersi)']]
  };
  var SHAPE_NAMES = { rect: 'Dikdörtgen', circle: 'Daire', polygon: 'Çokgen', slot: 'Kanal', arc: 'Yay' };

  // Şekil sonradan taşındıysa parametreleri güncelle; başka şekilde değiştiyse null
  function syncShape(line) {
    var sh = line.userData.plazmaShape;
    if (!sh) return null;
    var cur = PD.linePts(line), gen = PD.shapePts(sh);
    if (!gen || gen.length !== cur.length) return null;
    var dx = cur[0].x - gen[0].x, dy = cur[0].y - gen[0].y;
    for (var i = 0; i < cur.length; i++) {
      if (Math.abs(cur[i].x - gen[i].x - dx) > 1e-3 || Math.abs(cur[i].y - gen[i].y - dy) > 1e-3) return null;
    }
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      line.userData.plazmaShape = transformShape(sh, dx, dy);
    }
    return line.userData.plazmaShape;
  }

  window.plazmaProperties = function() {
    var sel = needSelection();
    if (!sel) return;
    if (sel.length > 1) { toast('Özellikler için tek çizgi seçin', 'bg-red fg-white'); return; }
    var line = sel[0];
    changePositionToGeoTranslate();
    var pts = PD.linePts(line), closed = G.isClosed(pts), b = G.bbox([pts]);
    var info = (line.name || 'Çizgi') + ' · ' + (closed ? 'kapalı' : 'açık') + ' · ' + (closed ? pts.length - 1 : pts.length) + ' nokta · çevre ' + fmt(G.polyLength(pts)) + ' mm · ' + fmt(b.x1 - b.x0) + ' × ' + fmt(b.y1 - b.y0) + ' mm';
    var sh = syncShape(line);
    if (!sh) {
      Metro.dialog.create({
        title: '<i class="fas fa-info-circle"></i> Özellikler', width: 440,
        content: '<div class="mb-2">' + info + '</div><div class="text-small">Bu çizgi ölçüyle düzenlenebilen bir şekil değil (içe aktarılmış ya da serbest düzenlenmiş). ' +
          'Noktalarını ve kenar uzunluklarını <b>Düğüm Düzenle</b> aracıyla değiştirebilir, boyut/konum/döndürme için <b>Transform</b> penceresini kullanabilirsiniz.</div>',
        actions: [
          { caption: 'Düğüm Düzenle', cls: 'js-dialog-close success', onclick: function() { PD.editLine(line); } },
          { caption: 'Kapat', cls: 'js-dialog-close' }
        ]
      });
      return;
    }
    var fields = SHAPE_FIELDS[sh.type].map(function(f) { return { id: f[0], label: f[1], val: fmt(sh[f[0]] || 0) }; });
    form('<i class="fas fa-ruler-combined"></i> ' + SHAPE_NAMES[sh.type] + ' — Ölçüler', fields, 'Uygula', function(v) {
      var ns = JSON.parse(JSON.stringify(sh));
      SHAPE_FIELDS[sh.type].forEach(function(f) { if (isFinite(v[f[0]])) ns[f[0]] = v[f[0]]; });
      if (ns.type === 'circle' && !(ns.d > 0)) return toast('Çap 0 olamaz', 'bg-red fg-white');
      if (ns.type === 'rect' && (!(ns.w > 0) || !(ns.h > 0))) return toast('En/Boy 0 olamaz', 'bg-red fg-white');
      if (ns.type === 'polygon') ns.n = Math.max(3, Math.round(ns.n));
      begin();
      line.userData.plazmaShape = ns;
      PD.setLinePts(line, PD.shapePts(ns));
      PD.sceneChanged(true);
      toast(SHAPE_NAMES[sh.type] + ' güncellendi');
    }, info);
  };
})();
