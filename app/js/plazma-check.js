// Plasma Kontrol — İş öncesi kontrol (ek özellik)
// "Çalıştır"a basınca G-code makineye gitmeden önce denetlenir: torç açık kalıyor mu, torç açıkken hızlı
// hareket var mı, hız tanımlı mı, kesim sacın / iş sıfırının dışına taşıyor mu, makine sınırları aşılıyor mu,
// IHS eksik mi. Ayrıca kesim uzunluğu, delme sayısı ve tahmini süre gösterilir.
// Hata/uyarı varsa pencere açılır; yoksa kısa özet gösterilip iş başlar.
// plazmaAnalyze() "Kaldığı yerden devam" tarafından da kullanılır.
(function() {
  'use strict';
  var NO_ALIGN = /PLAZMA:\s*HIZALAMA YOK/i;

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fmt(v, d) { return (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('tr-TR'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // ---------- G-code çözümleyici ----------
  // Her satır için başlangıç/bitiş konumu, hareket tipi ve torç durumu; ayrıca torç açma olayları.
  // Torç: M3/M4 + S>0 = açık; M5 veya S0 = kapalı (FluidNC'de M3 aktifken S değeri torcu yakar/söndürür).
  window.plazmaAnalyze = function(src) {
    var lines = src.split(/\r?\n/);
    var x = 0, y = 0, z = 0, rel = false, mode = 0, f = null, dir = false, s = 0, inch = false, wcs = null;
    var ihsSinceOff = false, lastF0 = null;
    var r = {
      lines: lines, info: [], ons: [], cutLen: 0, rapidLen: 0, cutTime: 0, rapidTime: 0, dwell: 0, probes: 0,
      maxF: 0, all: null, cut: null, issues: { rapidOn: [], noFeed: [], endOn: false, ihsMissing: 0, ihsHave: 0, special: [] },
      materials: [], sheet: null
    };
    function grow(k, px, py) {
      var b = r[k] || (r[k] = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      if (px < b.x0) b.x0 = px; if (px > b.x1) b.x1 = px; if (py < b.y0) b.y0 = py; if (py > b.y1) b.y1 = py;
    }
    lines.forEach(function(line, idx) {
      var ci = line.search(/[;(]/), code = (ci >= 0 ? line.slice(0, ci) : line).toUpperCase(), cmt = ci >= 0 ? line.slice(ci) : '';
      var mm = /^;\s*Malzeme:\s*(.*)$/i.exec(line.trim());
      if (mm && r.materials.indexOf(mm[1]) < 0) r.materials.push(mm[1]);
      var sh = /PLAZMA-SAC:\s*X(-?[\d.]+)\s*Y(-?[\d.]+)\s*X(-?[\d.]+)\s*Y(-?[\d.]+)/i.exec(line);
      if (sh) r.sheet = { x0: +sh[1], y0: +sh[2], x1: +sh[3], y1: +sh[4] };
      var words = code.replace(/\s+/g, '').match(/[A-Z][-+]?(\d+\.?\d*|\.\d+)/g) || [];
      var w = {}, gs = [], ms = [];
      words.forEach(function(t) {
        var l = t[0], v = parseFloat(t.slice(1));
        if (l === 'G') gs.push(v); else if (l === 'M') ms.push(v); else w[l] = v;
      });
      var wasOn = dir && s > 0;
      var info = { x0: x, y0: y, z0: z, mode: null, on: wasOn, f: f };
      var nonModal = false;
      gs.forEach(function(v) {
        if (v === 90) rel = false; else if (v === 91) rel = true;
        else if (v === 20) inch = true; else if (v === 21) inch = false;
        else if (v >= 54 && v <= 59) wcs = 'G' + v;
        else if (v === 0 || v === 1 || v === 2 || v === 3) mode = v;
        else if (v >= 38 && v < 39) { r.probes++; ihsSinceOff = true; nonModal = true; }
        else if (v === 4) { if ('P' in w) r.dwell += w.P; nonModal = true; }
        else if (v === 10 || v === 28 || v === 30 || v === 53 || v === 92) nonModal = true;
      });
      if (gs.some(function(v) { return v === 28 || v === 30; })) r.issues.special.push(idx);
      if ('F' in w) { f = inch ? w.F * 25.4 : w.F; if (f > r.maxF) r.maxF = f; }
      if ('S' in w) s = w.S;
      ms.forEach(function(v) {
        if (v === 3 || v === 4) dir = true;
        else if (v === 5) dir = false;
        else if (v === 6) r.issues.special.push(idx);
      });
      var on = dir && s > 0;
      if (on && !wasOn) {
        var joint = /mikro/i.test(cmt);
        r.ons.push({ idx: idx, joint: joint });
        if (!joint) { if (ihsSinceOff) r.issues.ihsHave++; else r.issues.ihsMissing++; }
      }
      if (!on && wasOn) ihsSinceOff = false;
      var k = inch ? 25.4 : 1;
      var hasXY = 'X' in w || 'Y' in w, hasZ = 'Z' in w;
      if (!nonModal && (hasXY || hasZ)) {
        var nx = 'X' in w ? (rel ? x + w.X * k : w.X * k) : x;
        var ny = 'Y' in w ? (rel ? y + w.Y * k : w.Y * k) : y;
        var nz = hasZ ? (rel ? z + w.Z * k : w.Z * k) : z;
        info.mode = mode;
        var len = Math.hypot(nx - x, ny - y);
        if ((mode === 2 || mode === 3) && ('I' in w || 'J' in w)) {
          var cx = x + (w.I || 0) * k, cy = y + (w.J || 0) * k, rad = Math.hypot(x - cx, y - cy);
          var a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx), TAU = 2 * Math.PI;
          var sw = mode === 3 ? ((a1 - a0) % TAU + TAU) % TAU : ((a0 - a1) % TAU + TAU) % TAU;
          if (sw < 1e-9) sw = TAU;
          len = rad * sw;
          info.arc = { cx: cx, cy: cy, r: rad, a0: a0, sweep: mode === 3 ? sw : -sw };
          for (var q = 0; q <= 8; q++) { var a = a0 + info.arc.sweep * q / 8; grow('all', cx + rad * Math.cos(a), cy + rad * Math.sin(a)); if (on) grow('cut', cx + rad * Math.cos(a), cy + rad * Math.sin(a)); }
        }
        if (hasXY) {
          grow('all', x, y); grow('all', nx, ny);
          if (mode === 0) {
            r.rapidLen += len;
            if (on && len > 0.001) r.issues.rapidOn.push(idx);
          } else {
            if (on) { grow('cut', x, y); grow('cut', nx, ny); r.cutLen += len; }
            if (!f) r.issues.noFeed.push(idx);
            else r.cutTime += len / f;
          }
        }
        if (mode !== 0 && hasZ && !hasXY && !f) r.issues.noFeed.push(idx);
        info.len = len;
        x = nx; y = ny; z = nz;
      }
      info.x1 = x; info.y1 = y; info.z1 = z; info.on = on; info.f = f; info.rel = rel; info.inch = inch; info.wcs = wcs; info.modeAfter = mode;
      r.info.push(info);
    });
    r.issues.endOn = dir && s > 0;
    return r;
  };

  // ---------- Kontroller ----------
  function machineSpace() {
    var gp = (typeof grblParams !== 'undefined' && grblParams) ? grblParams : {};
    var tx = parseFloat(gp.$130) || 0, ty = parseFloat(gp.$131) || 0;
    if (typeof laststatus === 'undefined' || !laststatus.machine || !laststatus.comms || laststatus.comms.connectionStatus < 1) return null;
    var p = laststatus.machine.position, o = p.offset || {};
    var mx = parseFloat(p.work.x) + parseFloat(o.x || 0), my = parseFloat(p.work.y) + parseFloat(o.y || 0);
    return { tx: tx, ty: ty, ox: parseFloat(o.x || 0), oy: parseFloat(o.y || 0), mx: mx, my: my };
  }

  window.plazmaPreflight = function(src) {
    var align = (typeof plazmaAlignAngle === 'function' && !NO_ALIGN.test(src)) ? plazmaAlignAngle() : 0;
    var a = plazmaAnalyze(src);
    var out = { err: [], warn: [], info: [], a: a, align: align };
    function ln(list) { return list.slice(0, 3).map(function(i) { return i + 1; }).join(', ') + (list.length > 3 ? '…' : ''); }

    if (!a.all) out.err.push('G-code\'da XY hareketi yok.');
    if (a.issues.endOn) out.err.push('Program bittiğinde <b>torç açık kalıyor</b> (sonda M5 / M3 S0 yok).');
    if (a.issues.rapidOn.length) out.err.push('Torç açıkken <b>hızlı hareket (G0)</b>: ' + a.issues.rapidOn.length + ' yerde (satır ' + ln(a.issues.rapidOn) + ').');
    if (a.issues.noFeed.length) out.err.push('Hız (F) tanımlanmadan kesim hareketi: satır ' + ln(a.issues.noFeed) + '.');
    if (!a.ons.length) out.warn.push('Torç hiç açılmıyor (M3 S… yok): makine sadece gezer, kesmez.');
    if (a.issues.ihsMissing && a.issues.ihsHave) out.warn.push(a.issues.ihsMissing + ' delmede IHS (yükseklik algılama) yok, ' + a.issues.ihsHave + ' delmede var.');
    else if (a.ons.length && !a.issues.ihsHave) out.info.push('IHS (G38.2) kullanılmıyor: Z sıfırının sac üstünde olduğundan emin olun.');
    if (a.issues.special.length) out.warn.push('Plazmada beklenmeyen komut (G28/G30/M6): satır ' + ln(a.issues.special) + '.');

    var gp = (typeof grblParams !== 'undefined' && grblParams) ? grblParams : {};
    var fmax = parseFloat(gp.$110) || 0;
    if (fmax && a.maxF > fmax * 1.001) out.warn.push('İstenen hız ' + fmt(a.maxF) + ' mm/dk, makinenin X azami hızı ($110) ' + fmt(fmax) + ' mm/dk: kesim daha yavaş olur, kesim kalitesi değişebilir.');

    var c = a.cut;
    if (c) {
      if (c.x0 < -0.5 || c.y0 < -0.5) out.warn.push('Kesim iş sıfırının ' + (c.x0 < -0.5 ? 'solunda (X ' + fmt(c.x0, 1) + ')' : '') + (c.x0 < -0.5 && c.y0 < -0.5 ? ' ve ' : '') + (c.y0 < -0.5 ? 'altında (Y ' + fmt(c.y0, 1) + ')' : '') + '. Sacın sol alt köşesi sıfırsa bu kısım sacın dışında kalır.');
      if (a.sheet) {
        var sh = a.sheet, t = 0.5;
        if (c.x0 < sh.x0 - t || c.y0 < sh.y0 - t || c.x1 > sh.x1 + t || c.y1 > sh.y1 + t) out.warn.push('Kesim sacın dışına taşıyor: kesim X ' + fmt(c.x0, 1) + '…' + fmt(c.x1, 1) + ' Y ' + fmt(c.y0, 1) + '…' + fmt(c.y1, 1) + ', sac X ' + fmt(sh.x0) + '…' + fmt(sh.x1) + ' Y ' + fmt(sh.y0) + '…' + fmt(sh.y1) + '.');
        else out.info.push('Kesim sac sınırları içinde (' + fmt(sh.x1 - sh.x0) + ' × ' + fmt(sh.y1 - sh.y0) + ' mm).');
      }
    }

    // Makine sınırları (hizalama dönüşü dahil, tüm hareketler)
    var m = machineSpace();
    if (a.all && m && (m.tx || m.ty)) {
      var co = Math.cos(align * Math.PI / 180), si = Math.sin(align * Math.PI / 180), b = a.all;
      var pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(function(p) { return [p[0] * co - p[1] * si + m.ox, p[0] * si + p[1] * co + m.oy]; });
      var mx0 = Math.min.apply(null, pts.map(function(p) { return p[0]; })), mx1 = Math.max.apply(null, pts.map(function(p) { return p[0]; }));
      var my0 = Math.min.apply(null, pts.map(function(p) { return p[1]; })), my1 = Math.max.apply(null, pts.map(function(p) { return p[1]; }));
      var probs = [];
      [['X', m.tx, mx0, mx1, m.mx], ['Y', m.ty, my0, my1, m.my]].forEach(function(ax) {
        var T = ax[1]; if (!T) return;
        if (ax[3] - ax[2] > T + 0.5) { probs.push(ax[0] + ' boyu ' + fmt(ax[3] - ax[2]) + ' mm, makine hareketi ' + fmt(T) + ' mm'); return; }
        // makine alanının işareti şu anki konumdan tahmin edilir (Grbl: 0…-T, bazı FluidNC ayarları: 0…+T)
        var lo = ax[4] < -0.5 ? -T : ax[4] > 0.5 ? 0 : null;
        if (lo === null) return;
        if (ax[2] < lo - 0.5 || ax[3] > lo + T + 0.5) probs.push(ax[0] + ' makine koordinatı ' + fmt(ax[2], 1) + '…' + fmt(ax[3], 1) + ', izin verilen ' + fmt(lo) + '…' + fmt(lo + T));
      });
      if (probs.length) out.warn.push('Makine sınırları aşılabilir: ' + probs.join('; ') + '. İş sıfırını ve Çerçeve Gez\'i kontrol edin.');
    }

    if (align) out.info.push('Sac hizalama aktif: G-code ' + (align >= 0 ? '+' : '') + align.toFixed(2) + '° döndürülerek gönderilecek.');
    a.materials.forEach(function(mt) { out.info.push('Makinede ayarlayın — <b>' + esc(mt) + '</b>'); });

    // Özet ve tahmini süre
    var rapidF = fmax || 5000, joints = a.ons.filter(function(o) { return o.joint; }).length;
    var secs = a.cutTime * 60 + a.rapidLen / rapidF * 60 + a.dwell + a.probes * 3;
    out.summary = { pierces: a.ons.length - joints, joints: joints, cutLen: a.cutLen, rapidLen: a.rapidLen, secs: secs };
    return out;
  };

  function dur(s) {
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return h ? h + ' sa ' + m + ' dk' : m ? m + ' dk ' + ss + ' sn' : ss + ' sn';
  }
  window.plazmaJobSummary = function(sm) {
    return fmt(sm.pierces) + ' delme' + (sm.joints ? ' (+' + sm.joints + ' köprü)' : '') + ' · kesim ' + fmt(sm.cutLen / 1000, 2) + ' m · boşta ' + fmt(sm.rapidLen / 1000, 2) + ' m · tahmini süre ~' + dur(sm.secs);
  };

  // ---------- Pencere ----------
  $('head').append('<style>' +
    '#pcOv{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3500;display:flex;align-items:center;justify-content:center;}' +
    '#pcBox{background:#fff;color:#222;width:560px;max-width:94vw;max-height:88vh;overflow:auto;border-radius:6px;border-top:4px solid #ff6a00;box-shadow:0 6px 30px rgba(0,0,0,.4);font-size:13px;}' +
    '#pcBox .pc-h{padding:10px 14px;font-size:15px;font-weight:700;border-bottom:1px solid #ddd;}' +
    '#pcBox .pc-b{padding:10px 14px;}' +
    '#pcBox ul{list-style:none;margin:0;padding:0;}' +
    '#pcBox li{padding:5px 0 5px 26px;position:relative;border-bottom:1px solid #f0f0f0;line-height:1.35;}' +
    '#pcBox li i{position:absolute;left:4px;top:7px;}' +
    '#pcBox .pc-sum{background:#f6f6f6;border-radius:4px;padding:6px 8px;margin-top:8px;color:#444;}' +
    '#pcBox .pc-f{display:flex;align-items:center;gap:6px;padding:10px 14px;border-top:1px solid #ddd;}' +
    '#pcBox button{border:1px solid #999;background:#fff;border-radius:3px;padding:5px 12px;cursor:pointer;font-size:13px;}' +
    '#pcBox button.pri{background:#ff6a00;color:#fff;border-color:#e05500;font-weight:700;}' +
    '#pcBox button[disabled]{opacity:.45;cursor:not-allowed;}' +
    '</style>');

  function showDialog(res, go) {
    $('#pcOv').remove();
    var items = res.err.map(function(t) { return '<li><i class="fas fa-times-circle" style="color:#c62828"></i>' + t + '</li>'; })
      .concat(res.warn.map(function(t) { return '<li><i class="fas fa-exclamation-triangle" style="color:#ef6c00"></i>' + t + '</li>'; }))
      .concat(res.info.map(function(t) { return '<li><i class="fas fa-info-circle" style="color:#1565c0"></i>' + t + '</li>'; }));
    if (!res.err.length && !res.warn.length) items.unshift('<li><i class="fas fa-check-circle" style="color:#2e7d32"></i>Sorun bulunmadı.</li>');
    var ov = $('<div id="pcOv"><div id="pcBox"><div class="pc-h"><i class="fas fa-clipboard-check" style="color:#ff6a00"></i> İş Öncesi Kontrol</div>' +
      '<div class="pc-b"><ul>' + items.join('') + '</ul><div class="pc-sum">' + plazmaJobSummary(res.summary) + '</div></div>' +
      '<div class="pc-f">' +
      (res.err.length ? '<label style="flex:1"><input type="checkbox" id="pcRisk"> Hataları gördüm, yine de çalıştır</label>' : '<label style="flex:1;color:#666"><input type="checkbox" id="pcQuiet"' + (ls('plazmaCheckQuiet', '0') === '1' ? ' checked' : '') + '> Uyarı yoksa bu pencereyi gösterme</label>') +
      '<button data-a="no">İptal</button><button class="pri" data-a="go"' + (res.err.length ? ' disabled' : '') + '>' + (res.err.length || res.warn.length ? 'Yine de çalıştır' : 'Çalıştır') + '</button></div></div></div>');
    $('body').append(ov);
    ov.find('#pcRisk').on('change', function() { ov.find('[data-a=go]').prop('disabled', !this.checked); });
    ov.find('#pcQuiet').on('change', function() { lsSet('plazmaCheckQuiet', this.checked ? '1' : '0'); });
    ov.on('click', '[data-a]', function() {
      if ($(this).prop('disabled')) return;
      var a = $(this).data('a');
      ov.remove();
      if (a === 'go') go();
    });
    ov.find('[data-a=' + (res.err.length ? 'no' : 'go') + ']').focus();
  }

  if (typeof window.runJobFile === 'function') {
    var origRun = window.runJobFile;
    window.runJobFile = function() {
      var self = this, args = arguments;
      var fromGlobal = typeof gcode === 'string' && !!gcode;
      var src = fromGlobal ? gcode : (typeof editor !== 'undefined' ? editor.getValue() : '');
      var go = function() {
        var keep = gcode;
        if (fromGlobal) gcode = src; // pencere açıkken gcode değişkeni geri alınmış olabilir
        try { return origRun.apply(self, args); } finally { if (fromGlobal) gcode = keep; }
      };
      var res;
      try { res = plazmaPreflight(src); } catch (e) { console.error('Plazma iş öncesi kontrol hatası', e); return go(); }
      var quiet = ls('plazmaCheckQuiet', '0') === '1';
      if (!res.err.length && !res.warn.length && (quiet || !res.a.materials.length)) {
        Metro.toast.create('<b>İş öncesi kontrol: sorun yok.</b><br>' + plazmaJobSummary(res.summary) + (res.a.materials.length ? '<br>' + res.a.materials.map(esc).join('<br>') : ''), null, 7000, 'bg-green fg-white');
        return go();
      }
      showDialog(res, go);
    };
  }
})();
