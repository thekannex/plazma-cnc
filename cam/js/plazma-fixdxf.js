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
