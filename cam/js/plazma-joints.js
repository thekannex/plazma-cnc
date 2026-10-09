// Plasma Kontrol — Mikro bağlantı (köprü) (ek özellik)
// Dış konturlarda parçayı sacta tutan kısa kesilmemiş köprüler bırakır: ızgaralı tablada küçük parçalar
// düşüp torca takılmaz. Köprüde torç kapanır, delme yüksekliğine kalkar, köprünün sonuna gider,
// yeniden deler (delme bekleme süresi ile) ve kesime devam eder.
// Toolpath ayar penceresinde "Plazma: Mikro bağlantı" (adet, genişlik). Adet 0 = kapalı (çıktı birebir aynı).
// İç kesimlerde (delikler) uygulanmaz.
(function() {
  'use strict';
  var EPS = 0.01;
  var reCut = /^\s*G0*1(?!\d)/i;

  function num(line, l) {
    var m = new RegExp(l + '\\s*(-?[\\d.]+)', 'i').exec(line.replace(/;.*$/, ''));
    return m ? parseFloat(m[1]) : null;
  }
  function f4(v) { return v.toFixed(4); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function insidePoly(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }
  function setXY(line, x, y) {
    return line.replace(/\s*;.*$/, '').replace(/X\s*-?[\d.]+/i, 'X' + f4(x)).replace(/Y\s*-?[\d.]+/i, 'Y' + f4(y));
  }

  // G-code içindeki kesim bloklarını bulur (orijinal üreticinin "; Tool On" / "; Tool Off" notlarına göre)
  function findBlocks(lines) {
    var blocks = [], rapid = null, pierceZ = null, cur = null;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!cur) {
        if (/^\s*G0*0(?!\d)/i.test(ln) && num(ln, 'X') !== null && num(ln, 'Y') !== null) { rapid = { x: num(ln, 'X'), y: num(ln, 'Y') }; pierceZ = null; }
        if (/Move to Pierce Height/i.test(ln)) pierceZ = num(ln, 'Z');
        if (/;\s*Tool On/i.test(ln) && rapid) cur = { on: i, onLine: ln.replace(/\s*;.*$/, ''), start: rapid, pierceZ: pierceZ, delay: null, plunge: null, cuts: [] };
      } else if (/;\s*Tool Off/i.test(ln)) {
        cur.off = i; cur.offLine = ln.replace(/\s*;.*$/, '');
        blocks.push(cur); cur = null; rapid = null;
      } else if (/Pierce Delay/i.test(ln)) {
        cur.delay = ln.replace(/\s*;.*$/, '');
      } else if (/Direct Plunge/i.test(ln)) {
        cur.plunge = ln.replace(/\s*;.*$/, '').trim();
      } else if (/^\s*G0*[23](?!\d)/i.test(ln)) {
        cur.cuts.push({ idx: i, arc: true, x: num(ln, 'X'), y: num(ln, 'Y'), f: num(ln, 'F') });
      } else if (reCut.test(ln) && num(ln, 'X') !== null && num(ln, 'Y') !== null) {
        cur.cuts.push({ idx: i, x: num(ln, 'X'), y: num(ln, 'Y'), f: num(ln, 'F') });
      }
    }
    return blocks;
  }

  // Bloğun kapalı konturunu ayırır: [lead-in] + kontur + [bindirme]
  function contourOf(b) {
    var c = b.cuts;
    if (c.length < 3 || c.some(function(k) { return k.x === null || k.y === null; })) return null;
    var lead = 0, P0;
    if (!c[0].arc && dist(b.start, c[0]) > EPS && c.slice(1).some(function(k) { return dist(k, c[0]) < EPS; })) { lead = 1; P0 = c[0]; }
    else if (c[0].arc) { lead = 1; P0 = c[0]; }
    else P0 = b.start;
    var close = -1;
    for (var k = lead; k < c.length; k++) { if (k > lead && dist(c[k], P0) < EPS) { close = k; break; } }
    if (close < 0) return null;
    var segs = c.slice(lead, close + 1);
    if (segs.some(function(s) { return s.arc; })) return null; // kontur içinde yay varsa dokunma
    var pts = [P0].concat(segs.map(function(s) { return { x: s.x, y: s.y }; }));
    return { P0: P0, segs: segs, pts: pts };
  }

  function processBlock(lines, b, ct, n, gap, edits) {
    var per = 0, i;
    for (i = 0; i < ct.pts.length - 1; i++) per += dist(ct.pts[i], ct.pts[i + 1]);
    if (per < n * gap * 4) return false; // çok küçük kontur
    if (!b.pierceZ || !b.plunge) return false;
    var feed = null;
    for (i = 0; i < b.cuts.length; i++) { if (b.cuts[i].f) { feed = b.cuts[i].f; break; } }
    if (!feed) return false;
    // olaylar: köprü başı (torç kapanır) ve sonu (yeniden delme); merkezler eşit aralıklı, lead-in'den uzak
    // Köşeye denk gelen köprü düz bir kenarın içine kaydırılır (daire gibi kısa segmentli konturlarda olduğu yerde kalır)
    var segS = [], acc = 0;
    for (i = 0; i < ct.pts.length - 1; i++) { var l = dist(ct.pts[i], ct.pts[i + 1]); segS.push([acc, acc + l]); acc += l; }
    var margin = Math.max(gap, 5), ev = [], used = [];
    for (i = 0; i < n; i++) {
      var want = per * (i + 0.5) / n, c = want, best = Infinity;
      segS.forEach(function(r) {
        var lo = r[0] + gap / 2 + margin, hi = r[1] - gap / 2 - margin;
        if (hi < lo) return;
        var cand = Math.min(hi, Math.max(lo, want));
        var clash = used.some(function(u) { return Math.abs(u - cand) < gap * 3; });
        if (!clash && Math.abs(cand - want) < best && Math.abs(cand - want) <= per / (2 * n)) { best = Math.abs(cand - want); c = cand; }
      });
      used.push(c);
    }
    used.sort(function(a, b2) { return a - b2; }).forEach(function(c) { ev.push({ s: c - gap / 2, on: false }, { s: c + gap / 2, on: true }); });
    var e = 0, s0 = 0, pos = ct.pts[0], torch = true, needF = false;
    ct.segs.forEach(function(seg) {
      var line = lines[seg.idx], A = pos, B = { x: seg.x, y: seg.y }, L = dist(A, B), s1 = s0 + L;
      var out = [], touched = false;
      if (seg.f) feed = seg.f;
      function at(s) { var k = L > 0 ? Math.min(1, Math.max(0, (s - s0) / L)) : 1; return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k }; }
      while (e < ev.length && ev[e].s <= s1 + 1e-9) {
        var p = at(ev[e].s);
        touched = true;
        if (!ev[e].on) {
          if (dist(p, A) > 1e-4) out.push(setXY(line, p.x, p.y) + (needF ? ' F' + feed : ''));
          needF = false;
          out.push(b.offLine + ' ; Plazma mikro baglanti: torc kapali', 'G0 Z' + f4(b.pierceZ));
          torch = false;
        } else {
          out.push('G0 X' + f4(p.x) + ' Y' + f4(p.y), b.onLine + ' ; Plazma mikro baglanti: torc acik');
          if (b.delay) out.push(b.delay);
          out.push(b.plunge);
          torch = true; needF = true;
        }
        e++;
      }
      if (torch && (touched || needF)) {
        var hasF = /F\s*[\d.]/i.test(line.replace(/;.*$/, ''));
        out.push(setXY(line, B.x, B.y) + (needF && !hasF ? ' F' + feed : ''));
        needF = false;
        touched = true;
      }
      if (!torch) touched = true; // köprü içindeki satır kaldırılır (S değeri torcu yeniden yakmasın)
      if (touched) edits[seg.idx] = out;
      s0 = s1; pos = B;
    });
    return true;
  }

  window.plazmaMicroJoints = function(g, n, width, kerf, allOuter) {
    if (!(n > 0) || !(width > 0)) return g;
    var lines = g.split('\n'), blocks = findBlocks(lines), edits = {};
    var cts = blocks.map(contourOf);
    var gap = width + (kerf > 0 ? kerf : 0); // kesilmeden kalan malzeme = boşluk - kerf
    var done = 0;
    blocks.forEach(function(b, bi) {
      var ct = cts[bi];
      if (!ct) return;
      if (!allOuter) { // tek derinlik = delik
        var probe = ct.pts[Math.floor(ct.pts.length / 2)], depth = 0;
        cts.forEach(function(o, oj) { if (o && oj !== bi && insidePoly(probe, o.pts)) depth++; });
        if (depth % 2 === 1) return;
      }
      if (processBlock(lines, b, ct, n, gap, edits)) done++;
    });
    if (!done) return g;
    var out = [];
    for (var m = 0; m < lines.length; m++) { if (edits[m]) out.push.apply(out, edits[m]); else out.push(lines[m]); }
    return out.join('\n');
  };

  // ---------- G-code üretimine bağlanma (yay lead-in / bindirme sonrası) ----------
  if (typeof window.generateGcode === 'function') {
    var origGen = window.generateGcode;
    window.generateGcode = function(index) {
      var g = origGen.apply(this, arguments);
      try {
        var ud = toolpathsInScene[index] && toolpathsInScene[index].userData;
        var op = ud && String(ud.camOperation || '');
        var n = ud ? parseInt(ud.plazmaJoints, 10) || 0 : 0;
        if (typeof g === 'string' && n > 0 && op.indexOf('Plasma') === 0 && op.indexOf('inside') < 0) {
          g = plazmaMicroJoints(g, n, parseFloat(ud.plazmaJointW) || 1, parseFloat(ud.camPlasmaKerf) || 0, !!ud.plazmaNest);
        }
      } catch (e) { console.error('Plazma mikro bağlantı hatası, bağlantısız G-code kullanılıyor:', e); }
      return g;
    };
  }

  // ---------- Toolpath penceresi ----------
  function inject(i) {
    if (!toolpathsInScene[i] || $('#plazmaJointRow' + i).length) return;
    var after = $('#tplasmaleadin' + i).closest('tr');
    if (!after.length) return;
    var ud = toolpathsInScene[i].userData || {}, src = ud;
    if (!ud.camOperation) { try { src = JSON.parse(localStorage.getItem('lastCamOperation')) || {}; } catch (e) { src = {}; } }
    var row = $('<tr class="inputplasma" id="plazmaJointRow' + i + '"><td>Plazma: Mikro bağlantı<br><span class="text-small">Sadece dış konturlar. 0 = kapalı</span></td><td>' +
      '<div class="input-addon" style="display:flex">' +
      '<span class="input-addon-label-left active-border"><i class="fas fa-grip-lines-vertical fa-fw" style="color:#ff6a00"></i></span>' +
      '<input type="number" class="cam-form-field active-border" id="tplazmajoints' + i + '" min="0" max="20" step="1" style="width:70px" value="' + (parseInt(src.plazmaJoints, 10) || 0) + '">' +
      '<span class="input-addon-label-right active-border">adet</span>' +
      '<input type="number" class="cam-form-field active-border" id="tplazmajointw' + i + '" min="0.1" step="0.1" style="width:70px;margin-left:6px" value="' + (parseFloat(src.plazmaJointW) || 1) + '">' +
      '<span class="input-addon-label-right active-border">mm</span>' +
      '</div></td></tr>');
    after.after(row);
    row.css('display', after.css('display') === 'none' ? 'none' : '');
    row.find('input').on('change keyup', function() { updateCamUserData(i); });
  }

  if (typeof window.setupJob === 'function') {
    var origSetup = window.setupJob;
    window.setupJob = function(i) {
      try { return origSetup.apply(this, arguments); } finally { try { inject(i); } catch (e) { console.error('Plazma mikro bağlantı satırı', e); } }
    };
  }
  if (typeof window.updateCamUserData === 'function') {
    var origUpd = window.updateCamUserData;
    window.updateCamUserData = function(i) {
      var r = origUpd.apply(this, arguments);
      if ($('#tplazmajoints' + i).length && toolpathsInScene[i]) {
        var ud = toolpathsInScene[i].userData;
        ud.plazmaJoints = Math.max(0, parseInt($('#tplazmajoints' + i).val(), 10) || 0);
        ud.plazmaJointW = Math.max(0.1, parseFloat($('#tplazmajointw' + i).val()) || 1);
        try { localStorage.setItem('lastCamOperation', JSON.stringify(ud, inflatedReplacer)); } catch (e) {}
      }
      return r;
    };
  }
})();
