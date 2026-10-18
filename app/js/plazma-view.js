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
  }

  // Orijinal çizimin yerine (websocket.js iş ofseti değişince çağırır)
  window.drawMachineCoordinates = function(status) { try { draw(status); } catch (e) { console.warn('Makine masası çizilemedi', e); } };
  // Eksen işareti sonradan öğrenilirse (ilk hareketlerde) yeniden çiz
  setInterval(function() { if (typeof laststatus !== 'undefined' && laststatus && laststatus.comms && laststatus.comms.connectionStatus >= 1) window.drawMachineCoordinates(laststatus); }, 2000);

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
