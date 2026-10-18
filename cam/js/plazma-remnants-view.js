// Plasma Kontrol — Tanıtılmış artık sacları çizim alanında göster (ek özellik)
// CONTROL'de "Artık Tanıt" ile torçla gezilen artıklar, makinedeki güncel iş sıfırına göre gerçek yerlerinde
// yeşil çerçeve ve adlarıyla çizilir. İçine parça çizip doğrudan kesim yapılabilir: çizimdeki koordinat,
// makinenin keseceği yerle aynıdır. Çizgiler kesilmez, seçilmez (sadece rehber).
// CONTROL bağlı değilse artığın ilk köşesi 0,0'a konur (Çalıştır'da iş sıfırı o köşeye ayarlanırsa doğru olur).
(function() {
  'use strict';
  var group = new THREE.Group();
  group.name = 'PlazmaArtiklar';
  var lastKey = '', timer = null;

  function on() { return localStorage.getItem('plazmaShowRemnants') !== '0'; }
  function base() { return typeof plazmaControlUrl === 'function' ? plazmaControlUrl() : 'http://localhost:3100'; }

  function label(text, x, y) {
    if (typeof makeSprite !== 'function') return null;
    return makeSprite(scene, 'webgl', { x: x, y: y, z: 0.5, text: text, color: '#00a83e', size: 6 });
  }

  function clear() {
    while (group.children.length) {
      var c = group.children[0];
      group.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
    }
  }

  function draw(list, st) {
    var live = st && st.connectionStatus >= 1 && st.offset;
    var ox = live ? parseFloat(st.offset.x) || 0 : 0, oy = live ? parseFloat(st.offset.y) || 0 : 0;
    var key = JSON.stringify([list.map(function(r) { return r.id; }), live ? [ox.toFixed(2), oy.toFixed(2)] : 'yok']);
    if (key === lastKey && group.children.length) return;
    lastKey = key;
    clear();
    list.forEach(function(r) {
      if (!r.points || r.points.length < 3) return;
      // makine konumu = ilk köşe (origin) + nokta; iş koordinatı = makine − iş ofseti
      var bx = live && r.origin ? r.origin.x - ox : 0, by = live && r.origin ? r.origin.y - oy : 0;
      var g = new THREE.Geometry();
      r.points.concat([r.points[0]]).forEach(function(p) { g.vertices.push(new THREE.Vector3(bx + p[0], by + p[1], -0.2)); });
      group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x00c853, transparent: true, opacity: 0.9 })));
      // ilk köşe (artığın sıfırı) işareti
      var s = 4, m = new THREE.Geometry();
      m.vertices.push(new THREE.Vector3(bx - s, by, -0.2), new THREE.Vector3(bx + s, by, -0.2), new THREE.Vector3(bx, by - s, -0.2), new THREE.Vector3(bx, by + s, -0.2));
      group.add(new THREE.LineSegments(m, new THREE.LineBasicMaterial({ color: 0x00c853 })));
      var cx = 0, cy = 0;
      r.points.forEach(function(p) { cx += p[0]; cy += p[1]; });
      var lb = label(r.name + (live ? '' : ' (bağlantı yok: ilk köşe 0,0)'), bx + cx / r.points.length, by + cy / r.points.length);
      if (lb) group.add(lb);
    });
    if (typeof clearSceneFlag !== 'undefined') clearSceneFlag = true;
  }

  function refresh() {
    if (!on()) { clear(); lastKey = ''; return; }
    if (typeof workspace !== 'undefined' && group.parent !== workspace) workspace.add(group);
    $.getJSON(base() + '/api/plazma/remnants').done(function(list) {
      $.getJSON(base() + '/api/plazma/status').done(function(st) { draw(list || [], st); }).fail(function() { draw(list || [], null); });
    });
  }

  window.plazmaToggleRemnants = function() {
    localStorage.setItem('plazmaShowRemnants', on() ? '0' : '1');
    $('#plazmaRemBtnState').text(on() ? 'açık' : 'kapalı');
    lastKey = '';
    refresh();
    Metro.toast.create('Tanıtılmış artıklar ' + (on() ? 'gösteriliyor' : 'gizlendi'), null, 2500, 'bg-green fg-white');
  };

  $(function() {
    $('#plazmaRemBtnState').text(on() ? 'açık' : 'kapalı');
    setTimeout(refresh, 1500);
    timer = setInterval(refresh, 5000);
  });
})();
