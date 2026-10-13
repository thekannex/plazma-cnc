// Plasma Kontrol — Lead-in / lead-out önizlemesi (ek özellik)
// OpenBuilds'in toolpath önizlemesi (kerf bandı) giriş çizgisini göstermez; yay lead-in, bindirme ve mikro
// bağlantılar da G-code aşamasında eklenir. Bu dosya plazma toolpath'i hesaplanınca G-code'unu arka planda
// üretir ve torcun gerçekten yapacağını bandın üstüne çizer:
//   kırmızı nokta = delme, yeşil = lead-in, mavi = bindirme (lead-out), sarı = mikro bağlantı (torç kapalı)
// Çizim toolpath grubunun içindedir: görünürlüğü toolpath ile birlikte açılır / kapanır.
(function() {
  'use strict';
  var NAME = 'plazmaLeadPreview';
  var COL = { pierce: 0xff1744, lead: 0x00c853, over: 0x2979ff, joint: 0xffd600 };
  var EPS = 0.01;

  function num(code, l) { var m = new RegExp(l + '\\s*(-?[\\d.]+)', 'i').exec(code); return m ? parseFloat(m[1]) : null; }
  function d2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Yay (G2/G3) noktaları
  function arcPts(a, b, i, j, cw) {
    var cx = a.x + i, cy = a.y + j, r = Math.hypot(a.x - cx, a.y - cy);
    var a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx), TAU = 2 * Math.PI;
    var sw = cw ? -(((a0 - a1) % TAU + TAU) % TAU) : ((a1 - a0) % TAU + TAU) % TAU;
    if (Math.abs(sw) < 1e-9) sw = cw ? -TAU : TAU;
    var n = Math.max(4, Math.ceil(Math.abs(sw) / (Math.PI / 24))), out = [];
    for (var k = 1; k <= n; k++) { var t = a0 + sw * k / n; out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }); }
    return out;
  }

  // G-code → konturlar: { S: delme noktası, segs: [{ pts, kind: 'cut' | 'gap' }] }
  function parse(g) {
    var pos = { x: 0, y: 0 }, cur = null, out = [], torch = false;
    g.split('\n').forEach(function(ln) {
      var code = ln.replace(/;.*$/, ''), hasXY = /[XY]\s*-?[\d.]/i.test(code);
      if (/;\s*Tool On/i.test(ln)) { cur = { S: { x: pos.x, y: pos.y }, segs: [] }; torch = true; return; }
      if (/;\s*Tool Off/i.test(ln)) { if (cur) out.push(cur); cur = null; torch = false; return; }
      if (cur && /mikro baglanti: torc kapali/i.test(ln)) { torch = false; return; }
      if (cur && /mikro baglanti: torc acik/i.test(ln)) { torch = true; return; }
      if (!hasXY) return;
      var nx = num(code, 'X'), ny = num(code, 'Y'), np = { x: nx === null ? pos.x : nx, y: ny === null ? pos.y : ny };
      if (cur) {
        var pts = /^\s*G0*[23](?![\d.])/i.test(code) ? arcPts(pos, np, num(code, 'I') || 0, num(code, 'J') || 0, /^\s*G0*2(?![\d.])/i.test(code)) : [np];
        cur.segs.push({ a: { x: pos.x, y: pos.y }, pts: pts, end: np, kind: torch ? 'cut' : 'gap' });
      }
      pos = np;
    });
    return out;
  }

  // Konturun lead-in ve bindirme kısımlarını ayırır
  function classify(c) {
    var cuts = c.segs.filter(function(s) { return s.kind === 'cut'; });
    if (!cuts.length) return c;
    var first = cuts[0].end, lead = 0, P0;
    var recurs = function(p, from) { for (var k = from; k < cuts.length; k++) if (d2(cuts[k].end, p) < EPS) return k; return -1; };
    if (d2(c.S, first) > EPS && recurs(first, 1) > 0) { lead = 1; P0 = first; } else P0 = c.S;
    var close = recurs(P0, lead); // konturun kapandığı hareket; sonrası bindirme
    cuts.forEach(function(s, k) { s.role = k < lead ? 'lead' : close >= 0 && k > close ? 'over' : 'body'; });
    return c;
  }

  function lineObj(pts, color) {
    var g = new THREE.Geometry();
    pts.forEach(function(p) { g.vertices.push(new THREE.Vector3(p.x, p.y, 0.3)); });
    var l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: 1 }));
    l.renderOrder = 10;
    return l;
  }

  function build(g, kerf) {
    var grp = new THREE.Group();
    grp.name = NAME;
    var r = Math.max(1.5, (kerf || 1.2) * 1.2);
    parse(g).map(classify).forEach(function(c) {
      // delme noktası: küçük daire
      var ring = [];
      for (var k = 0; k <= 16; k++) ring.push({ x: c.S.x + r * Math.cos(k * Math.PI / 8), y: c.S.y + r * Math.sin(k * Math.PI / 8) });
      grp.add(lineObj(ring, COL.pierce));
      c.segs.forEach(function(s) {
        var col = s.kind === 'gap' ? COL.joint : s.role === 'lead' ? COL.lead : s.role === 'over' ? COL.over : null;
        if (col !== null) grp.add(lineObj([s.a].concat(s.pts), col));
      });
    });
    return grp;
  }

  function target(tp) {
    var inf = tp && tp.userData && tp.userData.inflated;
    if (!inf || !inf.userData) return null;
    var pretty = inf.userData.pretty;
    return pretty && pretty.children && pretty.children.length ? pretty : inf;
  }

  function show(index, g) {
    var tp = toolpathsInScene[index], t = target(tp);
    if (!t || typeof g !== 'string') return;
    var old = t.getObjectByName(NAME);
    if (old) { t.remove(old); old.traverse(function(o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    t.add(build(g, parseFloat(tp.userData.camPlasmaKerf)));
    clearSceneFlag = true;
  }

  // G-code üretimi: önizlemeyi gerçek çıktıdan güncelle (bu dosya en son yüklenir: tüm son işleyicilerden sonra)
  if (typeof window.generateGcode === 'function') {
    var origGen = window.generateGcode;
    window.generateGcode = function(index) {
      var g = origGen.apply(this, arguments);
      try {
        var ud = toolpathsInScene[index] && toolpathsInScene[index].userData;
        if (ud && String(ud.camOperation || '').indexOf('Plasma') === 0) show(index, g);
      } catch (e) { console.warn('Lead-in önizlemesi çizilemedi', e); }
      return g;
    };
  }

  // Toolpath hesaplanınca G-code beklemeden önizle (Generate'e basmadan)
  function previewNow(index) {
    var tp = toolpathsInScene[index], ud = tp && tp.userData;
    if (!ud || !ud.inflated || String(ud.camOperation || '').indexOf('Plasma') !== 0) return;
    var keepJ = window.j; // orijinal generateGcode global j'yi kullanıyor
    try {
      window.j = index;
      var off = ($('#plasmatooloff').val() || '').trim() || 'M5';
      window.generateGcode(index, ud.inflated, ud.camFeedrate, ud.camPlungerate, ud.camSpindleRpm, ud.camLaserPower, 1000, 'M3S' + ($('#scommandscale').val() || 1000), off, ud.camZClearance, false, 'No', false);
    } catch (e) { console.warn('Lead-in önizlemesi', e); } finally { window.j = keepJ; }
  }
  if (typeof window.drawToolpath === 'function') {
    var origDraw = window.drawToolpath;
    window.drawToolpath = function(index) {
      var r = origDraw.apply(this, arguments);
      var w = toolpathsInScene[index] && toolpathsInScene[index].userData.worker;
      if (w && w.addEventListener) w.addEventListener('message', function(e) { if (e.data && e.data.toolpath) setTimeout(function() { previewNow(index); }, 30); });
      return r;
    };
  }
  window.plazmaLeadPreview = previewNow;

  // ---------- Simülasyon düzeltmesi ----------
  // OpenBuilds G-code görüntüleyicisi G2/G3 yayını 20 alt parçaya böler ama hızı ve süreyi yalnız son
  // parçaya yazar; simülatör hızsız parçaların her birinde 0,6 sn bekler. Sonuç: her yay (lead-in / lead-out,
  // daireler) boyundan bağımsız ~12 sn sürer ve çok yavaş görünür. G-code'u etkilemez, sadece canlandırma.
  // Simülasyon başlamadan alt parçalara yayın hızını ve kendi uzunluklarına göre süreyi yazar.
  // Ayrıca G0 (boşta gezme) satırlarını F değeriyle değil, makinenin hızlı hareket hızıyla oynatır
  // (Settings → Plasma: Boşta Gezme Hızı); makine G0'da F'yi dikkate almaz.
  function fixArcTiming() {
    var lines = typeof object !== 'undefined' && object && object.userData && object.userData.lines;
    if (!lines || lines.__plazmaArcFix) return;
    var rapid = parseFloat($('#plazmaRapidRate').val() || localStorage.getItem('plazmaRapidRate')) || 8000;
    var prev = null, feed = null;
    for (var k = 0; k < lines.length; k++) {
      var ln = lines[k], p2 = ln && ln.p2;
      if (!p2) continue;
      if (ln.args && ln.args.feedrate > 0) feed = ln.args.feedrate;
      if (prev && (p2.g0 || (p2.g2 && feed > 0))) {
        var d = Math.sqrt(Math.pow(p2.x - prev.x, 2) + Math.pow(p2.y - prev.y, 2) + Math.pow((p2.z || 0) - (prev.z || 0), 2));
        var fr = p2.g0 ? rapid : feed;
        p2.feedrate = fr;
        p2.timeMins = d / fr * 1.32; // görüntüleyicinin ivme payı ile aynı
      }
      prev = p2;
    }
    lines.__plazmaArcFix = true;
  }
  if (typeof window.sim === 'function') {
    var origSim = window.sim;
    window.sim = function() {
      try { fixArcTiming(); } catch (e) { console.warn('Simülasyon yay süresi düzeltilemedi', e); }
      return origSim.apply(this, arguments);
    };
  }
})();
