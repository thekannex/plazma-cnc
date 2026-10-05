// Plasma Kontrol — Sac hizalama (iki nokta) ve artık sac tanıtma (ek özellik)
// Hizalama: torç sacın sol alt köşesine ve alt kenarı üzerindeki uzak bir noktaya götürülür; aradaki açı
// kadar iş G-code'u iş sıfırı (köşe) etrafında döndürülerek gönderilir. Kuru çalıştırma ve çerçeve gezme de.
// Artık tanıtma: torç artığın köşelerinde gezdirilir, şekil CAM nesting'e artık sac olarak gönderilir.
(function() {
  'use strict';
  var NO_ALIGN = /PLAZMA:\s*HIZALAMA YOK/i;

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m, c) { Metro.toast.create(m, null, 4500, c || 'bg-green fg-white'); }
  function f4(v) { return (Math.round(v * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '') || '0'; }

  window.plazmaAlignAngle = function() { return ls('plazmaAlignOn', '0') === '1' ? (parseFloat(ls('plazmaAlignAngle', '0')) || 0) : 0; };

  // ---------- G-code döndürme ----------
  // Mutlak (G90) ve göreli (G91) XY hareketleri, yaylarda I/J vektörleri iş sıfırı etrafında döndürülür.
  // G53 (makine koordinatı), G28/G30, G92, G10 satırlarına dokunulmaz.
  window.plazmaRotateGcode = function(src, deg) {
    if (!deg || NO_ALIGN.test(src)) return src;
    var a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    var rel = false, cx = 0, cy = 0, out = ['; Plazma sac hizalama: ' + deg.toFixed(3) + ' derece donduruldu'];
    src.split(/\r?\n/).forEach(function(line) {
      var ci = line.search(/[;(]/), code = ci >= 0 ? line.slice(0, ci) : line, cmt = ci >= 0 ? line.slice(ci) : '';
      var words = code.match(/[A-Za-z]\s*[-+]?(\d+\.?\d*|\.\d+)/g);
      if (!words) { out.push(line); return; }
      var parsed = words.map(function(w) { return { l: w[0].toUpperCase(), v: parseFloat(w.slice(1).replace(/\s/g, '')) }; });
      var g = parsed.filter(function(p) { return p.l === 'G'; }).map(function(p) { return p.v; });
      if (g.indexOf(90) >= 0) rel = false;
      if (g.indexOf(91) >= 0) rel = true;
      if (g.some(function(v) { return v === 53 || v === 28 || v === 30 || v === 92 || v === 10; }) || /^\s*\$/.test(code)) { out.push(line); return; }
      var X = parsed.filter(function(p) { return p.l === 'X'; })[0], Y = parsed.filter(function(p) { return p.l === 'Y'; })[0];
      var I = parsed.filter(function(p) { return p.l === 'I'; })[0], J = parsed.filter(function(p) { return p.l === 'J'; })[0];
      if (!X && !Y && !I && !J) { out.push(line); return; }
      var res = parsed.filter(function(p) { return 'XYIJ'.indexOf(p.l) < 0; }).map(function(p) { return p.l + f4(p.v); });
      if (X || Y) {
        var x, y;
        if (rel) { x = X ? X.v : 0; y = Y ? Y.v : 0; }
        else { x = X ? X.v : cx; y = Y ? Y.v : cy; cx = x; cy = y; }
        res.push('X' + f4(x * co - y * si), 'Y' + f4(x * si + y * co));
      }
      if (I || J) {
        var i = I ? I.v : 0, j = J ? J.v : 0;
        res.push('I' + f4(i * co - j * si), 'J' + f4(i * si + j * co));
      }
      out.push(res.join(' ') + (cmt ? ' ' + cmt : ''));
    });
    return out.join('\n');
  };

  function rotateIfNeeded(src) {
    var d = plazmaAlignAngle();
    return d ? plazmaRotateGcode(src, d) : src;
  }

  // Ana "Çalıştır": orijinal fonksiyon global gcode (büyük dosya) ya da editörü gönderir
  if (typeof window.runJobFile === 'function') {
    var origRun = window.runJobFile;
    window.runJobFile = function() {
      var d = plazmaAlignAngle();
      var src = (typeof gcode === 'string' && gcode) ? gcode : editor.getValue();
      var zero = /PLAZMA-SIFIR:\s*X\s*(-?[\d.]+)\s*Y\s*(-?[\d.]+)/i.exec(src);
      var go = function() {
        if (!d || NO_ALIGN.test(src)) return origRun.apply(this, arguments);
        var keep = gcode;
        gcode = plazmaRotateGcode(src, d); // orijinal fonksiyon gcode değişkeni doluysa onu gönderir
        try { return origRun.apply(this, arguments); } finally { gcode = keep; }
      };
      if (zero) {
        Metro.dialog.create({
          title: 'Tanıtılmış artık sac',
          content: '<div>Bu iş torçla tanıtılmış bir artık sac için hazırlandı. İş sıfırı artığın ilk köşesine (makine X' + zero[1] + ' Y' + zero[2] + ') ayarlansın mı?<br><small>Artık o zamandan beri yerinden oynatılmadıysa Evet deyin.</small></div>',
          actions: [
            { caption: 'Evet, ayarla ve başlat', cls: 'js-dialog-close success', onclick: function() { sendGcode('G10 L2 P1 X' + zero[1] + ' Y' + zero[2]); setTimeout(go, 400); } },
            { caption: 'Hayır, mevcut sıfırla başlat', cls: 'js-dialog-close', onclick: function() { go(); } },
            { caption: 'İptal', cls: 'js-dialog-close alert' }
          ]
        });
        return;
      }
      return go();
    };
  }

  // Soket ile gönderilen işler: ana iş (isJob) ve Plazma kuru çalıştırma / çerçeve (plazmaAlign).
  // Prob sihirbazları gibi eksen hizalı komutlar döndürülmez.
  function wrapSocket() {
    if (typeof socket === 'undefined' || !socket || socket.__plazmaAlign) return;
    var orig = socket.emit;
    socket.emit = function(ev, data) {
      if (ev === 'runJob' && data && typeof data.data === 'string' && (data.isJob || data.plazmaAlign)) {
        data = $.extend({}, data, { data: rotateIfNeeded(data.data) });
        delete data.plazmaAlign;
      }
      return orig.apply(this, [ev, data].concat([].slice.call(arguments, 2)));
    };
    socket.__plazmaAlign = true;
  }
  setInterval(wrapSocket, 1000);

  // ---------- konum ----------
  function machinePos() {
    if (typeof laststatus === 'undefined' || !laststatus.machine || !laststatus.comms || laststatus.comms.connectionStatus < 1) return null;
    var w = laststatus.machine.position.work, o = laststatus.machine.position.offset;
    return { x: parseFloat(w.x) + parseFloat(o.x || 0), y: parseFloat(w.y) + parseFloat(o.y || 0) };
  }
  function needPos() {
    var p = machinePos();
    if (!p) toast('Makineye bağlı değil', 'bg-red fg-white');
    return p;
  }

  // ---------- yüzen panel (jog paneli kullanılabilir kalsın diye modal değil) ----------
  function panel(id, title, html) {
    $('#' + id).remove();
    var p = $('<div id="' + id + '" class="plazma-float"><div class="pf-head"><b>' + title + '</b><span class="pf-x" title="Kapat">✕</span></div><div class="pf-body">' + html + '</div></div>');
    $('body').append(p);
    p.find('.pf-x').on('click', function() { p.remove(); });
    return p;
  }
  $('head').append('<style>' +
    '.plazma-float{position:fixed;right:16px;top:110px;width:340px;z-index:3000;background:#fff;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.35);border-top:4px solid #ff6a00;font-size:12px;color:#222;}' +
    '.plazma-float .pf-head{display:flex;align-items:center;padding:6px 10px;background:#f4f4f4;border-bottom:1px solid #ddd;}' +
    '.plazma-float .pf-head b{flex:1;font-size:13px;}' +
    '.plazma-float .pf-x{cursor:pointer;padding:0 4px;}' +
    '.plazma-float .pf-body{padding:8px 10px;}' +
    '.plazma-float .step{border:1px solid #ddd;border-radius:4px;padding:6px;margin-bottom:6px;}' +
    '.plazma-float .step.done{border-color:#43a047;background:#f1f8f1;}' +
    '.plazma-float .pf-btn{border:1px solid #999;background:#fff;border-radius:3px;padding:3px 8px;cursor:pointer;margin:3px 3px 0 0;font-size:12px;}' +
    '.plazma-float .pf-btn.pri{background:#ff6a00;color:#fff;border-color:#e05500;font-weight:700;}' +
    '.plazma-float input[type=text]{width:100%;height:24px;border:1px solid #bbb;border-radius:3px;padding:0 4px;}' +
    '.plazma-float .pos{font-family:monospace;color:#555;}' +
    '</style>');

  // ---------- Sac hizalama sihirbazı ----------
  var A = { p1: null, p2: null };
  window.plazmaAlignWizard = function() {
    A = { p1: null, p2: null };
    var cur = plazmaAlignAngle();
    var p = panel('plazmaAlignPanel', '<i class="fas fa-ruler-combined" style="color:#ff6a00"></i> Sac Hizalama',
      '<div class="pf-hint" style="margin-bottom:6px">Şu an: <b>' + (cur ? cur.toFixed(3) + '° döndürme aktif' : 'hizalama kapalı') + '</b>. Bu panel açıkken jog ile torcu hareket ettirebilirsiniz.</div>' +
      '<div class="step" id="paS1"><b>1.</b> Torcu sacın <b>sol alt köşesine</b> getirin (torç ucu tam köşenin üstünde).<br>' +
      '<label><input type="checkbox" id="paZero" checked> İş sıfırını (X0 Y0) buraya ayarla</label><br>' +
      '<button class="pf-btn pri" data-a="p1">Köşe burası</button> <span class="pos" id="paP1"></span></div>' +
      '<div class="step" id="paS2"><b>2.</b> Torcu sacın <b>alt kenarı</b> boyunca köşeden mümkün olduğunca uzağa (en az 500 mm) götürüp torç ucunu tam kenarın üstüne getirin.<br>' +
      '<button class="pf-btn pri" data-a="p2">Kenar noktası burası</button> <span class="pos" id="paP2"></span></div>' +
      '<div id="paRes" style="margin:6px 0;font-size:13px"></div>' +
      '<button class="pf-btn pri" data-a="apply" disabled>Hizalamayı uygula</button> <button class="pf-btn" data-a="off">Hizalamayı kapat</button>' +
      '<div class="pf-hint" style="margin-top:6px;color:#666">Hizalama, Çalıştır, Kuru Çalıştır ve Çerçeve Gez\'e uygulanır. Önce <b>Çerçeve Gez</b> ile kontrol edin. 3B görünüm döndürülmemiş halini gösterir.</div>');
    p.on('click', '[data-a]', function() {
      var a = $(this).data('a');
      if (a === 'p1') {
        var q = needPos(); if (!q) return;
        A.p1 = q;
        if ($('#paZero').is(':checked')) sendGcode('G10 L20 P1 X0 Y0');
        $('#paP1').text('X' + q.x.toFixed(2) + ' Y' + q.y.toFixed(2)); $('#paS1').addClass('done');
      } else if (a === 'p2') {
        var q2 = needPos(); if (!q2) return;
        if (!A.p1) { toast('Önce köşeyi kaydedin', 'bg-red fg-white'); return; }
        A.p2 = q2;
        $('#paP2').text('X' + q2.x.toFixed(2) + ' Y' + q2.y.toFixed(2)); $('#paS2').addClass('done');
      } else if (a === 'apply') {
        lsSet('plazmaAlignAngle', A.angle); lsSet('plazmaAlignOn', '1'); badge();
        toast('Sac hizalama uygulandı: ' + A.angle.toFixed(3) + '°. Çerçeve Gez ile kontrol edin.');
        p.remove();
      } else if (a === 'off') {
        lsSet('plazmaAlignOn', '0'); badge(); toast('Sac hizalama kapatıldı'); p.remove();
      }
      if (A.p1 && A.p2) {
        var dx = A.p2.x - A.p1.x, dy = A.p2.y - A.p1.y, L = Math.hypot(dx, dy);
        A.angle = Math.atan2(dy, dx) * 180 / Math.PI;
        var warn = L < 300 ? '<br><span style="color:#c62828">⚠ Noktalar çok yakın (' + L.toFixed(0) + ' mm): açı hassas olmaz, daha uzağa gidin.</span>' : '';
        var big = Math.abs(A.angle) > 10 ? '<br><span style="color:#c62828">⚠ Açı büyük. Kenar noktasını alt kenarda mı aldınız?</span>' : '';
        $('#paRes').html('Eğiklik: <b>' + (A.angle >= 0 ? '+' : '') + A.angle.toFixed(3) + '°</b> (ölçüm boyu ' + L.toFixed(0) + ' mm, 3000 mm\'de ' + (Math.tan(A.angle * Math.PI / 180) * 3000).toFixed(1) + ' mm kayma)' + warn + big);
        p.find('[data-a=apply]').prop('disabled', false);
      }
    });
  };

  // ---------- Artık sac tanıtma ----------
  var R = { pts: [] };
  window.plazmaRemnantWizard = function() {
    R = { pts: [] };
    var p = panel('plazmaRemPanel', '<i class="fas fa-draw-polygon" style="color:#ff6a00"></i> Artık Sac Tanıt',
      '<div class="pf-hint" style="margin-bottom:6px">Torcu artığın köşelerine sırayla (kenar boyunca, saat yönünün tersine) götürüp her köşede <b>Nokta ekle</b>\'ye basın. <b>İlk nokta artığın iş sıfırı olur</b> (tercihen sol alt köşe).</div>' +
      '<div>Ad: <input type="text" id="prName" value="Artık ' + new Date().toLocaleDateString('tr-TR') + '"></div>' +
      '<div style="margin-top:6px"><button class="pf-btn pri" data-a="add">+ Nokta ekle</button><button class="pf-btn" data-a="undo">Son noktayı sil</button></div>' +
      '<div id="prList" class="pos" style="margin:6px 0;max-height:160px;overflow:auto"></div>' +
      '<label><input type="checkbox" id="prZero" checked> Bitirince iş sıfırını ilk noktaya ayarla</label><br>' +
      '<button class="pf-btn pri" data-a="done">Bitir → CAM\'e artık olarak gönder</button>' +
      '<div class="pf-hint" style="margin-top:6px;color:#666">Tanıtılan artıkta sac hizalama uygulanmaz (şekil zaten gerçek konumunu taşır). Nesting\'te artık saclar listesinde görünür.</div>');
    function list() {
      $('#prList').html(R.pts.map(function(q, i) { return (i + 1) + '. X' + q.x.toFixed(1) + ' Y' + q.y.toFixed(1) + (i ? '  (' + Math.hypot(q.x - R.pts[i - 1].x, q.y - R.pts[i - 1].y).toFixed(0) + ' mm)' : '  ← iş sıfırı'); }).join('<br>'));
    }
    p.on('click', '[data-a]', function() {
      var a = $(this).data('a');
      if (a === 'add') {
        var q = needPos(); if (!q) return;
        var last = R.pts[R.pts.length - 1];
        if (last && Math.hypot(q.x - last.x, q.y - last.y) < 5) { toast('Torç bir önceki noktayla aynı yerde', 'bg-orange fg-white'); return; }
        R.pts.push(q); list();
      } else if (a === 'undo') { R.pts.pop(); list(); }
      else if (a === 'done') {
        if (R.pts.length < 3) { toast('En az 3 nokta gerekli', 'bg-red fg-white'); return; }
        var o = R.pts[0];
        var rel = R.pts.map(function(q) { return [Math.round((q.x - o.x) * 100) / 100, Math.round((q.y - o.y) * 100) / 100]; });
        var body = { id: 'r' + Date.now(), name: $('#prName').val() || 'Artık', points: rel, origin: { x: Math.round(o.x * 1000) / 1000, y: Math.round(o.y * 1000) / 1000 } };
        $.ajax({ url: '/api/plazma/remnants', method: 'POST', contentType: 'application/json', data: JSON.stringify(body) })
          .done(function() {
            if ($('#prZero').is(':checked')) sendGcode('G10 L2 P1 X' + body.origin.x + ' Y' + body.origin.y);
            toast('Artık sac kaydedildi: ' + rel.length + ' köşe. CAM → Nesting\'te artık saclar listesinde.');
            p.remove();
          })
          .fail(function(x) { toast('Kaydedilemedi: ' + x.status, 'bg-red fg-white'); });
      }
    });
  };

  // ---------- durum rozeti ----------
  function badge() {
    var d = plazmaAlignAngle();
    $('#plazmaAlignBadge').text(d ? (d >= 0 ? '+' : '') + d.toFixed(2) + '°' : 'kapalı').css('color', d ? '#ff6a00' : '#888');
  }
  $(badge);
})();
