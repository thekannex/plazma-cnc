// Plazma CONTROL — Yerleşim araçları (ek özellik, orijinal CAM kodunu değiştirmez)
//  - X / Y aynalama
//  - 9 noktadan referans seçip "Sıfıra Taşı"
//  - "Torca Hizala": referans noktasını torcun şu anki iş koordinatına taşır (CONTROL'den okunur)
// Seçili çizgi varsa sadece onları içeren dokümanlar, yoksa tüm dokümanlar işlenir.
(function() {
  'use strict';

  var ANCHORS = [
    ['tl', 'Sol Üst'], ['tc', 'Üst Orta'], ['tr', 'Sağ Üst'],
    ['ml', 'Sol Orta'], ['mc', 'Merkez'], ['mr', 'Sağ Orta'],
    ['bl', 'Sol Alt'], ['bc', 'Alt Orta'], ['br', 'Sağ Alt']
  ];

  function getAnchor() {
    var a = localStorage.getItem('plazmaAnchor');
    return ANCHORS.some(function(x) { return x[0] === a; }) ? a : 'bl';
  }

  function toast(msg, cls, ms) {
    Metro.toast.create(msg, null, ms || 3000, cls || 'bg-green fg-white');
  }

  // İşlenecek dokümanlar: seçili çizgisi olanlar, hiç seçim yoksa hepsi
  function targetDocs() {
    var sel = objectsInScene.filter(function(doc) {
      return doc.children.some(function(c) { return c.userData.selected; });
    });
    return sel.length ? sel : objectsInScene.slice();
  }

  function bboxOf(docs) {
    var box = new THREE.Box3();
    docs.forEach(function(doc) {
      doc.updateMatrixWorld(true);
      box.expandByObject(doc);
    });
    return box;
  }

  function anchorPoint(box, a) {
    var x = a[1] === 'l' ? box.min.x : a[1] === 'r' ? box.max.x : (box.min.x + box.max.x) / 2;
    var y = a[0] === 'b' ? box.min.y : a[0] === 't' ? box.max.y : (box.min.y + box.max.y) / 2;
    return { x: x, y: y };
  }

  // Doküman çizgilerinin tüm noktalarına fn uygular. reverse: çizgi yönünü korumak için (aynalamada)
  function transformDocs(docs, fn, reverse) {
    docs.forEach(function(doc) {
      doc.children.forEach(function(line) {
        if (!line.geometry || !line.geometry.vertices) return;
        line.geometry.vertices.forEach(fn);
        if (reverse) line.geometry.vertices.reverse();
        line.geometry.verticesNeedUpdate = true;
        line.geometry.computeBoundingBox();
        line.geometry.computeBoundingSphere();
      });
    });
  }

  // Toolpath'ler dokümanların kopyasını tutar; geometri uuid'si ile yeniden bağla ve yeniden hesapla
  function refreshToolpaths() {
    var byUuid = {};
    objectsInScene.forEach(function(doc) {
      doc.children.forEach(function(line) {
        if (line.geometry) byUuid[line.geometry.uuid] = line.geometry;
      });
    });
    var hadGcode = false;
    toolpathsInScene.forEach(function(tp, i) {
      if (typeof tp.userData.gcode === 'string' && tp.userData.gcode.length) hadGcode = true;
      tp.children.slice().forEach(function(child) {
        if (child.geometry && byUuid[child.geometry.uuid]) {
          child.geometry = byUuid[child.geometry.uuid];
          child.position.set(0, 0, 0);
        } else if (child.geometry) {
          tp.remove(child); // çizimden silinmiş (ör. kırpılmış) çizgi kesilmesin
        }
      });
      if (tp.userData.camOperation) toolpathPreview(i);
    });
    if (hadGcode) {
      setTimeout(function() { makeGcode(); }, 600);
    }
  }

  window.plazmaRefreshToolpaths = refreshToolpaths; // çizim/düzenleme araçları da kullanır

  function finish(msg) {
    hoverShapesinScene.length = 0;
    refreshToolpaths();
    fillTree();
    resetView();
    clearSceneFlag = true;
    if (msg) toast(msg);
  }

  function prepare() {
    if (!objectsInScene.length) {
      toast('Önce bir çizim açın (DXF / SVG)', 'bg-red fg-white');
      return null;
    }
    if (window.plazmaFixDocs) plazmaFixDocs(); // DXF ortak nokta/açık daire düzeltmesi
    storeUndo(true);
    changePositionToGeoTranslate(); // konumları geometriye işler
    return targetDocs();
  }

  window.plazmaMirror = function(axis) {
    var docs = prepare();
    if (!docs) return;
    var box = bboxOf(docs);
    var cx = box.min.x + box.max.x, cy = box.min.y + box.max.y;
    transformDocs(docs, function(v) {
      if (axis === 'x') v.x = cx - v.x; else v.y = cy - v.y;
    }, true);
    finish(axis === 'x' ? 'Yatay aynalandı (sol ↔ sağ)' : 'Dikey aynalandı (üst ↔ alt)');
  };

  // Seçilen referans noktasını (tx, ty) koordinatına taşır
  function moveAnchorTo(tx, ty, anchor) {
    var docs = prepare();
    if (!docs) return;
    var p = anchorPoint(bboxOf(docs), anchor || getAnchor());
    var dx = tx - p.x, dy = ty - p.y;
    transformDocs(docs, function(v) { v.x += dx; v.y += dy; }, false);
    finish('Taşındı: referans → X' + tx.toFixed(2) + ' Y' + ty.toFixed(2));
  }

  window.plazmaMoveToZero = function() {
    var ox = parseFloat(localStorage.getItem('plazmaZeroOffX')) || 0;
    var oy = parseFloat(localStorage.getItem('plazmaZeroOffY')) || 0;
    moveAnchorTo(ox, oy);
  };

  window.plazmaAlignToTorch = function() {
    var url = (typeof plazmaControlUrl === 'function' ? plazmaControlUrl() : 'http://localhost:3100') + '/api/plazma/status';
    fetch(url, { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(st) {
        if (!st || st.connectionStatus < 2) throw new Error('CONTROL makineye bağlı değil');
        moveAnchorTo(parseFloat(st.work.x) || 0, parseFloat(st.work.y) || 0);
      })
      .catch(function(e) {
        toast('Torç konumu okunamadı: ' + e.message, 'bg-red fg-white', 5000);
      });
  };

  window.plazmaAnchorDialog = function() {
    var cur = getAnchor();
    var ox = localStorage.getItem('plazmaZeroOffX') || 0;
    var oy = localStorage.getItem('plazmaZeroOffY') || 0;
    var grid = '<div style="display:grid; grid-template-columns:repeat(3,44px); gap:6px; border:2px dashed #888; padding:8px; width:max-content; margin:0 auto 10px;">';
    ANCHORS.forEach(function(a) {
      grid += '<label title="' + a[1] + '" style="display:flex; align-items:center; justify-content:center; height:36px; cursor:pointer; border-radius:4px;" class="plazma-anchor-cell">' +
        '<input type="radio" name="plazmaAnchor" value="' + a[0] + '"' + (a[0] === cur ? ' checked' : '') + ' style="width:18px; height:18px; cursor:pointer;"></label>';
    });
    grid += '</div>';
    Metro.dialog.create({
      title: '<i class="fas fa-crosshairs"></i> Sıfır Noktası / Hizalama',
      width: 420,
      content:
        '<div class="text-small mb-2">İşin hangi noktası referans alınsın? (Seçili parça varsa sadece o, yoksa tüm iş)</div>' +
        grid +
        '<div id="plazmaAnchorName" class="text-center text-bold mb-2"></div>' +
        '<div class="row mb-1"><div class="cell-6">Hedef X (mm)</div><div class="cell-6"><input type="number" step="0.1" id="plazmaZeroOffX" value="' + ox + '"></div></div>' +
        '<div class="row mb-2"><div class="cell-6">Hedef Y (mm)</div><div class="cell-6"><input type="number" step="0.1" id="plazmaZeroOffY" value="' + oy + '"></div></div>' +
        '<div class="text-small fg-gray">"Sıfıra Taşı": referans noktası hedef X/Y\'ye gider (genelde 0,0).<br>"Torca Hizala": referans noktası torcun şu anki konumuna gider (CONTROL bağlı olmalı).</div>',
      actions: [
        { caption: '<i class="fas fa-bullseye"></i> Sıfıra Taşı', cls: 'js-dialog-close success', onclick: function() { save(); plazmaMoveToZero(); } },
        { caption: '<i class="fas fa-fire"></i> Torca Hizala', cls: 'js-dialog-close warning', onclick: function() { save(); plazmaAlignToTorch(); } },
        { caption: 'Kapat', cls: 'js-dialog-close', onclick: function() { save(); } }
      ],
      onShow: function() { showName(); }
    });
    function showName() {
      var v = $('input[name=plazmaAnchor]:checked').val();
      var n = ANCHORS.filter(function(a) { return a[0] === v; })[0];
      $('#plazmaAnchorName').text(n ? 'Referans: ' + n[1] : '');
    }
    $(document).off('change.plazmaAnchor').on('change.plazmaAnchor', 'input[name=plazmaAnchor]', showName);
    setTimeout(showName, 50);
    function save() {
      var v = $('input[name=plazmaAnchor]:checked').val();
      if (v) localStorage.setItem('plazmaAnchor', v);
      localStorage.setItem('plazmaZeroOffX', parseFloat($('#plazmaZeroOffX').val()) || 0);
      localStorage.setItem('plazmaZeroOffY', parseFloat($('#plazmaZeroOffY').val()) || 0);
    }
  };
})();
