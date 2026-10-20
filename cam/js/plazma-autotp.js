// Plasma Kontrol — otomatik plazma toolpath'i (ek özellik)
// Nesting'deki gibi: seçili vektörlerden (seçim yoksa tüm kapalı vektörlerden) iç içelik derinliğine göre
//   tek derinlik (başka bir konturun içinde) = delik  -> "Plasma: Vector (path inside)"
//   çift derinlik (en dış, ya da delik içindeki ada) = dış kontur -> "Plasma: Vector (path outside)"
// iki toolpath oluşturur. Delikler önce gelir (parça kesilip düşmeden delikler kesilir).
// Açık (kapanmayan) vektörler toolpath'e alınmaz, uyarı verilir. Ayarlar son kullanılan plazma ayarlarıdır;
// toolpath'lerin "Edit" düğmesiyle değiştirilebilir.
(function() {
  'use strict';
  var CLOSE_TOL = 0.1; // addJob ile aynı kapanma toleransı

  function toast(m, c, t) { Metro.toast.create(m, null, t || 5000, c || 'bg-green fg-white'); }

  function collect() {
    var sel = [], all = [];
    objectsInScene.forEach(function(doc) {
      doc.traverse(function(child) {
        if (child.type !== 'Line' || !child.geometry || !child.geometry.vertices) return;
        var it = { doc: doc, line: child };
        all.push(it);
        if (child.userData.selected) sel.push(it);
      });
    });
    return sel.length ? { items: sel, selected: true } : { items: all, selected: false };
  }

  // Çizim alanındaki konum: addJob gibi doküman konumu + çizginin kendi konumu
  function ring(it) {
    var v = it.line.geometry.vertices, ox = it.doc.position.x + it.line.position.x, oy = it.doc.position.y + it.line.position.y;
    if (v.length < 3 || Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y) >= CLOSE_TOL) return null;
    return v.map(function(p) { return { x: p.x + ox, y: p.y + oy }; });
  }

  function makeTp(items, op, name, tpl) {
    if (!items.length) return;
    var tp = new THREE.Group();
    items.forEach(function(it) {
      var c = it.line.clone();
      c.userData = $.extend({}, it.line.userData, { closed: true, selected: false, hover: false });
      c.position.copy(it.doc.position);
      tp.add(c);
    });
    tp.name = name;
    tp.userData = $.extend({}, tpl, { camOperation: op, visible: true, plazmaAuto: true });
    toolpathsInScene.push(tp);
  }

  window.plazmaAutoToolpaths = function() {
    if (typeof objectsInScene === 'undefined' || !objectsInScene.length) { toast('Önce bir çizim yükleyin ya da çizin.', 'bg-amber'); return; }
    var c = collect(), rings = c.items.map(ring);
    var open = rings.filter(function(r) { return !r; }).length;
    var d = PlazmaGeom.depths(rings), holes = [], outers = [];
    c.items.forEach(function(it, k) { if (rings[k]) (d[k] % 2 ? holes : outers).push(it); });
    if (!holes.length && !outers.length) { toast('Kapalı vektör bulunamadı: plazma toolpath\'i için konturlar kapalı olmalı.', 'bg-amber'); return; }

    if (typeof storeUndo === 'function') storeUndo(true);
    var tpl = window.PlazmaNest && PlazmaNest.tpTemplate ? PlazmaNest.tpTemplate() : {};
    var first = toolpathsInScene.length;
    makeTp(holes, 'Plasma: Vector (path inside)', 'Delikler (' + holes.length + ')', tpl);
    makeTp(outers, 'Plasma: Vector (path outside)', 'Dış konturlar (' + outers.length + ')', tpl);

    // seçimi kaldır (toolpath'e alındı)
    c.items.forEach(function(it) { it.line.userData.selected = false; });
    $('#savetpgcode').addClass('disabled');
    $('#exportGcodeMenu').addClass('disabled');
    fillTree();
    clearSceneFlag = true;
    for (var i = first; i < toolpathsInScene.length; i++) toolpathPreview(i);

    toast((c.selected ? 'Seçili' : 'Tüm') + ' vektörlerden ' + holes.length + ' delik (path inside) ve ' + outers.length + ' dış kontur (path outside) toolpath\'i oluşturuldu. Ayarlar: toolpath\'in Edit düğmesi.' +
      (open ? ' <b>' + open + ' açık vektör alınmadı</b> (kapanmıyor).' : ''), open ? 'bg-amber' : 'bg-green fg-white', 7000);
  };

  // Düğme: "Create Toolpath" düğmesinin altında
  $(function() {
    var host = $('#tpathoverlay');
    if (!host.length || $('#plazmaAutoTpBtn').length) return;
    host.append('<div class="mt-1"><button class="button small" id="plazmaAutoTpBtn" onclick="plazmaAutoToolpaths()" ' +
      'title="Delikleri path inside, dış konturları path outside olarak ayrı toolpath\'lere ayırır. Seçim yoksa tüm çizim kullanılır.">' +
      '<span class="fas fa-fire fg-orange"></span> Plazma: Otomatik (delikler içten, dış dıştan)</button></div>');
  });
})();
