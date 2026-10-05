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
})();
