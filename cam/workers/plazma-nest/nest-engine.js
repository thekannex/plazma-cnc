// Plasma Kontrol — Nesting (sac yerleşimi) motoru
// Izgara tabanlı gerçek şekil yerleşimi: parçalar boşluk payıyla genişletilip hücrelere dökülür,
// her parça için birçok açı denenir ve en sola (sonra en alta) yerleştirilir. Deliklerin içi boş
// kaldığından küçük parçalar büyük parçaların deliklerine yerleşebilir. Çoklu sac ve artık sac destekli.
// Hem Web Worker olarak hem Node'da (test) çalışır.
(function(root) {
  'use strict';
  var CL; // ClipperLib
  var S = 1000; // Clipper ölçeği (mm -> tamsayı)

  // ---------- geometri ----------
  function toPath(ring) { return ring.map(function(p) { return { X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }; }); }
  function fromPath(path) { return path.map(function(q) { return [q.X / S, q.Y / S]; }); }

  // Halkaları çift-tek kuralıyla birleştir (delikler doğru yönde), sonra d kadar ofsetle
  function offsetRings(rings, d) {
    var c = new CL.Clipper();
    c.AddPaths(rings.map(toPath), CL.PolyType.ptSubject, true);
    var uni = new CL.Paths();
    c.Execute(CL.ClipType.ctUnion, uni, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    if (Math.abs(d) < 1e-9) return uni.map(fromPath);
    var co = new CL.ClipperOffset(2, 0.05 * S);
    co.AddPaths(uni, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    var out = new CL.Paths();
    co.Execute(out, d * S);
    return out.map(fromPath);
  }

  function ringArea(r) {
    var a = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return a / 2;
  }
  function netArea(rings) { // çift-tek: dış - delikler (mutlak alanlarla, iç içe derinliğe göre)
    var total = 0;
    rings.forEach(function(r, i) {
      var depth = 0, p = r[0];
      rings.forEach(function(o, j) { if (i !== j && pointIn(p, o)) depth++; });
      total += (depth % 2 ? -1 : 1) * Math.abs(ringArea(r));
    });
    return total;
  }
  function pointIn(p, ring) {
    var x = p[0], y = p[1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var a = ring[i], b = ring[j];
      if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    }
    return inside;
  }
  function rotRings(rings, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return rings.map(function(r) { return r.map(function(p) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; }); });
  }
  function bbox(rings) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    rings.forEach(function(r) { r.forEach(function(p) {
      if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
    }); });
    return b;
  }

  // Dışbükey zarf + en küçük alanlı dikdörtgen açısı (döner kumpas)
  function hull(pts) {
    pts = pts.slice().sort(function(a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    pts.forEach(function(p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (var i = pts.length - 1; i >= 0; i--) { var p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function minRectAngle(ring) {
    var h = hull(ring);
    if (h.length < 3) return 0;
    var best = Infinity, bestA = 0;
    for (var i = 0; i < h.length; i++) {
      var a = h[i], b = h[(i + 1) % h.length];
      var ang = -Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      var bb = bbox(rotRings([h], ang));
      var area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      if (area < best) { best = area; bestA = ang; }
    }
    return bestA;
  }

  // Şeklin DOKUNDUĞU tüm hücreler (muhafazakâr, gereksiz pay yok): satır bandının alt/üst
  // kenarındaki iç aralıklar + banttan geçen her kenarın x aralığı
  function rasterTouch(rings, ox, oy, W, H, cell, edgesOnly) {
    var g = new Uint8Array(W * H);
    var edges = [];
    rings.forEach(function(r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) edges.push([r[j][0], r[j][1], r[i][0], r[i][1]]);
    });
    function mark(row, xa, xb) {
      var c0 = Math.max(0, Math.floor((xa - ox) / cell)), c1 = Math.min(W - 1, Math.floor((xb - ox) / cell));
      for (var c = c0; c <= c1; c++) g[row * W + c] = 1;
    }
    var xs = [];
    function spansAt(y, row) {
      xs.length = 0;
      for (var k = 0; k < edges.length; k++) {
        var e = edges[k];
        if ((e[1] > y) !== (e[3] > y)) xs.push(e[0] + (y - e[1]) * (e[2] - e[0]) / (e[3] - e[1]));
      }
      xs.sort(function(a, b) { return a - b; });
      for (var m = 0; m + 1 < xs.length; m += 2) mark(row, xs[m], xs[m + 1]);
    }
    for (var row = 0; row < H; row++) {
      var y0 = oy + row * cell, y1 = y0 + cell;
      if (!edgesOnly) { spansAt(y0 + 1e-7, row); spansAt(y1 - 1e-7, row); }
      for (var k = 0; k < edges.length; k++) {
        var e = edges[k];
        var ya = Math.min(e[1], e[3]), yb = Math.max(e[1], e[3]);
        if (yb < y0 || ya > y1) continue;
        var xa, xb;
        if (Math.abs(e[3] - e[1]) < 1e-12) { xa = Math.min(e[0], e[2]); xb = Math.max(e[0], e[2]); }
        else {
          var ta = (Math.max(ya, y0) - e[1]) / (e[3] - e[1]), tb = (Math.min(yb, y1) - e[1]) / (e[3] - e[1]);
          var p = e[0] + ta * (e[2] - e[0]), q = e[0] + tb * (e[2] - e[0]);
          xa = Math.min(p, q); xb = Math.max(p, q);
        }
        mark(row, xa, xb);
      }
    }
    return g;
  }

  // Hücre merkezlerini çift-tek kuralıyla tara: hücre (c, r) merkezi = (ox + (c+.5)*cell, oy + (r+.5)*cell)
  function rasterize(rings, ox, oy, W, H, cell) {
    var g = new Uint8Array(W * H);
    var edges = [];
    rings.forEach(function(r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) edges.push([r[j][0], r[j][1], r[i][0], r[i][1]]);
    });
    var xs = [];
    for (var row = 0; row < H; row++) {
      var y = oy + (row + 0.5) * cell;
      xs.length = 0;
      for (var k = 0; k < edges.length; k++) {
        var e = edges[k];
        if ((e[1] > y) !== (e[3] > y)) xs.push(e[0] + (y - e[1]) * (e[2] - e[0]) / (e[3] - e[1]));
      }
      xs.sort(function(a, b) { return a - b; });
      for (var m = 0; m + 1 < xs.length; m += 2) {
        var c0 = Math.max(0, Math.ceil((xs[m] - ox) / cell - 0.5));
        var c1 = Math.min(W - 1, Math.floor((xs[m + 1] - ox) / cell - 0.5));
        for (var c = c0; c <= c1; c++) g[row * W + c] = 1;
      }
    }
    return g;
  }

  // ---------- parça hazırlığı ----------
  // Bir açı için ayak izi: satır başına dolu aralıklar [c0, uzunluk]
  function footprint(part, deg, opts) {
    var cell = opts.cell;
    var rings = rotRings(part.rings, deg);
    var src = opts.fillHoles ? rings : [outerOf(rings)];
    var dil = offsetRings(src, opts.gap / 2);
    if (!dil.length) return null;
    var bb = bbox(dil);
    var ox = Math.floor(bb[0] / cell) * cell, oy = Math.floor(bb[1] / cell) * cell;
    var W = Math.ceil((bb[2] - ox) / cell), H = Math.ceil((bb[3] - oy) / cell);
    var g = rasterTouch(dil, ox, oy, W, H, cell);
    var rows = [], count = 0;
    for (var r = 0; r < H; r++) {
      var runs = [];
      for (var c = 0; c < W; c++) {
        if (g[r * W + c]) {
          var s = c;
          while (c < W && g[r * W + c]) c++;
          runs.push(s, c - s);
          count += c - s;
        }
      }
      rows.push(runs);
    }
    return { deg: deg, ox: ox, oy: oy, w: W, h: H, rows: rows, cells: count };
  }
  function outerOf(rings) {
    var best = rings[0], ba = 0;
    rings.forEach(function(r) { var a = Math.abs(ringArea(r)); if (a > ba) { ba = a; best = r; } });
    return best;
  }

  // ---------- sac ----------
  function Sheet(def, opts) {
    var cell = opts.cell;
    var shrink = Math.max(0, opts.margin - opts.gap / 2);
    var usable = offsetRings(def.rings, -shrink);
    var bb = bbox(def.rings);
    this.def = def;
    this.ox = bb[0]; this.oy = bb[1];
    this.W = Math.max(1, Math.ceil((bb[2] - bb[0]) / cell));
    this.H = Math.max(1, Math.ceil((bb[3] - bb[1]) / cell));
    this.words = (this.W + 31) >>> 5;
    var free = usable.length ? rasterize(usable, this.ox, this.oy, this.W, this.H, cell) : new Uint8Array(this.W * this.H);
    var edge = usable.length ? rasterTouch(usable, this.ox, this.oy, this.W, this.H, cell, true) : null;
    if (edge) for (var e2 = 0; e2 < free.length; e2++) if (edge[e2]) free[e2] = 0;
    this.occ = new Uint8Array(this.W * this.H);
    for (var i = 0; i < free.length; i++) this.occ[i] = free[i] ? 0 : 1;
    this.iv = new Array(this.H); // satır başına boş aralıklar [s0, e0, s1, e1, ...] (dahil)
    for (var r = 0; r < this.H; r++) this.updateRow(r);
    this.placed = [];
    this.usedX = 0;
  }
  Sheet.prototype.updateRow = function(r) {
    var W = this.W, base = r * W, out = [];
    for (var c = 0; c < W; c++) {
      if (!this.occ[base + c]) {
        var st = c;
        while (c < W && !this.occ[base + c]) c++;
        out.push(st, c - 1);
      }
    }
    this.iv[r] = out;
  };
  // a..b (dahil) bitlerini 1 yap
  function setRange(arr, a, b) {
    var wa = a >>> 5, wb = b >>> 5;
    if (wa === wb) { arr[wa] |= ((0xFFFFFFFF >>> (31 - (b - a))) << (a & 31)) >>> 0; return; }
    arr[wa] |= (0xFFFFFFFF << (a & 31)) >>> 0;
    for (var k = wa + 1; k < wb; k++) arr[k] = 0xFFFFFFFF;
    arr[wb] |= 0xFFFFFFFF >>> (31 - (b & 31));
  }
  // En sol (sonra en alt) uygun konum; maxX: bundan büyük X'e bakma
  Sheet.prototype.find = function(fp, maxX) {
    var W = this.W, H = this.H;
    if (fp.w > W || fp.h > H) return null;
    var lim = Math.min(W - fp.w, maxX === undefined ? W : maxX);
    if (lim < 0) return null;
    var nw = (lim >>> 5) + 1;
    var acc = new Uint32Array(nw), tmp = new Uint32Array(nw);
    var best = null;
    for (var Y = 0; Y + fp.h <= H; Y++) {
      for (var k = 0; k < nw; k++) acc[k] = 0xFFFFFFFF;
      var lastBits = lim & 31; // lim'den büyük bitleri temizle
      acc[nw - 1] = lastBits === 31 ? 0xFFFFFFFF : ((1 << (lastBits + 1)) - 1) >>> 0;
      var alive = true;
      for (var i = 0; i < fp.h && alive; i++) {
        var runs = fp.rows[i];
        for (var q = 0; q < runs.length; q += 2) {
          var c0 = runs[q], L = runs[q + 1];
          // Bu satırın boş aralıklarına göre uygun X kümesi: [s - c0, e - L + 1 - c0]
          var ivs = this.iv[Y + i], any = 0;
          for (var k1 = 0; k1 < nw; k1++) tmp[k1] = 0;
          for (var t = 0; t < ivs.length; t += 2) {
            var xa = ivs[t] - c0, xb = ivs[t + 1] - L + 1 - c0;
            if (xa > lim) break;
            if (xb < 0 || xb < xa) continue;
            setRange(tmp, xa < 0 ? 0 : xa, xb > lim ? lim : xb);
          }
          for (var k2 = 0; k2 < nw; k2++) { acc[k2] &= tmp[k2]; any |= acc[k2]; }
          if (!any) { alive = false; break; }
        }
      }
      if (!alive) continue;
      for (var k3 = 0; k3 < nw; k3++) {
        if (acc[k3]) {
          var x = (k3 << 5) + (31 - Math.clz32(acc[k3] & -acc[k3]));
          if (!best || x < best.x) { best = { x: x, y: Y }; nw = (x >>> 5) + 1; lim = x; }
          break;
        }
      }
      if (best && best.x === 0) break;
    }
    return best;
  };
  Sheet.prototype.place = function(fp, x, y) {
    for (var i = 0; i < fp.h; i++) {
      var runs = fp.rows[i], r = y + i, base = r * this.W;
      for (var q = 0; q < runs.length; q += 2) for (var c = runs[q]; c < runs[q] + runs[q + 1]; c++) this.occ[base + x + c] = 1;
      this.updateRow(r);
    }
    this.usedX = Math.max(this.usedX, x + fp.w);
  };

  // ---------- ana döngü ----------
  function angleList(part, opts) {
    var list = [];
    if (opts.rotStep > 0 && opts.rotStep < 360) for (var a = 0; a < 360 - 1e-6; a += opts.rotStep) list.push(a);
    else list.push(0);
    if (opts.rotStep !== 0 && opts.rotStep < 360) {
      var m = minRectAngle(outerOf(part.rings));
      [0, 90, 180, 270].forEach(function(k) { list.push(((m + k) % 360 + 360) % 360); });
    }
    var uniq = [];
    list.forEach(function(a) { if (!uniq.some(function(b) { return Math.abs(b - a) < 0.01; })) uniq.push(a); });
    return uniq;
  }

  function prepare(parts, opts) {
    return parts.map(function(p) {
      var fps = angleList(p, opts).map(function(a) { return footprint(p, a, opts); }).filter(Boolean);
      return { part: p, fps: fps, area: Math.abs(netArea(p.rings)), cells: fps.length ? fps[0].cells : 0 };
    });
  }

  function runOnce(prep, sheetDefs, opts, order) {
    var sheets = [], unplaced = [];
    var remnantsLeft = sheetDefs.filter(function(s) { return s.remnant && s.use !== false; }).map(function(s) { return { def: s, left: s.qty || 1 }; });
    var std = sheetDefs.filter(function(s) { return !s.remnant && s.use !== false; })[0];
    var stdLeft = std ? (std.qty > 0 ? std.qty : Infinity) : 0;
    order.forEach(function(item) {
      var pp = prep[item.pi];
      var done = false;
      // açık saclar (artıklar önce açılır)
      for (var si = 0; si < sheets.length && !done; si++) done = tryPlace(sheets[si], pp, item);
      while (!done) {
        var def = null;
        for (var ri = 0; ri < remnantsLeft.length; ri++) if (remnantsLeft[ri].left > 0) { def = remnantsLeft[ri].def; remnantsLeft[ri].left--; break; }
        if (!def && stdLeft > 0) { def = std; stdLeft--; }
        if (!def) break;
        var sh = new Sheet(def, opts);
        sheets.push(sh);
        done = tryPlace(sh, pp, item);
        if (!done && !def.remnant) { sheets.pop(); break; } // boş standart saca bile sığmıyor
      }
      if (!done) unplaced.push({ partId: pp.part.id, inst: item.inst });
    });
    return { sheets: sheets, unplaced: unplaced };
  }

  function tryPlace(sh, pp, item) {
    var best = null;
    // Ölçüt: parçanın SAĞ kenarı en solda (sıkışık şerit, düzgün artık), eşitlikte en alttaki
    for (var k = 0; k < pp.fps.length; k++) {
      var fp = pp.fps[(k + item.rot) % pp.fps.length];
      var maxX = best ? best.x + best.fp.w - fp.w : undefined;
      if (maxX !== undefined && maxX < 0) continue;
      var pos = sh.find(fp, maxX);
      if (!pos) continue;
      var right = pos.x + fp.w, bestRight = best ? best.x + best.fp.w : Infinity;
      if (right < bestRight || (right === bestRight && pos.y < best.y)) best = { x: pos.x, y: pos.y, fp: fp };
    }
    if (!best) return false;
    sh.place(best.fp, best.x, best.y);
    sh.placed.push({ partId: pp.part.id, inst: item.inst, deg: best.fp.deg, x: best.x, y: best.y, fp: best.fp });
    return true;
  }

  function score(res, cell) { // az sac, sonra son sacta az kullanılan uzunluk, sonra az yerleşmeyen
    var last = res.sheets[res.sheets.length - 1];
    return res.unplaced.length * 1e9 + res.sheets.length * 1e6 + (last ? last.usedX * cell : 0);
  }

  function result(res, prep, opts) {
    var byId = {};
    prep.forEach(function(p) { byId[p.part.id] = p; });
    return {
      sheets: res.sheets.map(function(sh) {
        var area = 0;
        var pl = sh.placed.map(function(p) {
          area += byId[p.partId].area;
          // dönmüş parça koordinatı -> sac koordinatı: q = R(deg)·p + (dx, dy)
          return { partId: p.partId, inst: p.inst, deg: p.deg, dx: sh.ox + p.x * opts.cell - p.fp.ox, dy: sh.oy + p.y * opts.cell - p.fp.oy };
        });
        var sheetArea = Math.abs(netArea(sh.def.rings));
        return { sheetId: sh.def.id, name: sh.def.name, remnant: !!sh.def.remnant, placements: pl, util: sheetArea ? area / sheetArea : 0, usedLength: sh.usedX * opts.cell };
      }),
      unplaced: res.unplaced
    };
  }

  // opts: gap, margin, cell, rotStep (0 = döndürme yok), fillHoles, timeLimit (ms), seed
  function nest(input, progress) {
    var opts = input.opts, t0 = Date.now();
    var prep = prepare(input.parts, opts);
    var items = [];
    prep.forEach(function(p, pi) { for (var k = 0; k < (input.parts[pi].qty || 1); k++) items.push({ pi: pi, inst: k, rot: 0 }); });
    var base = items.slice().sort(function(a, b) { return prep[b.pi].cells - prep[a.pi].cells; });
    var best = null, bestScore = Infinity, iter = 0;
    var rnd = mulberry(opts.seed || 12345);
    do {
      var order = iter === 0 ? base : perturb(base, rnd, prep);
      var res = runOnce(prep, input.sheets, opts, order);
      var sc = score(res, opts.cell);
      iter++;
      if (sc < bestScore) {
        bestScore = sc; best = res;
        // İyileşen sonucu hemen gönder: kullanıcı "Durdur" derse bu kullanılır
        if (input.onBest) { var bo = result(best, prep, opts); bo.iterations = iter; bo.elapsed = Date.now() - t0; input.onBest(bo); }
      }
      if (progress) progress({ iter: iter, sheets: best.sheets.length, unplaced: best.unplaced.length, lastLen: best.sheets.length ? best.sheets[best.sheets.length - 1].usedX * opts.cell : 0, elapsed: Date.now() - t0 });
    } while (Date.now() - t0 < (opts.timeLimit || 0) && items.length > 1 && !(input.stop && input.stop()));
    var out = result(best, prep, opts);
    out.iterations = iter;
    out.elapsed = Date.now() - t0;
    return out;
  }

  // Büyükten küçüğe sırayı koruyarak hafif karıştır, başlangıç açılarını değiştir
  function perturb(base, rnd, prep) {
    var arr = base.map(function(it) { return { pi: it.pi, inst: it.inst, rot: Math.floor(rnd() * 8), key: prep[it.pi].cells * (0.75 + rnd() * 0.5) }; });
    arr.sort(function(a, b) { return b.key - a.key; });
    for (var i = 0; i < arr.length * 0.1; i++) {
      var a = Math.floor(rnd() * arr.length), b = Math.min(arr.length - 1, a + 1 + Math.floor(rnd() * 3));
      var t = arr[a]; arr[a] = arr[b]; arr[b] = t;
    }
    return arr;
  }
  function mulberry(a) { return function() { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  var api = { nest: nest, offsetRings: offsetRings, netArea: netArea, pointIn: pointIn, rotRings: rotRings, bbox: bbox, minRectAngle: minRectAngle };

  if (typeof module !== 'undefined' && module.exports) {
    CL = require('../../lib/clipperjs/clipper_unminified.js');
    module.exports = api;
  } else if (typeof importScripts === 'function' && typeof window === 'undefined') {
    importScripts('/lib/clipperjs/clipper_unminified.js');
    CL = self.ClipperLib;
    var stopFlag = false;
    self.onmessage = function(e) {
      if (e.data.cmd === 'stop') { stopFlag = true; return; }
      if (e.data.cmd === 'nest') {
        stopFlag = false;
        var input = e.data.input;
        input.stop = function() { return stopFlag; };
        input.onBest = function(r) { self.postMessage({ type: 'best', result: r }); };
        try {
          var out = nest(input, function(p) { self.postMessage({ type: 'progress', p: p }); });
          self.postMessage({ type: 'done', result: out });
        } catch (err) {
          self.postMessage({ type: 'error', message: err.message + '\n' + err.stack });
        }
      }
    };
  } else {
    CL = root.ClipperLib;
    root.PlazmaNestEngine = api;
  }
})(this);
