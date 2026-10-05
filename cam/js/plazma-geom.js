// Plasma Kontrol — 2B geometri yardımcıları (çizim ve düzenleme araçları için)
// Noktalar {x, y}. Kapalı çoklu çizgilerde son nokta ilk noktaya eşittir (CAM'in kullandığı biçim).
(function() {
  'use strict';
  var TOL = 0.02; // yay/daire kiriş toleransı (mm)
  var TAU = Math.PI * 2;

  function P(x, y) { return { x: x, y: y }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ang(c, p) { return Math.atan2(p.y - c.y, p.x - c.x); }
  function norm(a) { a %= TAU; return a < 0 ? a + TAU : a; }

  function segCount(r, sweep) {
    if (r <= TOL) return 4;
    var step = 2 * Math.acos(Math.max(-1, 1 - TOL / r));
    return Math.min(720, Math.max(4, Math.ceil(Math.abs(sweep) / step)));
  }

  // Yay noktaları: merkez, yarıçap, başlangıç açısı, süpürme (+ saat yönü tersi)
  function arcPts(c, r, a0, sweep, n) {
    n = n || segCount(r, sweep);
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + sweep * i / n;
      out.push(P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
    }
    return out;
  }

  function circlePts(c, r, startDeg) {
    var pts = arcPts(c, r, (startDeg || 0) * Math.PI / 180, TAU);
    pts[pts.length - 1] = P(pts[0].x, pts[0].y);
    return pts;
  }

  // Üç noktadan yay: p1 -> p2, p3 yay üzerindeki ara nokta. Doğrusalsa null.
  function arc3(p1, p2, p3) {
    var ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return null;
    var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    var c = P((a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d);
    var r = dist(c, p1);
    var a1 = ang(c, p1), aEnd = ang(c, p2), aMid = ang(c, p3);
    var s = norm(aEnd - a1);
    var sweep = norm(aMid - a1) < s ? s : -(TAU - s);
    return { c: c, r: r, a0: a1, sweep: sweep };
  }

  // Dikdörtgen (x,y sol alt köşe), isteğe bağlı köşe yarıçapı ve döndürme (derece, sol alt köşe etrafında)
  function rectPts(x, y, w, h, r, rotDeg) {
    w = Math.abs(w); h = Math.abs(h);
    r = Math.max(0, Math.min(r || 0, w / 2 - 1e-6, h / 2 - 1e-6));
    var pts;
    if (r <= 0) {
      pts = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h), P(x, y)];
    } else {
      var q = Math.PI / 2;
      pts = []
        .concat(arcPts(P(x + w - r, y + r), r, -q, q))
        .concat(arcPts(P(x + w - r, y + h - r), r, 0, q))
        .concat(arcPts(P(x + r, y + h - r), r, q, q))
        .concat(arcPts(P(x + r, y + r), r, Math.PI, q));
      pts.push(P(pts[0].x, pts[0].y));
    }
    return rotDeg ? rotate(pts, P(x, y), rotDeg) : pts;
  }

  function polygonPts(c, r, n, rotDeg) {
    n = Math.max(3, Math.round(n));
    var a0 = (rotDeg || 0) * Math.PI / 180, pts = [];
    for (var i = 0; i < n; i++) {
      var a = a0 + TAU * i / n;
      pts.push(P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
    }
    pts.push(P(pts[0].x, pts[0].y));
    return pts;
  }

  // Kanal: iki merkez arası, genişlik w (uçlar yarım daire)
  function slotPts(c1, c2, w) {
    var r = Math.abs(w) / 2, L = dist(c1, c2);
    if (L < 1e-9) return circlePts(c1, r);
    var a = ang(c1, c2), h = Math.PI / 2;
    var pts = []
      .concat(arcPts(c2, r, a - h, Math.PI))
      .concat(arcPts(c1, r, a + h, Math.PI));
    pts.push(P(pts[0].x, pts[0].y));
    return pts;
  }

  function rotate(pts, c, deg) {
    var a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    return pts.map(function(p) {
      var dx = p.x - c.x, dy = p.y - c.y;
      return P(c.x + dx * co - dy * si, c.y + dx * si + dy * co);
    });
  }

  function isClosed(pts, tol) {
    return pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < (tol || 1e-6);
  }

  function polyLength(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }

  // Ardışık aynı noktaları temizle
  function dedupe(pts, tol) {
    tol = tol || 1e-6;
    var out = [];
    pts.forEach(function(p) { if (!out.length || dist(out[out.length - 1], p) > tol) out.push(P(p.x, p.y)); });
    return out;
  }

  // Köşe yuvarlatma: yön değişimi minDeg'den büyük köşelere r yarıçaplı yay
  function fillet(ptsIn, r, minDeg) {
    var closed = isClosed(ptsIn);
    var pts = dedupe(ptsIn);
    if (closed) pts.pop(); // tekrar eden son nokta
    var n = pts.length;
    if (n < 3 || r <= 0) return ptsIn.slice();
    minDeg = minDeg === undefined ? 20 : minDeg;
    var out = [];
    for (var i = 0; i < n; i++) {
      var p = pts[i];
      var hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
      if (!hasPrev || !hasNext) { out.push(p); continue; }
      var a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      var la = dist(a, p), lb = dist(p, b);
      var ux = (a.x - p.x) / la, uy = (a.y - p.y) / la; // köşeden öncekine
      var vx = (b.x - p.x) / lb, vy = (b.y - p.y) / lb; // köşeden sonrakine
      var cosT = Math.max(-1, Math.min(1, ux * vx + uy * vy));
      var theta = Math.acos(cosT); // iç açı
      var deflect = 180 - theta * 180 / Math.PI;
      if (deflect < minDeg || theta < 1e-3) { out.push(p); continue; }
      var t = r / Math.tan(theta / 2);
      if (t > la / 2 || t > lb / 2) { out.push(p); continue; } // kenar kısa: atla
      var t1 = P(p.x + ux * t, p.y + uy * t), t2 = P(p.x + vx * t, p.y + vy * t);
      var bx = ux + vx, by = uy + vy, bl = Math.hypot(bx, by);
      var dC = r / Math.sin(theta / 2);
      var c = P(p.x + bx / bl * dC, p.y + by / bl * dC);
      var a0 = ang(c, t1), a1 = ang(c, t2);
      var cross = ux * vy - uy * vx; // köşenin dönüş yönü
      var s = norm(a1 - a0);
      var sweep = cross < 0 ? s : s - TAU;
      if (Math.abs(sweep) > Math.PI) sweep = sweep > 0 ? sweep - TAU : sweep + TAU;
      out = out.concat(arcPts(c, r, a0, sweep));
    }
    if (closed) out.push(P(out[0].x, out[0].y));
    return out;
  }

  // Açık çizgileri uç noktalarından birleştir. Girdi: nokta dizileri. Çıktı: birleştirilmiş diziler.
  function join(polys, tol) {
    tol = tol || 0.1;
    var pool = polys.map(function(p) { return p.slice(); });
    var out = [];
    while (pool.length) {
      var cur = pool.shift();
      var grown = true;
      while (grown && !isClosed(cur, tol)) {
        grown = false;
        for (var i = 0; i < pool.length; i++) {
          var q = pool[i], s = cur[0], e = cur[cur.length - 1], qs = q[0], qe = q[q.length - 1];
          if (dist(e, qs) < tol) cur = cur.concat(q.slice(1));
          else if (dist(e, qe) < tol) cur = cur.concat(q.slice().reverse().slice(1));
          else if (dist(s, qe) < tol) cur = q.concat(cur.slice(1));
          else if (dist(s, qs) < tol) cur = q.slice().reverse().concat(cur.slice(1));
          else continue;
          pool.splice(i, 1);
          grown = true;
          break;
        }
      }
      if (cur.length > 2 && dist(cur[0], cur[cur.length - 1]) < tol) cur[cur.length - 1] = P(cur[0].x, cur[0].y);
      out.push(cur);
    }
    return out;
  }

  // Ofset (ClipperLib): kapalı konturlar için. d > 0 dışa, d < 0 içe.
  function offset(pts, d) {
    if (typeof ClipperLib === 'undefined' || !isClosed(pts)) return null;
    var S = 1000;
    var path = pts.slice(0, -1).map(function(p) { return { X: Math.round(p.x * S), Y: Math.round(p.y * S) }; });
    var co = new ClipperLib.ClipperOffset(2, TOL * S);
    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    var sol = new ClipperLib.Paths();
    co.Execute(sol, d * S);
    return sol.map(function(path) {
      var o = path.map(function(q) { return P(q.X / S, q.Y / S); });
      if (o.length) o.push(P(o[0].x, o[0].y));
      return o;
    });
  }

  function bbox(listOfPts) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    listOfPts.forEach(function(pts) {
      pts.forEach(function(p) {
        b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x);
        b.y0 = Math.min(b.y0, p.y); b.y1 = Math.max(b.y1, p.y);
      });
    });
    return b;
  }

  // Noktanın çoklu çizgiye en yakın izdüşümü: { i (segment başlangıcı), t, p, d }
  function closestOnPoly(pts, q) {
    var best = null;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      var t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
      var p = P(a.x + dx * t, a.y + dy * t), d = dist(p, q);
      if (!best || d < best.d) best = { i: i, t: t, p: p, d: d };
    }
    return best;
  }

  window.PlazmaGeom = {
    P: P, dist: dist, ang: ang, arcPts: arcPts, circlePts: circlePts, arc3: arc3, rectPts: rectPts,
    polygonPts: polygonPts, slotPts: slotPts, rotate: rotate, isClosed: isClosed, polyLength: polyLength,
    dedupe: dedupe, fillet: fillet, join: join, offset: offset, bbox: bbox, closestOnPoly: closestOnPoly
  };
})();
