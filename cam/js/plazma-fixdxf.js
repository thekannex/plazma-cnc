// Plasma Kontrol — DXF içe aktarma düzeltmeleri (ek dosya, orijinal içe aktarıcıya dokunmaz)
// 1) Kapalı LWPOLYLINE'larda içe aktarıcı kapanış noktası olarak ilk noktanın KENDİSİNİ (aynı nesne)
//    diziye tekrar ekliyor. Noktalar taşınınca/aynalanınca bu nokta iki kez işlenip kontur bozuluyor.
//    -> Tekrarlanan nesneler kopyaya çevrilir.
// 2) DXF dairelerinde (CircleGeometry) kapanış noktası birleştirme sırasında siliniyor; daire açık
//    çizgi oluyor (son kenar eksik). -> Tam daireler kapatılır.
(function() {
  'use strict';
  var TAU = Math.PI * 2;

  function fixLine(line) {
    var g = line.geometry;
    if (!g || !g.vertices || !g.vertices.length) return false;
    var v = g.vertices, seen = new Set(), changed = false;
    for (var i = 0; i < v.length; i++) {
      if (seen.has(v[i])) { v[i] = v[i].clone(); changed = true; }
      seen.add(v[i]);
    }
    if (g.type === 'CircleGeometry') {
      // 3) Three.js r92 CircleGeometry'yi kaydederken (geri al, proje kaydı, toolpath hesabı) noktaları
      //    değil sadece yarıçap/açı parametrelerini yazar; geri yüklenince daire orijinde ve merkez
      //    noktalı olarak yeniden oluşur, taşıma/kırpma/düzenleme kaybolur.
      //    -> Aynı noktalarla düz Geometry'ye çevir (uuid korunur: toolpath bağları kopmaz).
      var th = g.parameters && g.parameters.thetaLength;
      var full = th === undefined || th === null || th >= TAU - 1e-6;
      var pts = v.slice();
      // yükleyicinin yeniden ürettiği dairelerde ilk nokta merkezdir: at
      if (pts.length > 2 && Math.abs(pts[0].x) < 1e-9 && Math.abs(pts[0].y) < 1e-9 && Math.hypot(pts[1].x, pts[1].y) > 1e-9) pts.shift();
      var a = pts[0], b = pts[pts.length - 1];
      if (full && pts.length > 2 && Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) pts.push(a.clone());
      // DXF dairelerinde merkez konum olarak tutulur (line.position): noktalara işle
      var ox = line.position.x, oy = line.position.y;
      var ng = new THREE.Geometry();
      pts.forEach(function(p) { ng.vertices.push(new THREE.Vector3(p.x + ox, p.y + oy, p.z || 0)); });
      ng.uuid = g.uuid;
      line.geometry = ng;
      line.position.x = 0; line.position.y = 0;
      g = ng;
      changed = true;
    }
    if (changed) {
      g.verticesNeedUpdate = true;
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    return changed;
  }

  function fixDoc(doc) {
    var n = 0;
    if (doc && doc.children) doc.children.forEach(function(l) { if (l.type === 'Line' && fixLine(l)) n++; });
    return n;
  }

  // Tüm dokümanları düzelt (tekrar çağrılması zararsız)
  window.plazmaFixDocs = function() {
    var n = 0;
    if (typeof objectsInScene !== 'undefined') objectsInScene.forEach(function(d) { n += fixDoc(d); });
    // toolpath'lerdeki eski CircleGeometry kopyaları: aynı uuid'li düzeltilmiş geometriye bağla, yoksa kendisini çevir
    if (typeof toolpathsInScene !== 'undefined') {
      var byUuid = {};
      objectsInScene.forEach(function(d) { d.children.forEach(function(l) { if (l.geometry) byUuid[l.geometry.uuid] = l.geometry; }); });
      toolpathsInScene.forEach(function(tp) {
        tp.children.forEach(function(c) {
          if (!c.geometry || c.geometry.type !== 'CircleGeometry') return;
          if (byUuid[c.geometry.uuid]) { c.geometry = byUuid[c.geometry.uuid]; c.position.set(0, 0, 0); }
          else fixLine(c);
          n++;
        });
      });
    }
    return n;
  };

  // 4) Ters yönlü (extrusion 210/220/230 = 0,0,-1) daire, yay ve polyline'lar. Bu nesnelerin koordinatları
  //    nesnenin kendi düzleminde (OCS) yazılır; düzlem ters bakınca X aynalanmış olur (gerçek X = -X).
  //    Bazı CAD / sac metal programları delikleri böyle kaydeder. İçe aktarıcı bunu yok sayıyor (daire ve
  //    yayda değeri hiç okumuyor), delikler X'te aynalanmış yere düşüyor. -> Ham DXF'ten okunup düzeltilir.
  //    Sadece Z eksenine paralel (düz) düzlemler; eğik düzlemdeki nesneler 2B kesimde zaten anlamsız.
  function rawExtrusions(text) {
    var lines = String(text).split(/\r?\n/), out = [], cur = null, inEnt = false, sectionName = false;
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(lines[i], 10), val = lines[i + 1].trim();
      if (code === 0) {
        cur = null;
        if (val === 'SECTION') { sectionName = true; inEnt = false; continue; }
        if (val === 'ENDSEC' || val === 'EOF') { inEnt = false; continue; }
        if (!inEnt || val === 'VERTEX' || val === 'SEQEND') continue; // VERTEX/SEQEND: POLYLINE'ın parçaları
        cur = { type: val, handle: null, n: [0, 0, 1] };
        out.push(cur);
      } else if (code === 2 && sectionName) {
        sectionName = false;
        inEnt = val === 'ENTITIES';
      } else if (cur) {
        if (code === 5) cur.handle = val;
        else if (code === 210) cur.n[0] = parseFloat(val);
        else if (code === 220) cur.n[1] = parseFloat(val);
        else if (code === 230) cur.n[2] = parseFloat(val);
      }
    }
    return out;
  }

  function flipped(n) { return n && Math.abs(n[0]) < 1 / 64 && Math.abs(n[1]) < 1 / 64 && n[2] < 0; }

  function mirrorEntity(e) {
    var TAU2 = Math.PI * 2;
    if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.center) {
      e.center.x = -e.center.x;
      if (typeof e.startAngle === 'number' && typeof e.endAngle === 'number') {
        // (cos t, sin t) -> (-cos t, sin t) = açı π - t; saat yönü tersine döner: başlangıç ve bitiş yer değiştirir
        var s = Math.PI - e.endAngle, en = Math.PI - e.startAngle;
        var len = ((en - s) % TAU2 + TAU2) % TAU2;
        if (len < 1e-9) len = TAU2;
        e.startAngle = s; e.endAngle = s + len; e.angleLength = len;
      }
      return true;
    }
    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) {
      e.vertices.forEach(function(v) { v.x = -v.x; if (v.bulge) v.bulge = -v.bulge; });
      return true;
    }
    return false;
  }

  if (window.DxfParser && window.DxfParser.prototype && typeof window.DxfParser.prototype.parseSync === 'function') {
    var origParse = window.DxfParser.prototype.parseSync;
    window.DxfParser.prototype.parseSync = function(text) {
      var dxf = origParse.apply(this, arguments);
      try {
        var ents = dxf && dxf.entities, raw = rawExtrusions(text), byHandle = {}, n = 0;
        if (!ents || !ents.length) return dxf;
        raw.forEach(function(r) { if (r.handle) byHandle[r.handle] = r; });
        var sameOrder = raw.length === ents.length && raw.every(function(r, k) { return r.type === ents[k].type; });
        ents.forEach(function(e, k) {
          var r = (e.handle && byHandle[e.handle]) || (sameOrder ? raw[k] : null);
          var nn = r ? r.n : null;
          // LWPOLYLINE / POLYLINE için ayrıştırıcının okuduğu değer de kullanılabilir
          if (!nn && typeof e.extrusionDirectionZ === 'number') nn = [e.extrusionDirectionX || 0, e.extrusionDirectionY || 0, e.extrusionDirectionZ];
          if (!nn && e.extrusionDirection) nn = [e.extrusionDirection.x || 0, e.extrusionDirection.y || 0, e.extrusionDirection.z];
          if (flipped(nn) && mirrorEntity(e)) n++;
        });
        if (n) console.info('DXF: ' + n + ' ters yönlü (extrusion -Z) nesne düzeltildi');
      } catch (err) { console.warn('DXF extrusion düzeltmesi yapılamadı', err); }
      return dxf;
    };
  }

  if (typeof window.drawDXF === 'function') {
    var origDXF = window.drawDXF;
    window.drawDXF = function() {
      var before = objectsInScene.length;
      var r = origDXF.apply(this, arguments);
      for (var i = before; i < objectsInScene.length; i++) fixDoc(objectsInScene[i]);
      return r;
    };
  }
  if (typeof window.parseLoadWorkspace === 'function') {
    var origLoad = window.parseLoadWorkspace;
    window.parseLoadWorkspace = function() {
      var r = origLoad.apply(this, arguments);
      plazmaFixDocs();
      return r;
    };
  }
})();
