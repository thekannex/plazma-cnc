// Plazma CONTROL — Kuru Çalıştırma ve Çerçeve Gezme (ek özellik, orijinal kodu değiştirmez)
(function () {
  function getNum(key, def) { var v = parseFloat(localStorage.getItem(key)); return v > 0 ? v : def; }

  function machineReady() {
    if (typeof laststatus === 'undefined' || !laststatus.comms || laststatus.comms.connectionStatus < 2) {
      Metro.toast.create("Makineye bağlı değil", null, 3000, "bg-red fg-white"); return false;
    }
    if (laststatus.comms.connectionStatus > 2) {
      Metro.toast.create("Makine meşgul / alarmda", null, 3000, "bg-red fg-white"); return false;
    }
    return true;
  }

  window.plazmaMachineReady = machineReady;

  function askParams(title, withSpeed, cb) {
    var z = getNum('plazmaDrySafeZ', 10), f = getNum('plazmaFrameSpeed', 3000);
    Metro.dialog.create({
      title: title,
      content:
        '<div class="mb-2">Güvenli Z (iş koordinatı, mm): <input type="number" id="plazmaDZ" value="' + z + '"></div>' +
        (withSpeed ? '<div class="mb-2">Hız (mm/dk): <input type="number" id="plazmaDF" value="' + f + '"></div>' : '') +
        '<div class="text-small fg-gray">Torç ATEŞLENMEZ. Z sıfırının metal üstünde olduğundan emin olun.</div>',
      actions: [{
        caption: "Başlat", cls: "js-dialog-close success",
        onclick: function () {
          var nz = parseFloat($('#plazmaDZ').val()), nf = parseFloat($('#plazmaDF').val());
          if (!(nz > 0)) nz = z; if (!(nf > 0)) nf = f;
          localStorage.setItem('plazmaDrySafeZ', nz);
          if (withSpeed) localStorage.setItem('plazmaFrameSpeed', nf);
          cb(nz, nf);
        }
      }, { caption: "İptal", cls: "js-dialog-close" }]
    });
  }

  // G-code'dan torç, probe, bekleme ve Z hareketlerini çıkarır
  window.plazmaMakeDryRun = function (src, safeZ) {
    var out = ["; Plazma CONTROL - KURU CALISTIRMA (torc kapali)", "M5", "G21", "G90", "G0 Z" + safeZ];
    src.split(/\r?\n/).forEach(function (line) {
      var code = line.replace(/\(.*?\)/g, '').split(';')[0].replace(/\s+/g, '').toUpperCase();
      if (!code) return;
      // Kelimelere ayır: "M3S1000" -> ["M3","S1000"] (boşluksuz yazımı da yakalar)
      var words = code.match(/[A-Z][-+]?(\d+\.?\d*|\.\d+)/g) || [];
      var drop = words.some(function (w) {
        var l = w[0], v = parseFloat(w.slice(1));
        if (l === 'M' && (v === 3 || v === 4 || v === 5)) return true;   // torç aç/kapa
        if (l === 'M' && v >= 62 && v <= 65) return true;                 // dijital çıkış (torç rölesi olabilir)
        if (l === 'G' && v >= 38 && v < 39) return true;                  // probe (IHS)
        if (l === 'G' && (v === 10 || v === 92 || v === 4)) return true;  // koordinat ayarı / bekleme
        return false;
      });
      if (drop) return;
      words = words.filter(function (w) { return w[0] !== 'Z' && w[0] !== 'S'; });
      // Sadece hareket komutu kaldıysa (ör. "G0 Z10" -> "G0") satırı atla
      if (!words.length || (words.length === 1 && /^G0*[0-3]$/.test(words[0]))) return;
      out.push(words.join(' '));
    });
    out.push("G0 Z" + safeZ, "M5");
    return out.join("\n");
  };

  window.plazmaDryRun = function () {
    if (typeof editor === 'undefined' || editor.session.getLength() < 2) {
      Metro.toast.create("Önce G-code yükleyin", null, 3000, "bg-red fg-white"); return;
    }
    if (!machineReady()) return;
    askParams("Kuru Çalıştır", false, function (z) {
      socket.emit('runJob', { data: plazmaMakeDryRun(editor.getValue(), z), isJob: false, fileName: "", plazmaAlign: !/PLAZMA:\s*HIZALAMA YOK/i.test(editor.getValue()) });
    });
  };

  // Kesim hareketlerinin (G1/G2/G3) XY sınırları; boştaki G0 hareketleri hariç. Delme noktaları (G0 ile gidilen
  // ve hemen ardından kesime başlanan noktalar) dahil edilir.
  window.plazmaCutBounds = function (src) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    var x = 0, y = 0, rel = false, mode = 0;
    function add(px, py) { b.x0 = Math.min(b.x0, px); b.x1 = Math.max(b.x1, px); b.y0 = Math.min(b.y0, py); b.y1 = Math.max(b.y1, py); }
    src.split(/\r?\n/).forEach(function (line) {
      var code = line.replace(/\(.*?\)/g, '').split(';')[0].replace(/\s+/g, '').toUpperCase();
      var words = code.match(/[A-Z][-+]?(\d+\.?\d*|\.\d+)/g) || [];
      var w = {};
      words.forEach(function (t) {
        var l = t[0], v = parseFloat(t.slice(1));
        if (l === 'G') {
          if (v === 90) rel = false; else if (v === 91) rel = true;
          else if (v === 0 || v === 1 || v === 2 || v === 3) mode = v;
        } else w[l] = v;
      });
      if (!('X' in w) && !('Y' in w)) return;
      var nx = 'X' in w ? (rel ? x + w.X : w.X) : x, ny = 'Y' in w ? (rel ? y + w.Y : w.Y) : y;
      if (mode >= 1) {
        add(x, y); add(nx, ny);
        if ((mode === 2 || mode === 3) && ('I' in w || 'J' in w)) { // yay: süpürdüğü 0/90/180/270° uç noktaları
          var cx = x + (w.I || 0), cy = y + (w.J || 0), r = Math.hypot(x - cx, y - cy);
          var a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx), TAU = 2 * Math.PI;
          var sweep = mode === 3 ? ((a1 - a0) % TAU + TAU) % TAU : -(((a0 - a1) % TAU + TAU) % TAU);
          if (Math.abs(sweep) < 1e-9) sweep = mode === 3 ? TAU : -TAU; // tam daire
          for (var k = 0; k < 4; k++) {
            var ak = k * Math.PI / 2;
            var d = mode === 3 ? ((ak - a0) % TAU + TAU) % TAU : ((a0 - ak) % TAU + TAU) % TAU;
            if (d <= Math.abs(sweep)) add(cx + r * Math.cos(ak), cy + r * Math.sin(ak));
          }
        }
      }
      x = nx; y = ny;
    });
    return isFinite(b.x0) ? b : null;
  };

  window.plazmaFrameTrace = function () {
    if (typeof editor === 'undefined' || editor.session.getLength() < 2) {
      Metro.toast.create("Önce G-code yükleyin", null, 3000, "bg-red fg-white"); return;
    }
    var bb = plazmaCutBounds(editor.getValue());
    if (!bb) {
      Metro.toast.create("G-code'da kesim hareketi bulunamadı", null, 3000, "bg-red fg-white"); return;
    }
    if (!machineReady()) return;
    askParams("Çerçeve Gez", true, function (z, f) {
      var x0 = bb.x0.toFixed(3), x1 = bb.x1.toFixed(3), y0 = bb.y0.toFixed(3), y1 = bb.y1.toFixed(3);
      var moves = ["G21", "G90", "G0 Z" + z,
        "G0 X" + x0 + " Y" + y0,
        "G1 X" + x1 + " Y" + y0 + " F" + f,
        "G1 X" + x1 + " Y" + y1,
        "G1 X" + x0 + " Y" + y1,
        "G1 X" + x0 + " Y" + y0].join("\n");
      socket.emit('runJob', { data: moves, isJob: false, fileName: "", plazmaAlign: !/PLAZMA:\s*HIZALAMA YOK/i.test(editor.getValue()) });
    });
  };

  $(function () {
    // Açılışta kayıtlı hızı uygula
    setTimeout(function () { try { jogOverride(localStorage.getItem('jogOverride') || 100); } catch (e) {} }, 1500);
  });

  // ---------- Z için ayrı jog adımı ----------
  // Mesafe satırının altına "Z adımı" satırı eklenir. Seçiliyse adımlı jog'da Z bu mesafeyle gider
  // (ör. X/Y 100 mm, Z 0.1 mm); "Z = XY" seçiliyse orijinal davranış. Sürekli jog'u etkilemez.
  var ZSTEPS = [0.1, 1, 10, 100];
  var IN = { 0.1: [0.0254, '0.001"'], 1: [0.254, '0.01"'], 10: [2.54, '0.1"'], 100: [25.4, '1"'] }; // inç modu (X/Y ile aynı karşılıklar)
  function inch() { return typeof unit !== 'undefined' && unit === 'in'; }
  function zStep() { var v = parseFloat(localStorage.getItem('plazmaJogZ')); return ZSTEPS.indexOf(v) >= 0 ? v : null; }
  function zPaint() {
    var z = zStep();
    $('.plazmaZBtn').each(function () {
      var v = parseFloat($(this).data('z')) || null, on = v === z;
      if (v) $(this).find('span').text('Z ' + (inch() ? IN[v][1] : v + 'mm'));
      // Metro düğme stili !important kullanıyor: seçili rengi de öyle verilir
      this.style.setProperty('border-color', on ? '#ff6a00' : '', on ? 'important' : '');
      $(this).find('span').get(0).style.setProperty('color', on ? '#ff6a00' : '#888', 'important');
    });
  }
  $(function () {
    // jog.js bu dosyadan sonra yüklenir: sarmalayıcılar sayfa hazır olunca kurulur
    if (typeof window.jog === 'function') {
      var origJog = window.jog;
      window.jog = function (dir, dist, feed) {
        var z = zStep();
        if (dir === 'Z' && z) {
          var neg = String(dist).trim().charAt(0) === '-';
          dist = (neg ? '-' : '') + (inch() ? IN[z][0] : z);
        }
        return origJog.call(this, dir, dist, feed);
      };
    }
    ['mmMode', 'inMode'].forEach(function (n) {
      var o = window[n];
      if (typeof o === 'function') window[n] = function () { var r = o.apply(this, arguments); zPaint(); return r; };
    });
    var tr = $('#dist100').closest('tr');
    if (!tr.length) return;
    var btn = function (v, txt, title) {
      return '<td><button class="button light jogbtn plazmaZBtn" data-z="' + v + '" title="' + title + '" style="width:100%;height:25px;line-height:25px;padding:0;">' +
        '<span style="font-weight:900;font-family:Arial;font-size:12px;">' + txt + '</span></button></td>';
    };
    var row = $('<tr id="plazmaZDistRow">' + btn('', 'Z = XY', 'Z, X/Y ile aynı adımı kullanır') +
      ZSTEPS.map(function (s) { return btn(s, 'Z ' + s + 'mm', 'Adımlı jog\'da Z ' + s + ' mm gider'); }).join('') + '</tr>');
    tr.after(row);
    // doğrudan bağlanır (jogbtn olayları tıklamanın yukarı iletilmesini durdurabiliyor)
    row.find('.plazmaZBtn').on('click', function () { localStorage.setItem('plazmaJogZ', $(this).attr('data-z')); zPaint(); });
    zPaint();
    // Sürekli jog modunda mesafe düğmeleri gizlenir: Z satırı da onlarla birlikte
    setInterval(function () { row.toggle($('#dist10').is(':visible') || !$('#dist10').closest('table').is(':visible')); }, 500);
  });
})();
