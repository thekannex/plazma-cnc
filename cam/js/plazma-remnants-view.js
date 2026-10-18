// Plasma Kontrol — Tanıtılmış artık saclar: çizim alanında gösterme ve liste (ek özellik)
// CONTROL'de "Artık Tanıt" ile torçla gezilen artıklar, makinedeki güncel iş sıfırına göre gerçek yerlerinde
// yeşil çerçeve ve adlarıyla çizilir. İçine parça çizip doğrudan kesim yapılabilir: çizimdeki koordinat,
// makinenin keseceği yerle aynıdır. Çizgiler kesilmez, seçilmez (sadece rehber).
// "Artıklar" düğmesi listeyi açar: göster / gizle, ad değiştir, konuma git, sil. Gizleme ve silme CONTROL'deki
// ortak kayda yazılır (CONTROL 3B görünümü ve nesting de aynı listeyi kullanır).
// CONTROL bağlı değilse artığın ilk köşesi 0,0'a konur (Çalıştır'da iş sıfırı o köşeye ayarlanırsa doğru olur).
(function() {
  'use strict';
  var group = new THREE.Group();
  group.name = 'PlazmaArtiklar';
  var lastKey = '', data = [], status = null;

  function on() { return localStorage.getItem('plazmaShowRemnants') !== '0'; }
  function base() { return typeof plazmaControlUrl === 'function' ? plazmaControlUrl() : 'http://localhost:3100'; }
  function toast(m, c) { Metro.toast.create(m, null, 3000, c || 'bg-green fg-white'); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function live() { return status && status.connectionStatus >= 1 && status.offset; }

  // İş koordinatında artığın noktaları
  function workPts(r) {
    var L = live(), ox = L ? parseFloat(status.offset.x) || 0 : 0, oy = L ? parseFloat(status.offset.y) || 0 : 0;
    var bx = L && r.origin ? r.origin.x - ox : 0, by = L && r.origin ? r.origin.y - oy : 0;
    return r.points.map(function(p) { return { x: bx + p[0], y: by + p[1] }; });
  }
  function bbox(pts) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    pts.forEach(function(p) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); });
    return b;
  }

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

  function draw() {
    var L = live();
    var key = JSON.stringify([on(), data.map(function(r) { return [r.id, r.name, !!r.hidden]; }), L ? [status.offset.x, status.offset.y] : 'yok']);
    if (key === lastKey) return;
    lastKey = key;
    clear();
    if (on()) data.forEach(function(r) {
      if (r.hidden || !r.points || r.points.length < 3) return;
      var pts = workPts(r), b = pts[0];
      var g = new THREE.Geometry();
      pts.concat([pts[0]]).forEach(function(p) { g.vertices.push(new THREE.Vector3(p.x, p.y, -0.2)); });
      group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x00c853, transparent: true, opacity: 0.9 })));
      var s = 4, m = new THREE.Geometry(); // ilk köşe (artığın sıfırı)
      m.vertices.push(new THREE.Vector3(b.x - s, b.y, -0.2), new THREE.Vector3(b.x + s, b.y, -0.2), new THREE.Vector3(b.x, b.y - s, -0.2), new THREE.Vector3(b.x, b.y + s, -0.2));
      group.add(new THREE.LineSegments(m, new THREE.LineBasicMaterial({ color: 0x00c853 })));
      var bb = bbox(pts), lb = label(r.name + (L ? '' : ' (bağlantı yok: ilk köşe 0,0)'), (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
      if (lb) group.add(lb);
    });
    if (typeof clearSceneFlag !== 'undefined') clearSceneFlag = true;
  }

  function refresh(then) {
    if (typeof workspace !== 'undefined' && group.parent !== workspace) workspace.add(group);
    $.getJSON(base() + '/api/plazma/remnants').done(function(list) {
      data = Array.isArray(list) ? list : [];
      $.getJSON(base() + '/api/plazma/status').done(function(st) { status = st; }).fail(function() { status = null; }).always(function() {
        draw(); updateBtn(); if (then) then();
      });
    }).fail(function() { if (then) then(); });
  }
  function updateBtn() {
    var vis = data.filter(function(r) { return !r.hidden; }).length;
    $('#plazmaRemBtnState').text(data.length ? (on() ? vis + ' / ' + data.length : 'kapalı') : 'yok');
  }

  function api(method, id, body) {
    return $.ajax({ url: base() + '/api/plazma/remnants/' + encodeURIComponent(id), method: method, contentType: 'application/json', data: body ? JSON.stringify(body) : undefined });
  }

  // ---------- liste penceresi ----------
  var ov = null;
  function build() {
    $('head').append('<style>' +
      '#prlOv{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2100;display:none;align-items:center;justify-content:center;}' +
      '#prlBox{background:#fff;color:#222;width:620px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;border-radius:6px;border-top:4px solid #00c853;box-shadow:0 6px 30px rgba(0,0,0,.4);font-size:13px;}' +
      '#prlBox .h{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #ddd;font-size:15px;font-weight:700;}' +
      '#prlBox .h span{flex:1}' +
      '#prlBox .b{padding:8px 14px;overflow:auto;}' +
      '#prlBox table{width:100%;border-collapse:collapse;}' +
      '#prlBox td,#prlBox th{padding:5px 4px;border-bottom:1px solid #eee;text-align:left;vertical-align:middle;}' +
      '#prlBox th{font-weight:600;color:#666;font-size:12px;}' +
      '#prlBox input[type=text]{width:100%;height:24px;border:1px solid #bbb;border-radius:3px;padding:0 4px;font-size:13px;box-sizing:border-box;}' +
      '#prlBox input[type=checkbox]{width:16px;height:16px;}' +
      '#prlBox .ic{cursor:pointer;padding:3px 6px;color:#555;}' +
      '#prlBox .ic:hover{color:#000;}' +
      '#prlBox .f{display:flex;align-items:center;gap:6px;padding:10px 14px;border-top:1px solid #ddd;}' +
      '#prlBox button{border:1px solid #999;background:#fff;border-radius:3px;padding:5px 12px;cursor:pointer;font-size:13px;}' +
      '#prlBox .muted{color:#888;font-size:12px;}' +
      '</style>');
    ov = $('<div id="prlOv"><div id="prlBox"><div class="h"><span><i class="fas fa-draw-polygon" style="color:#00c853"></i> Tanıtılmış Artık Saclar</span><span class="ic" data-a="close" style="flex:none">✕</span></div>' +
      '<div class="b"><div class="muted" id="prlInfo" style="margin-bottom:6px"></div><table id="prlTable"></table></div>' +
      '<div class="f"><label style="flex:1"><input type="checkbox" id="prlAll"> Artıkları çizim alanında göster</label>' +
      '<button data-a="refresh"><i class="fas fa-sync-alt"></i> Yenile</button><button data-a="close">Kapat</button></div></div></div>');
    $('body').append(ov);
    ov.on('click', function(e) { if (e.target === ov[0]) close(); });
    ov.on('click', '[data-a]', function() {
      var a = $(this).data('a'), id = $(this).closest('tr').data('id'), r = data.filter(function(x) { return String(x.id) === String(id); })[0];
      if (a === 'close') close();
      else if (a === 'refresh') refresh(render);
      else if (a === 'zoom' && r) {
        if (!on()) { localStorage.setItem('plazmaShowRemnants', '1'); lastKey = ''; }
        var b = bbox(workPts(r)), box = new THREE.Group(), g = new THREE.Geometry();
        g.vertices.push(new THREE.Vector3(b.x0, b.y0, 0), new THREE.Vector3(b.x1, b.y1, 0));
        box.add(new THREE.Line(g, new THREE.LineBasicMaterial()));
        draw(); close();
        if (typeof viewExtents === 'function') viewExtents(box);
      } else if (a === 'del' && r) {
        if (!confirm('"' + r.name + '" artığı silinsin mi? Nesting sac listesinden de kalkar.')) return;
        api('DELETE', r.id).done(function() { toast('Silindi: ' + esc(r.name)); refresh(render); })
          .fail(function(x) { toast('Silinemedi: ' + x.status, 'bg-red fg-white'); });
      }
    });
    ov.on('change', '.prlShow', function() {
      var id = $(this).closest('tr').data('id'), v = this.checked;
      api('POST', id, { hidden: !v }).done(function() { refresh(render); }).fail(function(x) { toast('Kaydedilemedi: ' + x.status, 'bg-red fg-white'); });
    });
    ov.on('change', '.prlName', function() {
      var id = $(this).closest('tr').data('id'), v = this.value.trim();
      if (!v) return;
      api('POST', id, { name: v }).done(function() { refresh(render); });
    });
    ov.on('change', '#prlAll', function() { localStorage.setItem('plazmaShowRemnants', this.checked ? '1' : '0'); lastKey = ''; draw(); updateBtn(); });
  }
  function render() {
    $('#prlAll').prop('checked', on());
    $('#prlInfo').html(live() ? 'Konumlar makinedeki güncel iş sıfırına göre.' : '<span style="color:#ef6c00">CONTROL makineye bağlı değil: artıkların ilk köşesi 0,0\'da gösteriliyor.</span>');
    if (!data.length) { $('#prlTable').html('<tr><td class="muted">Kayıtlı artık yok. Makine Kontrol → Plazma → <b>Artık Tanıt</b> ile ekleyin.</td></tr>'); return; }
    $('#prlTable').html('<tr><th title="Çizim alanında göster">Göster</th><th>Ad</th><th>Ölçü</th><th>Tarih</th><th></th></tr>' + data.map(function(r) {
      var b = bbox(r.points.map(function(p) { return { x: p[0], y: p[1] }; }));
      var d = r.created ? new Date(r.created).toLocaleDateString('tr-TR') : '';
      return '<tr data-id="' + esc(r.id) + '"><td><input type="checkbox" class="prlShow"' + (r.hidden ? '' : ' checked') + '></td>' +
        '<td><input type="text" class="prlName" value="' + esc(r.name) + '"></td>' +
        '<td class="muted" style="white-space:nowrap">' + Math.round(b.x1 - b.x0) + ' × ' + Math.round(b.y1 - b.y0) + ' mm · ' + r.points.length + ' köşe</td>' +
        '<td class="muted">' + d + '</td>' +
        '<td style="white-space:nowrap"><span class="ic" data-a="zoom" title="Çizim alanında konumuna git"><i class="fas fa-search-location"></i></span>' +
        '<span class="ic" data-a="del" title="Sil"><i class="fas fa-trash"></i></span></td></tr>';
    }).join(''));
  }
  function open() { if (!ov) build(); refresh(render); render(); ov.css('display', 'flex'); }
  function close() { if (ov) ov.css('display', 'none'); }

  window.plazmaRemnantList = open;
  window.plazmaToggleRemnants = open; // eski düğme adıyla uyum

  $(function() {
    setTimeout(function() { refresh(); }, 1500);
    setInterval(function() { refresh(); }, 5000);
  });
})();
