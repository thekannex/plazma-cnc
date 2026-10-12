// Plasma Kontrol — Kesim kalitesi ön işleyicisi (ek özellik)
// Plazma toolpath'leri G-code'a çevrilmeden önce geometri üzerinde çalışır (orijinal üretici değişmez):
//  - Kesim yönü: plazma arkı döndüğü için düzgün kenar hareket yönünün sağında kalır. Standart girdap
//    halkasıyla dış konturlar saat yönünde, delikler saat yönünün tersine kesilir.
//  - Başlangıç noktası: yay lead-in açıkken delme parçanın dış köşesine, yoksa en uzun düz kenarın ortasına
//    alınır (eğri üzerinde ve iç köşede giriş izi kalmaz). Lead-in'i yay son işleyicisi hurda tarafında ekler.
//  - Önce delikler: aynı toolpath içinde en içteki konturlar önce kesilir (parça kesilip kaymadan önce
//    delikleri biter), aynı seviyede en yakın kontura geçilir.
// Ayarlar: Settings → Advanced (plazmaCutDir, plazmaStartOpt, plazmaHolesFirst). Hepsi kapalıyken birebir orijinal.
(function() {
  'use strict';
  var EPS = 0.01;
  var d2 = PlazmaGeom.dist;

  function opt(id, def) { return String($('#' + id).val() || localStorage.getItem(id) || def || ''); }
  function area(r) {
    var s = 0;
    for (var i = 0; i < r.length; i++) { var a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  // G-code her yeniden üretildiğinde aynı uyarı tekrar tekrar çıkmasın
  var lastWarn = {};
  function warnOnce(key, html) {
    var now = Date.now();
    if (lastWarn[key] && now - lastWarn[key] < 8000) return;
    lastWarn[key] = now;
    Metro.toast.create(html, null, 9000, 'bg-orange fg-white');
  }

  // Line → { lead, ring (kapanış noktası olmadan) } ya da null (açık çizgi)
  function parse(child) {
    var V = child.geometry && child.geometry.vertices;
    if (!V || V.length < 4) return null;
    var n = V.length;
    if (d2(V[0], V[n - 1]) < EPS) return { lead: null, ring: V.slice(0, n - 1) };
    if (n > 4 && d2(V[1], V[n - 1]) < EPS) return { lead: V[0], ring: V.slice(1, n - 1) };
    return null;
  }

  // Parçanın dış (dışbükey) köşesi; yoksa en uzun düz kenarın ortası. Dönüş: yeni halka.
  // Kerf ofseti köşeleri küçük yaylara çevirdiği için köşe, iki düz kenar arasındaki toplam dönüşle bulunur;
  // başlangıç, köşeden sonraki düz kenarın başıdır (yay lead-in bu kenara teğet girer).
  function bestStart(ring, isHole, leadin) {
    var n = ring.length, ori = area(ring) > 0 ? 1 : -1, best = -1, bestTurn = 0, i;
    var want = isHole ? -ori : ori; // malzemenin dışbükey köşesi: dış konturda halka yönünde, delikte ters dönüş
    var longMin = Math.max(2 * leadin, 3), edgeMin = 1.5, roundMax = 6;
    for (i = 0; i < n; i++) {
      var c = ring[i], q = ring[(i + 1) % n], l2 = d2(c, q);
      if (l2 < longMin) continue;
      // geriye doğru: kısa (yuvarlatma) segmentleri geç, önceki düz kenarı bul
      var k = i, walked = 0, prev = null;
      for (var s = 0; s < n - 1; s++) {
        var a = ring[(k - 1 + n) % n], b = ring[k], l = d2(a, b);
        if (l >= edgeMin) { prev = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; break; }
        walked += l; if (walked > roundMax) break;
        k = (k - 1 + n) % n;
      }
      if (!prev) continue; // eğri üzerinde
      var nx = (q.x - c.x) / l2, ny = (q.y - c.y) / l2;
      var cr = prev.x * ny - prev.y * nx, dot = prev.x * nx + prev.y * ny;
      var turn = Math.atan2(Math.abs(cr), dot); // 0 = düz, PI/2 = dik köşe
      if (cr * want > 0 && turn > Math.PI / 6 && turn > bestTurn + 1e-6) { best = i; bestTurn = turn; }
    }
    if (best >= 0) return best === 0 ? ring : ring.slice(best).concat(ring.slice(0, best));
    // en uzun kenarın ortası (kenar yeterince uzunsa)
    var li = -1, ll = 0;
    for (i = 0; i < n; i++) { var L = d2(ring[i], ring[(i + 1) % n]); if (L > ll) { ll = L; li = i; } }
    if (li < 0 || ll < Math.max(4 * leadin, 10)) return ring; // daire gibi: olduğu gibi
    var a = ring[li], b = ring[(li + 1) % n];
    var m = a.clone(); m.x = (a.x + b.x) / 2; m.y = (a.y + b.y) / 2;
    var rest = ring.slice(li + 1).concat(ring.slice(0, li + 1));
    return [m].concat(rest);
  }

  window.plazmaQualityPrep = function(grp, ud) {
    var op = String(ud.camOperation || '');
    var tp = plazmaTpOpts(ud), dir = tp.cutDir, arc = tp.arc;
    var start = opt('plazmaStartOpt', 'on') === 'on', first = opt('plazmaHolesFirst', 'on') === 'on';
    var isIn = op.indexOf('inside') > -1, isOut = op.indexOf('outside') > -1, offsetOp = isIn || isOut;
    if (dir === 'off' && !first && !(start && arc && offsetOp)) return grp;
    var lines = [];
    grp.traverse(function(c) { if (c.type === 'Line') lines.push(c); });
    if (!lines.length || lines.some(function(c) { return c.geometry && c.geometry.type === 'CircleGeometry'; })) return grp;

    var items = lines.map(function(c) { return { c: c, p: parse(c) }; });
    var dep = PlazmaGeom.depths(items.map(function(it) { return it.p ? it.p.ring : null; }));
    items.forEach(function(it, i) {
      if (!it.p) return;
      it.depth = dep[i];
      // CAM 'outside' işlemi her konturu dışa, 'inside' içe ofsetler: kesim yönü gerçek ofsete göre
      it.hole = isIn ? true : isOut ? false : dep[i] % 2 === 1;
    });
    if (isOut && !ud.plazmaNest && items.some(function(it) { return it.p && it.depth > 0; })) {
      warnOnce('nested', '<b>Dikkat:</b> Dış (outside) toolpath\'te iç içe konturlar var. Dış (outside) işlem delikleri de dışa ofsetler, delikler <b>kerf kadar büyük</b> kesilir. Delikleri ayrı bir "Plasma: Vector (path inside)" toolpath\'ine alın.');
    }
    var mirror = grp.matrixWorld && grp.matrixWorld.determinant && grp.matrixWorld.determinant() < 0 ? -1 : 1;
    var leadin = Math.abs(parseFloat(ud.camPlasmaLeadinDist)) || 3;
    var changed = false;

    items.forEach(function(it) {
      if (!it.p) return;
      var ring = it.p.ring.slice(), lead = it.p.lead;
      if (dir !== 'off') {
        var cw = area(ring) * mirror < 0;
        var wantCw = (dir === 'std') !== it.hole; // standart: dış CW, delik CCW
        if (cw !== wantCw) { ring = [ring[0]].concat(ring.slice(1).reverse()); changed = true; }
      }
      if (start && arc && offsetOp) {
        var nr = bestStart(ring, it.hole, leadin);
        if (nr !== ring) { ring = nr; lead = null; changed = true; } // lead-in'i yay son işleyicisi hurda tarafında ekler
      }
      it.verts = (lead ? [lead] : []).concat(ring, [ring[0]]);
    });

    var order = items.slice();
    if (first) {
      var closed = items.filter(function(it) { return it.p; }), open = items.filter(function(it) { return !it.p; });
      var levels = {};
      closed.forEach(function(it) { (levels[it.depth] = levels[it.depth] || []).push(it); });
      var depths = Object.keys(levels).map(Number).sort(function(a, b) { return b - a; });
      var cur = { x: 0, y: 0 };
      order = [];
      depths.forEach(function(dp) {
        var pool = levels[dp].slice();
        while (pool.length) { // en yakın başlangıç noktası
          var bi = 0, bd = Infinity;
          pool.forEach(function(it, k) { var s = it.verts[0], dd = Math.hypot(s.x - cur.x, s.y - cur.y); if (dd < bd) { bd = dd; bi = k; } });
          var it2 = pool.splice(bi, 1)[0];
          order.push(it2);
          cur = it2.verts[it2.verts.length - 1];
        }
      });
      order = order.concat(open);
      if (order.some(function(it, k) { return it !== items[k]; })) changed = true;
    }
    if (!changed) return grp;

    var out = new THREE.Group();
    out.userData = grp.userData;
    out.matrixWorld.copy(grp.matrixWorld);
    out.matrixAutoUpdate = false;
    order.forEach(function(it) {
      var c = it.c;
      if (!it.verts) { out.add(c.clone()); return; }
      var g = new THREE.Geometry();
      g.vertices = it.verts.map(function(v) { return v.clone(); });
      var l = new THREE.Line(g, c.material);
      l.position.copy(c.position);
      l.userData = $.extend({}, c.userData);
      l.name = c.name;
      out.add(l);
    });
    out.updateMatrixWorld = function() {}; // dünya matrisi kaynaktan kopyalandı, sahneye eklenmiyor
    return out;
  };

  if (typeof window.generateGcode === 'function') {
    var origGen = window.generateGcode;
    window.generateGcode = function(index, toolpathGrp) {
      var args = [].slice.call(arguments);
      try {
        var ud = toolpathsInScene[index] && toolpathsInScene[index].userData;
        if (toolpathGrp && ud && String(ud.camOperation || '').indexOf('Plasma') === 0) {
          args[1] = plazmaQualityPrep(toolpathGrp, ud);
          // Delik (inside) toolpath'i bir dış (outside) toolpath'inden sonra mı? Parça önce kesilir, delikler kayar.
          if (ud.camOperation.indexOf('inside') > -1 && !ud.plazmaNest && toolpathsInScene.slice(0, index).some(function(t) { return String(t.userData.camOperation || '').indexOf('Plasma: Vector (path outside)') === 0; })) {
            warnOnce('order', '<b>Kesim sırası:</b> delik (inside) toolpath\'i dış kontur toolpath\'inden sonra. Parça önce kesilip kayarsa delikler kaçar. Delik toolpath\'ini ↑ düğmesiyle yukarı taşıyın.');
          }
        }
      } catch (e) {
        console.error('Plazma kalite ön işleyici hatası, orijinal geometri kullanılıyor:', e);
        args[1] = toolpathGrp;
      }
      return origGen.apply(this, args);
    };
  }
})();
