// Plazma CONTROL — Plazma G-code son işleyicisi (ek özellik)
// Orijinal generateGcode() aynen çalışır; çıktısı sadece Plasma işlemlerinde ve ayar açıksa değiştirilir:
//  - Yay lead-in: düz giriş çizgisi yerine kontura teğet çeyrek daire (G2/G3).
//    CAM'in lead-in koyamadığı kapalı konturlara da hurda tarafında yay lead-in eklenir.
//  - Lead-out: kontur sonu bindirme (başlangıç noktası X mm geçilir) veya hurda tarafına teğet yay çıkış
//  - Küçük delikler: belirlenen boyuttan küçük kapalı konturlar düşük hızda kesilir
// Lead-in / lead-out, kesim yönü ve küçük delik toolpath başınadır (toolpath penceresi); makine ayarı varsayılandır.
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

  // Toolpath başına kesim ayarları. Toolpath'te yoksa (yeni / eski işler) varsayılan:
  // lead-in tipi ve bindirme için genel değer, kesim yönü ve küçük delik için makine ayarı (Settings).
  // Lead-in: 'arc' | 'straight' | 'off' + uzunluk. Lead-out: 'off' | 'over' (kontur boyunca bindirme) |
  // 'arc' (hurda tarafına teğet yay) + uzunluk. Eski işlerde lead-out bilgisi yoksa bindirme değerinden gelir.
  window.plazmaTpOpts = function(ud) {
    ud = ud || {};
    var has = function(k) { return ud[k] !== undefined && ud[k] !== null && ud[k] !== ''; };
    var m = settings();
    var lit = ud.plazmaLeadinType || localStorage.getItem('plazmaLeadinType') || 'straight';
    var lil = has('plazmaLeadinLen') ? Math.max(0, parseFloat(ud.plazmaLeadinLen) || 0) : (Math.abs(parseFloat(ud.camPlasmaLeadinDist)) || 3);
    var lot, lol;
    if (has('plazmaLeadoutType')) { lot = ud.plazmaLeadoutType; lol = Math.max(0, parseFloat(ud.plazmaLeadoutLen) || 0); }
    else { lol = Math.max(0, parseFloat(has('plazmaOvercut') ? ud.plazmaOvercut : localStorage.getItem('plazmaOvercut')) || 0); lot = lol > 0 ? 'over' : 'off'; }
    if (lit !== 'off' && !(lil > 0)) lit = 'off';
    if (lot !== 'off' && !(lol > 0)) lot = 'off';
    return {
      leadinType: lit, leadinLen: lil, leadoutType: lot, leadoutLen: lol,
      arc: lit === 'arc', overcut: lot === 'over' ? lol : 0, leadoutArc: lot === 'arc' ? lol : 0,
      cutDir: ud.plazmaCutDir || ($('#plazmaCutDir').val() || localStorage.getItem('plazmaCutDir') || 'std'),
      holeDia: has('plazmaHoleDia') ? Math.max(0, parseFloat(ud.plazmaHoleDia) || 0) : m.holeDia,
      holeFeed: has('plazmaHoleFeed') ? Math.min(100, Math.max(10, parseFloat(ud.plazmaHoleFeed) || 60)) : m.holeFeed,
      holeMode: ud.plazmaHoleMode === 'speed' ? 'speed' : 'full'
    };
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

    // Küçük delik modu: içten kesilen (delik) ve sınırdan küçük konturda merkezden düz giriş, lead-out yok,
    // tam turda torç kapanır ve hareket biraz devam eder (giriş izini temizler). Yay giriş / çıkış atlanır.
    var hole = slow && cfg.holeMode !== 'speed' && ctx.scrap === 'inside';
    if (hole) {
      var P0h = contour[0], Ch = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      if (insidePoly(Ch, contour) && dist(Ch, P0h) > 0.5) {
        edits[rapidIdx] = [setXY(lines[rapidIdx], Ch.x, Ch.y)]; // delme deliğin merkezinde
        // CAM'in lead-in'i varsa ilk kesim satırı zaten P0'a gider; yoksa merkezden P0'a düz giriş eklenir
        if (!hasLead) prefix.push(setXY(lineOut[cuts[0].idx], P0h.x, P0h.y).replace(/\s*;.*$/, '') + ' ; Plazma kucuk delik: merkezden duz giris');
      }
    }

    // Yay lead-in
    if (cfg.arc && !hole) {
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
    if (cfg.overcut > 0 && !hole) {
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

    // Yay lead-out: kontur kapanınca son kenar yönünde teğet çıkıp hurda tarafına kıvrılır.
    // Lead-in yayının tersidir: E'de biten yay bulunur, ters yönde (G2↔G3) kesilir.
    if (cfg.leadoutArc > 0 && ctx.scrap !== null && !hole) {
      var lc = cuts[cuts.length - 1], E = contour[contour.length - 1], Pb = null;
      for (var q = contour.length - 2; q >= 0; q--) { if (dist(contour[q], E) > 0.001) { Pb = contour[q]; break; } }
      if (Pb) {
        var wo = ctx.scrap === 'inside';
        var ao = findArc(E, Pb, true, cfg.leadoutArc, wo, contour) || findArc(E, Pb, false, cfg.leadoutArc, wo, contour);
        if (ao) {
          var cur = Array.isArray(lineOut[lc.idx]) ? lineOut[lc.idx] : [lineOut[lc.idx]];
          var tpl = cur[0].replace(/\s*;.*$/, '');
          var lo = setXY(tpl, ao.S.x, ao.S.y).replace(reLinear, ao.left ? 'G2' : 'G3');
          lo = lo.replace(/(Y\s*-?[\d.]+)/i, '$1 I' + (ao.C.x - E.x).toFixed(4) + ' J' + (ao.C.y - E.y).toFixed(4)) + ' ; Plazma yay lead-out';
          lineOut[lc.idx] = cur.concat([lo]);
        }
      }
    }

    // Küçük delik bitişi: kontur kapanınca torç kapanır, torç kapalıyken kontur boyunca biraz daha gidilir.
    // Yeni hareket satırlarında S yoktur (M3 aktifken S değeri torcu yeniden yakardı).
    if (hole && ctx.offLine) {
      var lh = cuts[cuts.length - 1], perH = 0;
      for (var ih = 0; ih < contour.length - 1; ih++) perH += dist(contour[ih], contour[ih + 1]);
      var restH = Math.min(cfg.holeExt > 0 ? cfg.holeExt : 4, perH * 0.25), tailH = [ctx.offLine.replace(/\s*;.*$/, '') + ' ; Plazma kucuk delik: torc kapali, hareket devam'];
      for (var jh = 0; jh < contour.length - 1 && restH > 0.001; jh++) {
        var Ah = contour[jh], Bh = contour[jh + 1], slh = dist(Ah, Bh);
        if (slh < 1e-6) continue;
        var fh = Math.min(1, restH / slh);
        tailH.push('G1 X' + (Ah.x + (Bh.x - Ah.x) * fh).toFixed(4) + ' Y' + (Ah.y + (Bh.y - Ah.y) * fh).toFixed(4));
        restH -= slh * fh;
      }
      lineOut[lh.idx] = (Array.isArray(lineOut[lh.idx]) ? lineOut[lh.idx] : [lineOut[lh.idx]]).concat(tailH);
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
    if (!cfg.arc && !cfg.overcut && !cfg.leadoutArc && !cfg.holeDia) return g;
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
        blocks.push({ rapidIdx: blockRapid, cuts: cuts, off: ln });
        inCut = false;
        rapidIdx = -1;
      } else if (reLinear.test(ln) && num(ln, 'X') !== null && num(ln, 'Y') !== null) {
        cuts.push({ idx: i, x: num(ln, 'X'), y: num(ln, 'Y') });
      }
    }
    blocks.forEach(function(b) {
      processBlock(lines, b.rapidIdx, b.cuts, cfg, edits, { scrap: ctx.scrap, leadin: ctx.leadin, offLine: b.off });
    });
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
          var o = plazmaTpOpts(ud), leadin = o.leadinLen || 3;
          var cfg = { arc: o.arc, overcut: o.overcut, leadoutArc: o.leadoutArc, holeDia: o.holeDia, holeFeed: o.holeFeed, holeMode: o.holeMode };
          // Küçük delik sınırı girilmemişse malzemenin kalınlığından: çap < 2,5 × kalınlık
          var mat = window.PlazmaMaterial && PlazmaMaterial.get(ud.plazmaMaterial);
          if (!cfg.holeDia && mat && parseFloat(mat.thick) > 0) cfg.holeDia = Math.max(6, 2.5 * parseFloat(mat.thick));
          g = plazmaPostProcess(g, cfg, { scrap: scrap, leadin: leadin });
          // G0'daki F (CAM'in sabit 1000'i) anlamsız: FluidNC/Grbl G0'ı her zaman azami hızla ($110) yapar.
          // Kaldırılır ki G-code ve simülasyon yanıltmasın (kesim satırlarının kendi F değeri var).
          g = g.replace(/^(\s*G0*0)(?![\d.])\s*F\s*[\d.]+/gim, '$1');
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
      var ud = toolpathsInScene[i].userData || {}, last = {};
      try { last = JSON.parse(localStorage.getItem('lastCamOperation')) || {}; } catch (e) {}
      // yeni toolpath: lead-in / lead-out son kullanılandan, kesim yönü / küçük delik makine ayarından
      var lo = plazmaTpOpts(ud.camOperation ? ud : {
        plazmaLeadinType: last.plazmaLeadinType, plazmaLeadinLen: last.plazmaLeadinLen, camPlasmaLeadinDist: last.camPlasmaLeadinDist,
        plazmaLeadoutType: last.plazmaLeadoutType, plazmaLeadoutLen: last.plazmaLeadoutLen, plazmaOvercut: last.plazmaOvercut
      });
      var opt = function(v, t, sel) { return '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + t + '</option>'; };
      var leadRow = function(id, label, help, icon, sid, opts, sel, nid, val) {
        return '<tr class="inputplasma" id="' + id + i + '"><td>' + label + '<br><span class="text-small">' + help + '</span></td><td>' +
          '<div class="input-addon" style="display:flex">' +
          '<span class="input-addon-label-left active-border"><i class="fas ' + icon + ' fa-fw" style="color:#ff6a00"></i></span>' +
          '<select class="cam-form-field active-border" id="' + sid + i + '" style="width:160px;border-left:solid 1px #ccc;padding:0 0 0 8px;">' +
          opts.map(function(o) { return opt(o[0], o[1], sel); }).join('') + '</select>' +
          '<input type="number" class="cam-form-field active-border" id="' + nid + i + '" min="0" step="0.5" style="width:70px;margin-left:6px" value="' + val + '">' +
          '<span class="input-addon-label-right active-border">mm</span></div></td></tr>';
      };
      // Uzunluklar kapalıyken de saklanır: tekrar açınca eski değer gelir
      var inLen = ud.plazmaLeadinLen || (Math.abs(parseFloat(ud.camPlasmaLeadinDist)) || lo.leadinLen || 3);
      var outLen = ud.plazmaLeadoutLen || last.plazmaLeadoutLen || lo.leadoutLen || 1;
      var row = $(leadRow('plazmaLeadRow', 'Plazma: Lead-in', 'Giriş: delmeden kontura geçiş', 'fa-sign-in-alt', 'tplazmaleadtype',
          [['arc', 'Yay (teğet)'], ['straight', 'Düz'], ['off', 'Kapalı (konturda del)']], lo.leadinType, 'tplazmaleadlen', inLen) +
        leadRow('plazmaLeadOutRow', 'Plazma: Lead-out', 'Çıkış: kontur bitince', 'fa-sign-out-alt', 'tplazmaouttype',
          [['over', 'Bindirme (kontur boyunca)'], ['arc', 'Yay (hurdaya çıkış)'], ['off', 'Kapalı']], lo.leadoutType, 'tplazmaoutlen', outLen));
      // OpenBuilds'in "Lead-In Distance" satırı gizlenir; değeri Lead-in satırından yazılır (toolpath hesabı onu kullanır)
      var vis = after.css('display') !== 'none';
      after.removeClass('inputplasma').hide();
      var rows = row.add($('<tr class="inputplasma" id="plazmaHoleRow' + i + '"><td>Plazma: Küçük delik<br><span class="text-small">Bu çaptan küçük delikler: yavaş; tam modda merkezden düz giriş, çıkışsız, tur sonu torç kapalı. 0 = malzemeden (2,5 × kalınlık)</span></td><td>' +
        '<div class="input-addon" style="display:flex">' +
        '<span class="input-addon-label-left active-border"><i class="far fa-dot-circle fa-fw" style="color:#ff6a00"></i></span>' +
        '<input type="number" class="cam-form-field active-border" id="tplazmaholedia' + i + '" min="0" step="1" style="width:70px" value="' + lo.holeDia + '">' +
        '<span class="input-addon-label-right active-border">mm</span>' +
        '<input type="number" class="cam-form-field active-border" id="tplazmaholefeed' + i + '" min="10" max="100" step="5" style="width:70px;margin-left:6px" value="' + lo.holeFeed + '">' +
        '<span class="input-addon-label-right active-border">% hız</span>' +
        '<select class="cam-form-field active-border" id="tplazmaholemode' + i + '" style="width:110px;margin-left:6px;border-left:solid 1px #ccc;padding:0 0 0 6px;" title="Tam: delikte merkezden düz giriş, lead-out yok, tur sonunda torç kapanıp hareket devam eder">' +
        opt('full', 'Tam mod', lo.holeMode) + opt('speed', 'Sadece hız', lo.holeMode) + '</select>' +
        '</div></td></tr>')).add($('<tr class="inputplasma" id="plazmaDirRow' + i + '"><td>Plazma: Kesim yönü<br><span class="text-small">İyi kenar hareket yönünün sağında kalır</span></td><td>' +
        '<div class="input-addon"><span class="input-addon-label-left active-border"><i class="fas fa-redo fa-fw" style="color:#ff6a00"></i></span>' +
        '<select class="cam-form-field cam-form-field-right active-border" id="tplazmacutdir' + i + '" style="width:280px;border-left:solid 1px #ccc;padding:0 0 0 10px;">' +
        opt('std', 'Standart (dış saat yönü, delik tersi)', lo.cutDir) + opt('rev', 'Ters (ters girdaplı sarf)', lo.cutDir) + opt('off', 'Değiştirme (orijinal)', lo.cutDir) +
        '</select></div></td></tr>'));
      after.after(rows);
      rows.css('display', vis ? '' : 'none');
      rows.find('select, input').on('change', function() { updateCamUserData(i); });
    }, function(i, ud) {
      if (!$('#tplazmaleadtype' + i).length) return;
      var lit = $('#tplazmaleadtype' + i).val(), lil = Math.max(0, parseFloat($('#tplazmaleadlen' + i).val()) || 0);
      var lot = $('#tplazmaouttype' + i).val(), lol = Math.max(0, parseFloat($('#tplazmaoutlen' + i).val()) || 0);
      ud.plazmaLeadinType = lit; ud.plazmaLeadinLen = String(lil);
      ud.plazmaLeadoutType = lot; ud.plazmaLeadoutLen = String(lol);
      ud.plazmaOvercut = String(lot === 'over' ? lol : 0); // eski alanla uyum
      // orijinal updateCamUserData bu alanı camPlasmaLeadinDist'e yazar (CAM'in kendi giriş noktası)
      $('#tplasmaleadin' + i).val(lit === 'off' ? 0 : lil);
      ud.plazmaHoleDia = String(Math.max(0, parseFloat($('#tplazmaholedia' + i).val()) || 0));
      ud.plazmaHoleFeed = String(Math.min(100, Math.max(10, parseFloat($('#tplazmaholefeed' + i).val()) || 60)));
      ud.plazmaCutDir = $('#tplazmacutdir' + i).val();
      ud.plazmaHoleMode = $('#tplazmaholemode' + i).val();
    });
  });
})();
