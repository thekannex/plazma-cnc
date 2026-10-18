// Plasma Kontrol — 3B görünümde makine masası (ek özellik)
// OpenBuilds makine alanı kutusunu Grbl varsayımıyla (home = 0, alan eksi tarafta) soluk gri çizer.
// FluidNC çoğu kurulumda pozitif tarafta çalışır (ör. home'da X 1540). Bu dosya makinenin kesebildiği alanı
// ($130 / $131 / $132 = max_travel) iş koordinatına çevirip turuncu çerçeveli masa olarak çizer ve
// "Masa" düğmesiyle görünümü masaya + torca sığdırır.
// Eksen alanının işareti makine konumundan öğrenilir: konum > 0 ise 0…T, < 0 ise −T…0 (bir kez görülünce saklanır).
(function() {
  'use strict';

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function travel() {
    var gp = (typeof grblParams !== 'undefined' && grblParams) ? grblParams : {};
    return { x: parseFloat(gp.$130) || 0, y: parseFloat(gp.$131) || 0, z: parseFloat(gp.$132) || 0 };
  }
  function signOf(a, m) {
    var s = ls('plazmaMspace_' + a, '');
    if (m > 0.5) s = 'pos'; else if (m < -0.5) s = 'neg';
    if (s) lsSet('plazmaMspace_' + a, s);
    return s || 'pos'; // FluidNC'de yaygın olan
  }
  function range(a, T, m) { return signOf(a, m) === 'neg' ? [-T, 0] : [0, T]; }

  var lastKey = '';
  function draw(status) {
    if (typeof THREE === 'undefined' || typeof workspace === 'undefined' || !status || !status.machine) return;
    var T = travel();
    if (!(T.x > 0 && T.y > 0)) return;
    var p = status.machine.position, o = p.offset || {};
    var ox = parseFloat(o.x) || 0, oy = parseFloat(o.y) || 0, oz = parseFloat(o.z) || 0;
    var rx = range('x', T.x, parseFloat(p.work.x) + ox), ry = range('y', T.y, parseFloat(p.work.y) + oy);
    var x0 = rx[0] - ox, x1 = rx[1] - ox, y0 = ry[0] - oy, y1 = ry[1] - oy;
    var key = [x0, x1, y0, y1].map(function(v) { return v.toFixed(2); }).join(',');
    if (key === lastKey && machineCoordinateSpace && machineCoordinateSpace.parent) return;
    lastKey = key;
    if (machineCoordinateSpace) workspace.remove(machineCoordinateSpace);
    var g = new THREE.Group();
    g.name = 'Makine masasi';
    // hafif dolgu (çizimlerin altında kalır)
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0),
      new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    plane.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.6);
    g.add(plane);
    var pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(function(q) { return new THREE.Vector3(q[0], q[1], -0.5); });
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.8 })));
    machineCoordinateSpace = g;
    workspace.add(g);
    tableBox = { x0: x0, x1: x1, y0: y0, y1: y1 };
    // G-code yüklü değilken ızgara da masanın alanını göstersin (orijinal 0…300 sabit kare yerine).
    // G-code yüklenince orijinal kod ızgarayı işin sınırlarına göre yeniden çizer.
    var noGcode = typeof object === 'undefined' || !object || !object.userData || !object.userData.bbbox2;
    if (noGcode && typeof redrawGrid === 'function') {
      xmin = x0; xmax = x1; ymin = y0; ymax = y1; // viewer.js'in genel değişkenleri (birim değişince bunlar kullanılır)
      if (typeof unit !== 'undefined' && unit === 'in') redrawGrid(x0 / 25.4, x1 / 25.4, y0 / 25.4, y1 / 25.4, true);
      else redrawGrid(x0, x1, y0, y1, false);
    }
  }

  // ---------- Dört bölgeli ızgara ----------
  // Orijinal ızgara sadece sıfırın sağını ve arkasını (+X +Y) çizer ve cetvel her milimetre için ayrı bir
  // çizgi nesnesi üretir (büyük alanda binlerce nesne). Bu sürüm sıfırın dört yanını kapsar: verilen alan
  // (G-code / masa) ve sıfıra göre simetrik; 10 / 100 mm çizgileri tek geometri, etiketler 100 mm'de bir.
  var tableBox = null;
  function gridSprite(x, y, text, color, size) {
    return typeof makeSprite === 'function' ? makeSprite(scene, 'webgl', { x: x, y: y, z: 0, text: text, color: color, size: size }) : null;
  }
  function segs(list, color, opacity) {
    var g = new THREE.Geometry();
    list.forEach(function(s) { g.vertices.push(new THREE.Vector3(s[0], s[1], 0), new THREE.Vector3(s[2], s[3], 0)); });
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: color, transparent: opacity < 1, opacity: opacity }));
  }
  window.redrawGrid = function(x0, x1, y0, y1, inches) {
    if (typeof THREE === 'undefined' || typeof gridsystem === 'undefined') return;
    var k = inches ? 25.4 : 1, step = inches ? 25.4 : 100; // ana çizgi aralığı (mm)
    var ax = Math.max(Math.abs((x0 || 0) * k), Math.abs((x1 || 0) * k), 100);
    var ay = Math.max(Math.abs((y0 || 0) * k), Math.abs((y1 || 0) * k), 100);
    if (tableBox) {
      ax = Math.max(ax, Math.abs(tableBox.x0), Math.abs(tableBox.x1));
      ay = Math.max(ay, Math.abs(tableBox.y0), Math.abs(tableBox.y1));
    }
    var Rx = Math.ceil(ax / step) * step, Ry = Math.ceil(ay / step) * step;
    sizexmax = Rx; sizeymax = Ry;
    var Th = window.Theme || {}, grid = new THREE.Group();
    grid.name = 'Grid';
    var minor = inches ? 2.54 : 10, l10 = [], l100 = [], x, y;
    for (x = -Rx; x <= Rx + 1e-6; x += minor) (Math.abs(x / step - Math.round(x / step)) < 1e-6 ? l100 : l10).push([x, -Ry, x, Ry]);
    for (y = -Ry; y <= Ry + 1e-6; y += minor) (Math.abs(y / step - Math.round(y / step)) < 1e-6 ? l100 : l10).push([-Rx, y, Rx, y]);
    grid.add(segs(l10, Th.GRID_STEP_10_COLOR || 0xdddddd, Th.GRID_STEP_10_OPACITY || 0.3));
    grid.add(segs(l100, Th.GRID_STEP_100_COLOR || 0xaaaaaa, Th.GRID_STEP_100_OPACITY || 0.6));
    // eksenler: iki yöne
    grid.add(segs([[-Rx, 0, Rx, 0]], Th.X_AXIS_LINE_COLOR || 0xcc0000, 1));
    grid.add(segs([[0, -Ry, 0, Ry]], Th.Y_AXIS_LINE_COLOR || 0x00aa00, 1));
    // etiketler: 100 mm'de bir (inçte 1"), eksi değerler dahil
    var fs = Math.max(4, Math.min(30, Math.max(Rx, Ry) / 60)), unitTxt = inches ? 25.4 : 1;
    for (x = -Rx; x <= Rx + 1e-6; x += step) { var sx = gridSprite(x, -fs * 1.6, String(Math.round(x / unitTxt)), Th.X_RULER_LABEL_COLOR || '#cc0000', fs); if (sx) grid.add(sx); }
    for (y = -Ry; y <= Ry + 1e-6; y += step) { if (Math.abs(y) < 1e-6) continue; var sy = gridSprite(-fs * 2.2, y, String(Math.round(y / unitTxt)), Th.Y_RULER_LABEL_COLOR || '#00aa00', fs); if (sy) grid.add(sy); }
    ['X', '-X'].forEach(function(t, i) { var s = gridSprite((i ? -1 : 1) * (Rx + fs * 3), 0, t, Th.X_RULER_LABEL_COLOR || '#cc0000', fs * 1.4); if (s) grid.add(s); });
    ['Y', '-Y'].forEach(function(t, i) { var s = gridSprite(0, (i ? -1 : 1) * (Ry + fs * 3), t, Th.Y_RULER_LABEL_COLOR || '#00aa00', fs * 1.4); if (s) grid.add(s); });
    gridsystem.children.length = 0;
    gridsystem.add(grid);
    helper = grid; // G-code yokken Reset View bu ızgaraya sığdırır (viewer.js genel değişkeni)
  };

  // Orijinal çizimin yerine (websocket.js iş ofseti değişince çağırır)
  window.drawMachineCoordinates = function(status) { try { draw(status); } catch (e) { console.warn('Makine masası çizilemedi', e); } };
  // Eksen işareti sonradan öğrenilirse (ilk hareketlerde) yeniden çiz
  setInterval(function() { if (typeof laststatus !== 'undefined' && laststatus && laststatus.comms && laststatus.comms.connectionStatus >= 1) window.drawMachineCoordinates(laststatus); }, 2000);

  // ---------- Tanıtılmış artık saclar ----------
  // "Artık Tanıt" ile kaydedilen artıklar masanın üstünde gerçek yerlerinde yeşil çizilir
  // (iş koordinatı = ilk köşe (makine) + nokta − iş ofseti).
  var remGroup = null, remKey = '';
  function drawRemnants(list) {
    if (typeof THREE === 'undefined' || typeof workspace === 'undefined') return;
    var st = typeof laststatus !== 'undefined' ? laststatus : null;
    var o = st && st.machine && st.machine.position && st.machine.position.offset;
    if (!o) return;
    var ox = parseFloat(o.x) || 0, oy = parseFloat(o.y) || 0;
    var key = JSON.stringify([list.map(function(r) { return [r.id, r.name, !!r.hidden]; }), ox.toFixed(2), oy.toFixed(2)]);
    if (key === remKey && remGroup && remGroup.parent === workspace) return;
    remKey = key;
    if (remGroup) workspace.remove(remGroup);
    remGroup = new THREE.Group();
    remGroup.name = 'Tanitilan artiklar';
    list.forEach(function(r) {
      if (r.hidden || !r.points || r.points.length < 3 || !r.origin) return; // listede gizlenmiş
      var bx = r.origin.x - ox, by = r.origin.y - oy;
      var pts = r.points.concat([r.points[0]]).map(function(p) { return new THREE.Vector3(bx + p[0], by + p[1], -0.4); });
      remGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00c853 })));
      var cx = 0, cy = 0;
      r.points.forEach(function(p) { cx += p[0]; cy += p[1]; });
      if (typeof makeSprite === 'function') remGroup.add(makeSprite(scene, 'webgl', { x: bx + cx / r.points.length, y: by + cy / r.points.length, z: 0, text: r.name, color: '#00a83e', size: 12 }));
    });
    workspace.add(remGroup);
  }
  setInterval(function() {
    if (typeof laststatus === 'undefined' || !laststatus || !laststatus.comms || laststatus.comms.connectionStatus < 1) return;
    $.getJSON('/api/plazma/remnants').done(function(list) { try { drawRemnants(list || []); } catch (e) {} });
  }, 5000);

  // Görünümü masaya ve torca sığdır
  window.plazmaFitTable = function() {
    if (typeof viewExtents !== 'function') return;
    if (!machineCoordinateSpace || !machineCoordinateSpace.children || !machineCoordinateSpace.children.length) {
      Metro.toast.create('Masa ölçüsü yok: makineye bağlanın (FluidNC $130/$131 bildirmeli)', null, 4000, 'bg-orange fg-white');
      return;
    }
    var grp = new THREE.Group();
    grp.add(machineCoordinateSpace.clone());
    if (typeof cone !== 'undefined' && cone) { var c = cone.clone(); c.visible = true; grp.add(c); }
    viewExtents(grp);
  };

  // Torç işareti: koni büyük masada görünmez kalıyor. Konumu koniyle aynı, boyu masaya göre (masanın ~%2'si)
  var mark = null;
  function updateMark() {
    if (typeof THREE === 'undefined' || typeof cone === 'undefined' || !cone || typeof scene === 'undefined' || !scene) return;
    var T = travel(), r = Math.max(10, Math.min(60, Math.max(T.x, T.y) * 0.02 || 15));
    if (!mark || mark.userData.r !== r) {
      if (mark && mark.parent) mark.parent.remove(mark);
      mark = new THREE.Group();
      mark.userData.r = r;
      var mat = new THREE.LineBasicMaterial({ color: 0xff1744, depthTest: false, transparent: true });
      var ring = [];
      for (var k = 0; k <= 32; k++) ring.push(new THREE.Vector3(r * Math.cos(k * Math.PI / 16), r * Math.sin(k * Math.PI / 16), 0));
      mark.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), mat));
      mark.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-r * 1.6, 0, 0), new THREE.Vector3(r * 1.6, 0, 0)]), mat));
      mark.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -r * 1.6, 0), new THREE.Vector3(0, r * 1.6, 0)]), mat));
      mark.renderOrder = 20;
    }
    if (mark.parent !== scene) scene.add(mark); // sahne yeniden kurulunca tekrar eklenir
    mark.position.set(cone.position.x, cone.position.y, 0.5);
    mark.visible = typeof laststatus !== 'undefined' && laststatus && laststatus.comms && laststatus.comms.connectionStatus >= 1;
  }
  setInterval(function() { try { updateMark(); } catch (e) {} }, 150);

  $(function() {
    var b = $('#resetViewBtn');
    if (b.length) b.after('<button id="plazmaFitTableBtn" title="Görünümü makine masasına ve torca sığdır" class="button dark drop-shadow" onclick="plazmaFitTable()"><i class="fas fa-border-all"></i> Masa</button>&nbsp;');
  });
})();
