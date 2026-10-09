// Plasma Kontrol — Kaldığı yerden devam (ek özellik)
// Ark söndüğünde, sarf bittiğinde ya da iş durdurulduğunda yüklü G-code'un istenen konturundan / noktasından
// devam eder. Torç güvenli Z'ye kalkar, noktaya gider, konturun kendi IHS ve delme dizisini çalıştırır ve
// kesime oradan devam eder. Başlangıç seçimi torcun şu anki konumuna en yakın kesim noktasıdır.
// İş, normal "Çalıştır" yolundan (iş öncesi kontrol + sac hizalama) gönderilir.
(function() {
  'use strict';
  var R = null; // { a, groups, sel: {g, s} }
  var marker = null;

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m, c) { Metro.toast.create(m, null, 4500, c || 'bg-green fg-white'); }
  function f4(v) { return (Math.round(v * 10000) / 10000).toFixed(4); }
  function hasMotion(line) { return /(^|[^A-Z])G0*[0-3](?![\d.])/i.test(line.replace(/[;(].*$/, '')); }
  function hasXY(line) { return /[XY]\s*[-+.\d]/i.test(line.replace(/[;(].*$/, '')); }

  // Konturlar: torç açma olayları; mikro bağlantı yeniden açmaları aynı konturdadır
  function buildGroups(a) {
    var info = a.info, groups = [], prevOff = -1, parca = null, ev = [];
    var partAt = [];
    a.lines.forEach(function(l, i) { var m = /;\s*-+\s*Par[çc]a\s+(\d+)/i.exec(l); if (m) parca = m[1]; partAt[i] = parca; });
    a.ons.forEach(function(o) {
      var off = o.idx + 1;
      while (off < info.length && info[off].on) off++;
      ev.push({ on: o.idx, off: off, joint: o.joint });
    });
    ev.forEach(function(e) {
      if (!e.joint || !groups.length) groups.push({ start: prevOff + 1, on: e.on, segs: [], len: 0, part: partAt[e.on] });
      var g = groups[groups.length - 1];
      g.end = e.off;
      for (var i = e.on; i < e.off && i < info.length; i++) {
        var f = info[i];
        if (f.on && f.mode >= 1 && f.mode <= 3 && f.len > 1e-6 && hasXY(a.lines[i])) {
          g.segs.push({ idx: i, s0: g.len, s1: g.len + f.len, info: f });
          g.len += f.len;
        }
      }
      prevOff = e.off;
    });
    return groups.filter(function(g) { return g.segs.length; });
  }

  function pointAt(g, s) {
    s = Math.max(0, Math.min(g.len, s));
    for (var k = 0; k < g.segs.length; k++) {
      var sg = g.segs[k];
      if (s <= sg.s1 + 1e-9 || k === g.segs.length - 1) {
        var f = sg.info, t = sg.s1 > sg.s0 ? (s - sg.s0) / (sg.s1 - sg.s0) : 0;
        // yay ve göreli satırlarda yalnız satır başından devam edilebilir
        if (f.arc || f.rel || t < 1e-4) return { k: k, x: f.x0, y: f.y0, s: sg.s0, exact: t < 1e-4 };
        if (t > 1 - 1e-6 && k + 1 < g.segs.length) return { k: k + 1, x: g.segs[k + 1].info.x0, y: g.segs[k + 1].info.y0, s: sg.s1, exact: true };
        return { k: k, x: f.x0 + (f.x1 - f.x0) * t, y: f.y0 + (f.y1 - f.y0) * t, s: s, exact: true };
      }
    }
    return null;
  }

  // Torcun konumuna en yakın kesim noktası
  function nearest(groups, px, py) {
    var best = { d: Infinity, g: 0, s: 0 };
    groups.forEach(function(g, gi) {
      g.segs.forEach(function(sg) {
        var f = sg.info, n = f.arc ? 12 : 1;
        for (var q = 0; q < n; q++) {
          var ax, ay, bx, by;
          if (f.arc) {
            var a0 = f.arc.a0 + f.arc.sweep * q / n, a1 = f.arc.a0 + f.arc.sweep * (q + 1) / n;
            ax = f.arc.cx + f.arc.r * Math.cos(a0); ay = f.arc.cy + f.arc.r * Math.sin(a0);
            bx = f.arc.cx + f.arc.r * Math.cos(a1); by = f.arc.cy + f.arc.r * Math.sin(a1);
          } else { ax = f.x0; ay = f.y0; bx = f.x1; by = f.y1; }
          var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
          var t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
          var d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
          if (d < best.d) best = { d: d, g: gi, s: sg.s0 + (sg.s1 - sg.s0) * (q + t) / n };
        }
      });
    });
    return best;
  }

  function torchWorkPos() {
    if (typeof laststatus === 'undefined' || !laststatus.machine || !laststatus.comms || laststatus.comms.connectionStatus < 1) return null;
    var w = laststatus.machine.position.work, x = parseFloat(w.x), y = parseFloat(w.y);
    if (!isFinite(x) || !isFinite(y)) return null;
    var src = R && R.src || '';
    var d = (typeof plazmaAlignAngle === 'function' && !/PLAZMA:\s*HIZALAMA YOK/i.test(src)) ? plazmaAlignAngle() : 0;
    if (d) { // G-code döndürülerek gönderildi: konumu geri döndür
      var a = -d * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      return { x: x * co - y * si, y: x * si + y * co };
    }
    return { x: x, y: y };
  }

  // ---------- devam G-code'u ----------
  function buildResume(a, g, s, safeZ) {
    var lines = a.lines, info = a.info;
    var head = ['; PLAZMA: KALDIGI YERDEN DEVAM'];
    lines.forEach(function(l) { if (/PLAZMA:\s*HIZALAMA YOK|PLAZMA-SAC:/i.test(l)) head.push(l.trim()); });
    var p = s > 0.01 ? pointAt(g, s) : null;
    var startIdx = p ? g.segs[p.k].idx : g.start;
    var st = startIdx > 0 ? info[startIdx - 1] : { inch: false, rel: false, wcs: null, f: null };
    head.push('M5', st.inch ? 'G20' : 'G21', 'G90');
    if (st.wcs) head.push(st.wcs);
    head.push('G0 Z' + safeZ);
    var body = [];
    if (!p) {
      // konturun başından: önceki konturun bitişinden sonraki her şey (güvenli Z, konuma gidiş, IHS, delme)
      if (st.rel) head.push('G91');
      if (st.f) head.push('F' + Math.round(st.f));
      body = lines.slice(g.start).filter(function(l) { return !/PLAZMA-SIFIR/i.test(l); });
    } else {
      var tgt = g.segs[p.k];
      head.push('G0 X' + f4(p.x) + ' Y' + f4(p.y));
      // konturun kendi IHS/delme dizisi (XY hareketleri hariç)
      for (var i = g.start; i < g.segs[0].idx; i++) {
        var l = lines[i];
        if (/PLAZMA-SIFIR/i.test(l)) continue;
        if (hasXY(l) && !/G\s*0*38|G\s*10|G\s*92|G\s*53/i.test(l.replace(/[;(].*$/, ''))) continue;
        body.push(l);
      }
      if (tgt.info.f) body.push('F' + Math.round(tgt.info.f));
      var first = lines[tgt.idx];
      if (!hasMotion(first)) first = 'G' + tgt.info.mode + ' ' + first.trim();
      if (tgt.info.rel) body.push('G91');
      body.push(first);
      body = body.concat(lines.slice(tgt.idx + 1));
    }
    return head.concat(body).join('\n');
  }

  // ---------- 3B işaretçi ----------
  function clearMarker() {
    if (marker && typeof scene !== 'undefined' && scene && scene.remove) scene.remove(marker);
    marker = null;
  }
  function showMarker(g, p) {
    clearMarker();
    if (typeof THREE === 'undefined' || typeof scene === 'undefined' || !scene || !scene.add) return;
    try {
      marker = new THREE.Group();
      var pts = [];
      g.segs.forEach(function(sg, k) {
        var f = sg.info;
        if (!k) pts.push(new THREE.Vector3(f.x0, f.y0, 0.5));
        if (f.arc) for (var q = 1; q <= 12; q++) { var an = f.arc.a0 + f.arc.sweep * q / 12; pts.push(new THREE.Vector3(f.arc.cx + f.arc.r * Math.cos(an), f.arc.cy + f.arc.r * Math.sin(an), 0.5)); }
        else pts.push(new THREE.Vector3(f.x1, f.y1, 0.5));
      });
      marker.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff6a00 })));
      var bb = new THREE.Box3().setFromPoints(pts), size = Math.max(4, Math.min(20, Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) * 0.04));
      var dot = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      dot.position.set(p.x, p.y, 1);
      marker.add(dot);
      scene.add(marker);
    } catch (e) { console.warn('Devam işaretçisi çizilemedi', e); }
  }

  // ---------- panel ----------
  function refresh() {
    var g = R.groups[R.sel.g];
    R.sel.s = Math.max(0, Math.min(g.len, R.sel.s));
    var p = R.sel.s > 0.01 ? pointAt(g, R.sel.s) : { x: g.segs[0].info.x0, y: g.segs[0].info.y0, s: 0 };
    $('#prsG').val(R.sel.g + 1);
    $('#prsS').attr('max', g.len.toFixed(1)).val(R.sel.s.toFixed(1));
    $('#prsGTxt').html('<b>' + (R.sel.g + 1) + '</b> / ' + R.groups.length + (g.part ? ' · Parça ' + g.part : ''));
    $('#prsSTxt').html('<b>' + p.s.toFixed(1) + '</b> / ' + g.len.toFixed(1) + ' mm');
    $('#prsInfo').html(R.sel.s <= 0.01
      ? 'Konturun <b>başından</b>: konuma gider, konturun IHS ve delme dizisini çalıştırır, konturu baştan keser.'
      : 'Torç <b>X' + p.x.toFixed(1) + ' Y' + p.y.toFixed(1) + '</b> noktasına gider, IHS ve delme yapar, konturun kalan kısmını keser.' +
        (Math.abs(p.s - R.sel.s) > 0.05 ? '<br><span style="color:#ef6c00">Yay üzerinde: yayın başına (' + p.s.toFixed(1) + ' mm) alındı.</span>' : ''));
    showMarker(g, p);
  }

  window.plazmaResumeWizard = function() {
    if (typeof editor === 'undefined' || editor.session.getLength() < 2) { toast('Önce G-code yükleyin', 'bg-red fg-white'); return; }
    var src = (typeof gcode === 'string' && gcode) ? gcode : editor.getValue();
    var a = plazmaAnalyze(src), groups = buildGroups(a);
    if (!groups.length) { toast('G-code\'da torç açık kesim bulunamadı', 'bg-red fg-white'); return; }
    R = { src: src, a: a, groups: groups, sel: { g: 0, s: 0 } };
    var tp = torchWorkPos(), near = tp ? nearest(groups, tp.x, tp.y) : null;
    if (near && near.d < 50) R.sel = { g: near.g, s: Math.max(0, near.s - parseFloat(ls('plazmaResumeBack', '2'))) };

    $('#plazmaResumePanel').remove();
    var p = $('<div id="plazmaResumePanel" class="plazma-float"><div class="pf-head"><b><i class="fas fa-step-forward" style="color:#ff6a00"></i> Kaldığı Yerden Devam</b><span class="pf-x" title="Kapat">✕</span></div><div class="pf-body">' +
      '<div style="color:#666;margin-bottom:6px">' + (near && near.d < 50 ? 'Torcun bulunduğu yere en yakın nokta seçildi (' + ls('plazmaResumeBack', '2') + ' mm geriden).' : 'Devam edilecek konturu ve noktayı seçin.') + ' Turuncu çizgi ve kırmızı nokta 3B görünümde.</div>' +
      '<div class="step"><div style="display:flex;align-items:center;gap:4px">Kontur: <span id="prsGTxt" style="flex:1"></span>' +
      '<button class="pf-btn" data-a="g-">◀</button><button class="pf-btn" data-a="g+">▶</button></div>' +
      '<input type="range" id="prsG" min="1" max="' + groups.length + '" step="1" style="width:100%"></div>' +
      '<div class="step"><div style="display:flex;align-items:center;gap:4px">Konum: <span id="prsSTxt" style="flex:1"></span></div>' +
      '<input type="range" id="prsS" min="0" step="0.5" style="width:100%">' +
      '<div><button class="pf-btn" data-a="s0">Başı</button><button class="pf-btn" data-a="-5">−5</button><button class="pf-btn" data-a="-1">−1</button><button class="pf-btn" data-a="+1">+1</button><button class="pf-btn" data-a="+5">+5</button>' +
      '<button class="pf-btn" data-a="torch" title="Torcun şu anki konumuna en yakın nokta">Torç</button></div></div>' +
      '<div id="prsInfo" style="margin:6px 0;line-height:1.35"></div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">Güvenli Z: <input type="text" id="prsZ" style="width:60px" value="' + ls('plazmaDrySafeZ', '10') + '"> mm</div>' +
      '<button class="pf-btn pri" data-a="go">▶ Buradan devam et</button>' +
      '<div style="margin-top:6px;color:#666">Devam etmeden önce torcu kontrol edin (nozul/elektrot). İş, iş öncesi kontrol ve sac hizalamadan geçerek gönderilir.</div>' +
      '</div></div>');
    $('body').append(p);
    p.find('.pf-x').on('click', function() { p.remove(); clearMarker(); });
    $('#prsG').on('input', function() { R.sel = { g: parseInt(this.value, 10) - 1, s: 0 }; refresh(); });
    $('#prsS').on('input', function() { R.sel.s = parseFloat(this.value) || 0; refresh(); });
    p.on('click', '[data-a]', function() {
      var a2 = $(this).data('a'), n = R.groups.length;
      if (a2 === 'g-') R.sel = { g: Math.max(0, R.sel.g - 1), s: 0 };
      else if (a2 === 'g+') R.sel = { g: Math.min(n - 1, R.sel.g + 1), s: 0 };
      else if (a2 === 's0') R.sel.s = 0;
      else if (/^[-+]\d+$/.test(a2)) R.sel.s += parseFloat(a2);
      else if (a2 === 'torch') {
        var t = torchWorkPos();
        if (!t) { toast('Makineye bağlı değil', 'bg-red fg-white'); return; }
        var nb = nearest(R.groups, t.x, t.y); R.sel = { g: nb.g, s: nb.s };
      } else if (a2 === 'go') { start(); return; }
      refresh();
    });
    refresh();
  };

  function start() {
    if (typeof laststatus === 'undefined' || !laststatus.comms || laststatus.comms.connectionStatus !== 2) {
      toast(laststatus && laststatus.comms && laststatus.comms.connectionStatus > 2 ? 'Makine meşgul / alarmda. Önce işi durdurun.' : 'Makineye bağlı değil', 'bg-red fg-white');
      return;
    }
    var z = parseFloat($('#prsZ').val());
    if (!(z > 0)) { toast('Güvenli Z geçersiz', 'bg-red fg-white'); return; }
    lsSet('plazmaDrySafeZ', z);
    var src = buildResume(R.a, R.groups[R.sel.g], R.sel.s, z);
    $('#plazmaResumePanel').remove();
    clearMarker();
    var keep = gcode;
    gcode = src; // Çalıştır yolundan gönder (iş öncesi kontrol + hizalama)
    try { runJobFile(); } finally { gcode = keep; }
  }

  window.plazmaBuildResume = buildResume; // test için
  window.plazmaResumeGroups = buildGroups;
})();
