// Plazma CONTROL — Plazma G-code son işleyicisi (ek özellik)
// Orijinal generateGcode() aynen çalışır; çıktısı sadece Plasma işlemlerinde ve ayar açıksa değiştirilir:
//  - Yay lead-in: düz giriş çizgisi yerine kontura teğet çeyrek daire (G2/G3).
//    CAM'in lead-in koyamadığı kapalı konturlara da hurda tarafında yay lead-in eklenir.
//  - Kontur sonu bindirme: başlangıç noktası X mm geçilerek kapatılır
//  - Küçük delikler: belirlenen boyuttan küçük kapalı konturlar düşük hızda kesilir
// Lead-in tipi ve bindirme toolpath başınadır (toolpath penceresi), küçük delik ayarları genel (Settings).
// Ayarların hepsi kapalıyken çıktı birebir orijinaldir.
(function() {
  'use strict';

  var EPS = 0.01;
  var reRapid = /^\s*G0*0(?!\d)/i;
  var reLinear = /^\s*G0*1(?!\d)/i;

  function num(line, letter) {
    var m = new RegExp(letter + '\\s*(-?[\\d.]+)', 'i').exec(line);
    return m ? parseFloat(m[1]) : null;
  }

  function setXY(line, x, y) {
    return line.replace(/X\s*-?[\d.]+/i, 'X' + x.toFixed(4)).replace(/Y\s*-?[\d.]+/i, 'Y' + y.toFixed(4));
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function insidePoly(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }

  function distToPoly(p, poly) {
    var best = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], b = poly[i + 1];
      var dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    return best;
  }

  function settings() {
    var v = function(id) { return ($('#' + id).val() || localStorage.getItem(id) || '').toString().trim(); };
    return {
      arc: v('plazmaLeadinType') === 'arc',
      overcut: Math.max(0, parseFloat(v('plazmaOvercut')) || 0),
      holeDia: Math.max(0, parseFloat(v('plazmaHoleDia')) || 0),
      holeFeed: Math.min(100, Math.max(10, parseFloat(v('plazmaHoleFeed')) || 60))
    };
  }

  // Lead-in tipi ve bindirme (lead-out) toolpath'e aittir; toolpath'te yoksa (eski işler) genel varsayılan
  window.plazmaLeadOpts = function(ud) {
    ud = ud || {};
    var t = ud.plazmaLeadinType || localStorage.getItem('plazmaLeadinType') || 'straight';
    var o = ud.plazmaOvercut !== undefined && ud.plazmaOvercut !== '' ? ud.plazmaOvercut : localStorage.getItem('plazmaOvercut');
    return { type: t, arc: t === 'arc', overcut: Math.max(0, parseFloat(o) || 0) };
  };

  // P0'da kontura teğet (P0→P1 yönünde) biten çeyrek daire yayı arar.
  // left: yay merkezi yönün solunda mı. wantInside: delme noktası konturun içinde mi olmalı.
  // Dar yerlerde yarıçapı küçülterek dener. Bulamazsa null.
  function findArc(P0, P1, left, r0, wantInside, contour) {
    var len = dist(P0, P1);
    var d = { x: (P1.x - P0.x) / len, y: (P1.y - P0.y) / len };
    var nrm = left ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
    for (var scale = 1; scale >= 0.4; scale -= 0.15) {
      var r = r0 * scale;
      if (r < 1) break;
      var C = { x: P0.x + nrm.x * r, y: P0.y + nrm.y * r };
      var S = { x: C.x - d.x * r, y: C.y - d.y * r };
      var a0 = Math.atan2(S.y - C.y, S.x - C.x), a1 = Math.atan2(P0.y - C.y, P0.x - C.x);
      var sweep = a1 - a0;
      if (left && sweep < 0) sweep += 2 * Math.PI;
      if (!left && sweep > 0) sweep -= 2 * Math.PI;
      var ok = true;
      for (var t = 0; t <= 0.8 && ok; t += 0.1) {
        var a = a0 + sweep * t;
        var q = { x: C.x + r * Math.cos(a), y: C.y + r * Math.sin(a) };
        if (insidePoly(q, contour) !== wantInside) ok = false; // hurda tarafında kal
        if (t === 0 && distToPoly(q, contour) < r * 0.4) ok = false; // delme noktası kontura çok yakın olmasın
      }
      if (ok) return { S: S, C: C, left: left };
    }
    return null;
  }

  function arcLineFrom(template, P0, arc) {
    var l = setXY(template, P0.x, P0.y).replace(/\s*;.*$/, '').replace(reLinear, arc.left ? 'G3' : 'G2');
    return l.replace(/(Y\s*-?[\d.]+)/i, '$1 I' + (arc.C.x - arc.S.x).toFixed(4) + ' J' + (arc.C.y - arc.S.y).toFixed(4)) + ' ; Plazma yay lead-in';
  }

  // Tek bir kesim bloğunu işler. edits[idx] = yerine geçecek satır dizisi
  function processBlock(lines, rapidIdx, cuts, cfg, edits, ctx) {
    if (rapidIdx < 0 || cuts.length < 3) return;
    var L = { x: num(lines[rapidIdx], 'X'), y: num(lines[rapidIdx], 'Y') };
    if (L.x === null || L.y === null) return;
    var pts = cuts.map(function(c) { return { x: c.x, y: c.y }; });
    var n = pts.length;
    var hasLead = dist(pts[0], pts[n - 1]) < EPS && dist(L, pts[0]) > EPS;
    var contour = hasLead ? pts : (dist(L, pts[n - 1]) < EPS ? [L].concat(pts) : null);
    if (!contour) return; // açık kontur: dokunma

    var lineOut = {};
    cuts.forEach(function(c) { lineOut[c.idx] = lines[c.idx]; });
    var prefix = []; // ilk kesim satırından önce eklenecek satırlar

    // Küçük delik: hız düşür
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    contour.forEach(function(p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var slow = cfg.holeDia > 0 && Math.max(maxX - minX, maxY - minY) < cfg.holeDia;
    if (slow) {
      cuts.forEach(function(c) {
        lineOut[c.idx] = lineOut[c.idx].replace(/F\s*([\d.]+)/i, function(m, f) {
          return 'F' + Math.round(parseFloat(f) * cfg.holeFeed / 100);
        });
      });
    }

    // Yay lead-in
    if (cfg.arc) {
      var P0 = contour[0], P1 = null;
      for (var k = 1; k < contour.length; k++) {
        if (dist(contour[k], P0) > 0.001) { P1 = contour[k]; break; }
      }
      if (P1) {
        var arc = null;
        if (hasLead) {
          // CAM'in düz lead-in'i var: aynı tarafta yay
          var d = { x: P1.x - P0.x, y: P1.y - P0.y };
          var left = d.x * (L.y - P0.y) - d.y * (L.x - P0.x) > 0;
          var r0 = dist(L, P0);
          if (r0 > 0.3) arc = findArc(P0, P1, left, r0, insidePoly(L, contour), contour);
          if (arc) lineOut[cuts[0].idx] = arcLineFrom(lineOut[cuts[0].idx], P0, arc);
        } else if (ctx.scrap !== null) {
          // Lead-in yok (delme kontur üstünde): hurda tarafında yeni yay lead-in.
          // CAM 'outside' işleminde her konturu dışa ofsetler (iç içe olanları da), 'inside' işleminde içe:
          // hurda tarafı işlemin kendisinden gelir.
          var want = ctx.scrap === 'inside';
          arc = findArc(P0, P1, true, ctx.leadin, want, contour) || findArc(P0, P1, false, ctx.leadin, want, contour);
          if (arc) {
            prefix.push(arcLineFrom(lineOut[cuts[0].idx], P0, arc));
          } else {
            // Yay sığmıyorsa kısa düz lead-in (kontura dik, hurda tarafında)
            var ln = dist(P0, P1), dd = { x: (P1.x - P0.x) / ln, y: (P1.y - P0.y) / ln };
            [{ x: -dd.y, y: dd.x }, { x: dd.y, y: -dd.x }].some(function(nv) {
              for (var sc = 1; sc >= 0.4; sc -= 0.2) {
                var rr = ctx.leadin * sc;
                if (rr < 1) break;
                var Q = { x: P0.x + nv.x * rr, y: P0.y + nv.y * rr };
                var mid = { x: P0.x + nv.x * rr * 0.5, y: P0.y + nv.y * rr * 0.5 };
                if (insidePoly(Q, contour) === want && insidePoly(mid, contour) === want && distToPoly(Q, contour) > rr * 0.6) {
                  arc = { S: Q };
                  prefix.push(setXY(lineOut[cuts[0].idx], P0.x, P0.y).replace(/\s*;.*$/, '') + ' ; Plazma düz lead-in');
                  return true;
                }
              }
              return false;
            });
          }
        }
        if (arc) edits[rapidIdx] = [setXY(lines[rapidIdx], arc.S.x, arc.S.y)];
      }
    }

    // Kontur sonu bindirme
    if (cfg.overcut > 0) {
      var last = cuts[cuts.length - 1];
      var extra = [], remain = cfg.overcut, perim = 0;
      for (var i = 0; i < contour.length - 1; i++) perim += dist(contour[i], contour[i + 1]);
      remain = Math.min(remain, perim * 0.5);
      for (var j = 0; j < contour.length - 1 && remain > 0.001; j++) {
        var A = contour[j], B = contour[j + 1], sl = dist(A, B);
        if (sl < 1e-6) continue;
        var f = Math.min(1, remain / sl);
        extra.push(setXY(lineOut[last.idx].replace(/\s*;.*$/, ''), A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f) + (extra.length ? '' : ' ; Plazma bindirme'));
        remain -= sl * f;
      }
      lineOut[last.idx] = [lineOut[last.idx]].concat(extra);
    }

    cuts.forEach(function(c, ci) {
      var v = lineOut[c.idx];
      v = Array.isArray(v) ? v : [v];
      edits[c.idx] = ci === 0 ? prefix.concat(v) : v;
    });
  }

  // ctx: { scrap: 'inside' | 'outside' | null, leadin: mm } — lead-in'i olmayan konturlar için
  window.plazmaPostProcess = function(g, cfg, ctx) {
    cfg = cfg || settings();
    ctx = ctx || { scrap: null, leadin: 3 };
    if (!cfg.arc && !cfg.overcut && !cfg.holeDia) return g;
    var lines = g.split('\n');
    var edits = {};
    var blocks = [];
    var rapidIdx = -1, inCut = false, cuts = [], blockRapid = -1;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!inCut) {
        if (reRapid.test(ln) && num(ln, 'X') !== null && num(ln, 'Y') !== null) rapidIdx = i;
        if (/;\s*Tool On/i.test(ln)) { inCut = true; cuts = []; blockRapid = rapidIdx; }
      } else if (/;\s*Tool Off/i.test(ln)) {
        blocks.push({ rapidIdx: blockRapid, cuts: cuts });
        inCut = false;
        rapidIdx = -1;
      } else if (reLinear.test(ln) && num(ln, 'X') !== null && num(ln, 'Y') !== null) {
        cuts.push({ idx: i, x: num(ln, 'X'), y: num(ln, 'Y') });
      }
    }
    blocks.forEach(function(b) { processBlock(lines, b.rapidIdx, b.cuts, cfg, edits, ctx); });
    var out = [];
    for (var m = 0; m < lines.length; m++) {
      if (edits[m]) out.push.apply(out, edits[m]); else out.push(lines[m]);
    }
    return out.join('\n');
  };

  if (typeof window.generateGcode === 'function') {
    var origGenerate = window.generateGcode;
    window.generateGcode = function(index) {
      var g = origGenerate.apply(this, arguments);
      try {
        var ud = toolpathsInScene[index] && toolpathsInScene[index].userData;
        var op = ud && ud.camOperation;
        if (typeof g === 'string' && op && op.indexOf('Plasma') === 0) {
          var scrap = op.indexOf('outside') > -1 ? 'outside' : op.indexOf('inside') > -1 ? 'inside' : null;
          var leadin = Math.abs(parseFloat(ud.camPlasmaLeadinDist)) || 3;
          var cfg = settings(), lo = plazmaLeadOpts(ud);
          cfg.arc = lo.arc;
          cfg.overcut = lo.overcut;
          // Küçük delik sınırı girilmemişse malzemenin kalınlığından: çap < 2,5 × kalınlık
          var mat = window.PlazmaMaterial && PlazmaMaterial.get(ud.plazmaMaterial);
          if (!cfg.holeDia && mat && parseFloat(mat.thick) > 0) cfg.holeDia = Math.max(6, 2.5 * parseFloat(mat.thick));
          g = plazmaPostProcess(g, cfg, { scrap: scrap, leadin: leadin });
        }
      } catch (e) {
        console.error('Plazma son işleyici hatası, orijinal G-code kullanılıyor:', e);
      }
      return g;
    };
  }

  // ---------- Toolpath penceresi: "Plazma: Lead-in / Lead-out" (Lead-In Distance satırının altında) ----------
  // Yeni toolpath son kullanılan değerlerle, o da yoksa genel varsayılanla (yay, 1 mm) başlar.
  $(function() {
    if (typeof window.plazmaToolpathRow !== 'function') return;
    plazmaToolpathRow(function(i) {
      if (!toolpathsInScene[i] || $('#plazmaLeadRow' + i).length) return;
      var after = $('#tplasmaleadin' + i).closest('tr');
      if (!after.length) return;
      var ud = toolpathsInScene[i].userData || {}, src = ud;
      if (!ud.camOperation) { try { src = JSON.parse(localStorage.getItem('lastCamOperation')) || {}; } catch (e) { src = {}; } }
      var lo = plazmaLeadOpts(src);
      var row = $('<tr class="inputplasma" id="plazmaLeadRow' + i + '"><td>Plazma: Lead-in / Lead-out<br><span class="text-small">Giriş şekli · kontur sonu bindirme (0 = yok)</span></td><td>' +
        '<div class="input-addon" style="display:flex">' +
        '<span class="input-addon-label-left active-border"><i class="fas fa-share fa-fw" style="color:#ff6a00"></i></span>' +
        '<select class="cam-form-field active-border" id="tplazmaleadtype' + i + '" style="width:130px;border-left:solid 1px #ccc;padding:0 0 0 8px;">' +
        '<option value="arc"' + (lo.arc ? ' selected' : '') + '>Yay (teğet)</option><option value="straight"' + (lo.arc ? '' : ' selected') + '>Düz</option></select>' +
        '<input type="number" class="cam-form-field active-border" id="tplazmaovercut' + i + '" min="0" step="0.1" style="width:70px;margin-left:6px" value="' + lo.overcut + '">' +
        '<span class="input-addon-label-right active-border">mm</span>' +
        '</div></td></tr>');
      after.after(row);
      row.css('display', after.css('display') === 'none' ? 'none' : '');
      row.find('select, input').on('change', function() { updateCamUserData(i); });
    }, function(i, ud) {
      if (!$('#tplazmaleadtype' + i).length) return;
      ud.plazmaLeadinType = $('#tplazmaleadtype' + i).val();
      ud.plazmaOvercut = String(Math.max(0, parseFloat($('#tplazmaovercut' + i).val()) || 0));
    });
  });
})();
