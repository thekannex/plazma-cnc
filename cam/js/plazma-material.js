// Plasma Kontrol — Malzeme kütüphanesi / kesim tablosu (ek özellik)
// Toolpath ayar penceresine "Plazma: Malzeme" satırı ekler. Malzeme seçilince kerf, hız, delme yüksekliği,
// delme bekleme, kesim yüksekliği ve lead-in kendiliğinden dolar. Akım ve hava basıncı makinede elle
// ayarlandığı için G-code'a not olarak yazılır (CONTROL iş öncesi kontrolde gösterir).
// Kütüphane tarayıcı deposunda (localStorage 'plazmaMaterials') tutulur.
(function() {
  'use strict';
  var KEY = 'plazmaMaterials';

  // Örnek değerler (~45 A hava plazması, siyah sac). Kendi makinenin kesim tablosuna göre düzeltilmeli.
  var DEFAULTS = [
    ['Siyah sac 1 mm', 1, 1.0, 5500, 3.8, 0.1, 1.5, 3, 25, 5.0],
    ['Siyah sac 2 mm', 2, 1.2, 4000, 3.8, 0.2, 1.5, 3, 30, 5.0],
    ['Siyah sac 3 mm', 3, 1.4, 2800, 3.8, 0.4, 1.5, 4, 40, 5.5],
    ['Siyah sac 4 mm', 4, 1.5, 2200, 3.8, 0.5, 1.5, 4, 45, 5.5],
    ['Siyah sac 5 mm', 5, 1.6, 1700, 4.0, 0.6, 1.5, 5, 45, 5.5],
    ['Siyah sac 6 mm', 6, 1.7, 1300, 4.0, 0.7, 1.5, 5, 45, 5.5],
    ['Siyah sac 8 mm', 8, 1.8, 900, 4.5, 1.0, 1.5, 6, 45, 5.5],
    ['Siyah sac 10 mm', 10, 2.0, 600, 5.0, 1.4, 1.5, 7, 45, 5.5],
    ['Paslanmaz 2 mm', 2, 1.2, 3000, 3.8, 0.3, 1.5, 3, 35, 5.0],
    ['Alüminyum 3 mm', 3, 1.5, 3000, 3.8, 0.3, 1.5, 4, 40, 5.5]
  ].map(function(r, i) {
    return { id: 'm' + (i + 1), name: r[0], thick: r[1], kerf: r[2], feed: r[3], pierceH: r[4], pierceD: r[5], cutH: r[6], leadin: r[7], amps: r[8], air: r[9], note: '' };
  });

  // k: kütüphane alanı, input: toolpath penceresindeki alan (yoksa sadece not)
  var FIELDS = [
    { k: 'name', t: 'Ad', w: 150, text: true },
    { k: 'thick', t: 'Kalınlık<br>mm', w: 60 },
    { k: 'kerf', t: 'Kerf<br>mm', w: 55, input: 'tplasmakerf' },
    { k: 'feed', t: 'Kesim hızı<br>mm/dk', w: 70, input: 'tspeed' },
    { k: 'pierceH', t: 'Delme yük.<br>mm', w: 60, input: 'tplasmapierceheight' },
    { k: 'pierceD', t: 'Delme bekl.<br>sn', w: 60, input: 'tplasmapiercedelay' },
    { k: 'cutH', t: 'Kesim yük.<br>mm', w: 60, input: 'tplasmazheight' },
    { k: 'leadin', t: 'Lead-in<br>mm', w: 55, input: 'tplasmaleadin' },
    { k: 'amps', t: 'Akım<br>A', w: 50 },
    { k: 'air', t: 'Hava<br>bar', w: 50 },
    { k: 'note', t: 'Not', w: 120, text: true }
  ];

  function load() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(a)) return a;
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  function get(id) { return id ? load().filter(function(m) { return m.id === id; })[0] || null : null; }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function toast(m, c) { Metro.toast.create(m, null, 4000, c || 'bg-green fg-white'); }

  // Toolpath userData'sına malzeme değerlerini yazar
  function applyToUserData(ud, m) {
    ud.plazmaMaterial = m.id;
    ud.camPlasmaKerf = String(m.kerf);
    ud.camFeedrate = String(m.feed);
    ud.camPlasmaPierceHeight = String(m.pierceH);
    ud.camPlasmaPierceDelay = String(m.pierceD);
    ud.camPlasmaZHeight = String(m.cutH);
    ud.camPlasmaLeadinDist = String(m.leadin);
  }

  function matLabel(m) {
    var extra = [m.amps ? m.amps + ' A' : '', m.air ? m.air + ' bar' : ''].filter(Boolean).join(', ');
    return m.name + (extra ? ' (' + extra + ')' : '');
  }

  function options(sel) {
    return '<option value="">— Elle gir —</option>' + load().map(function(m) {
      return '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(matLabel(m)) + '</option>';
    }).join('');
  }

  // ---------- Toolpath penceresi ----------
  function inject(i) {
    if (!toolpathsInScene[i] || $('#plazmaMatRow' + i).length) return;
    var kerfRow = $('#tplasmakerf' + i).closest('tr');
    if (!kerfRow.length) return;
    var ud = toolpathsInScene[i].userData || {};
    var sel = ud.plazmaMaterial;
    if (!ud.camOperation) {
      try { sel = (JSON.parse(localStorage.getItem('lastCamOperation')) || {}).plazmaMaterial; } catch (e) {}
    }
    var row = $('<tr class="inputplasma" id="plazmaMatRow' + i + '"><td>Plazma: Malzeme</td><td>' +
      '<div class="input-addon"><span class="input-addon-label-left active-border"><i class="fas fa-layer-group fa-fw" style="color:#ff6a00"></i></span>' +
      '<select class="cam-form-field cam-form-field-right active-border" id="tplazmamat' + i + '" style="width:220px;border-left:solid 1px #ccc;padding:0 0 0 10px;">' + options(sel) + '</select>' +
      '<button type="button" class="button small" style="margin-left:4px" title="Malzeme kütüphanesini düzenle" onclick="PlazmaMaterial.manage()"><i class="fas fa-edit"></i></button>' +
      '</div></td></tr>');
    kerfRow.before(row);
    row.css('display', kerfRow.css('display') === 'none' ? 'none' : '');

    $('#tplazmamat' + i).on('change', function() {
      var m = get($(this).val());
      if (m) {
        FIELDS.forEach(function(f) { if (f.input) $('#' + f.input + i).val(m[f.k]); });
        $('#tplasmakerf' + i).trigger('change'); // orijinal pencere SVG etiketlerini günceller
      }
      updateCamUserData(i);
    });
    // Değerlerden biri elle değiştirilirse seçim "Elle"ye döner
    FIELDS.forEach(function(f) {
      if (!f.input) return;
      $('#' + f.input + i).on('input', function() {
        var m = get($('#tplazmamat' + i).val());
        if (m && parseFloat($(this).val()) !== parseFloat(m[f.k])) { $('#tplazmamat' + i).val(''); updateCamUserData(i); }
      });
    });
    // Yeni toolpath'te son kullanılan malzeme seçiliyse değerleri ondan al
    if (!ud.camOperation && get(sel)) $('#tplazmamat' + i).trigger('change');
  }

  if (typeof window.setupJob === 'function') {
    var origSetup = window.setupJob;
    window.setupJob = function(i) {
      try { return origSetup.apply(this, arguments); } finally { try { inject(i); } catch (e) { console.error('Plazma malzeme satırı', e); } }
    };
  }
  if (typeof window.updateCamUserData === 'function') {
    var origUpd = window.updateCamUserData;
    window.updateCamUserData = function(i) {
      var r = origUpd.apply(this, arguments);
      var s = $('#tplazmamat' + i);
      if (s.length && toolpathsInScene[i]) {
        toolpathsInScene[i].userData.plazmaMaterial = s.val() || '';
        try { localStorage.setItem('lastCamOperation', JSON.stringify(toolpathsInScene[i].userData, inflatedReplacer)); } catch (e) {}
      }
      return r;
    };
  }

  // G-code'a malzeme notu (akım/hava makinede elle ayarlanır)
  if (typeof window.generateGcode === 'function') {
    var origGen = window.generateGcode;
    window.generateGcode = function(index) {
      var g = origGen.apply(this, arguments);
      try {
        var ud = toolpathsInScene[index] && toolpathsInScene[index].userData;
        var m = ud && String(ud.camOperation || '').indexOf('Plasma') === 0 && get(ud.plazmaMaterial);
        if (m && typeof g === 'string') {
          var note = '; Malzeme: ' + m.name + (m.amps ? ' | Akim ' + m.amps + ' A' : '') + (m.air ? ' | Hava ' + m.air + ' bar' : '') + (m.note ? ' | ' + m.note : '');
          g = /^; Plasma Kerf:.*$/m.test(g) ? g.replace(/^(; Plasma Kerf:.*)$/m, '$1\n' + note) : note + '\n' + g;
        }
      } catch (e) { console.error('Plazma malzeme notu', e); }
      return g;
    };
  }

  // ---------- Kütüphane düzenleyici ----------
  var ov = null;
  function build() {
    $('head').append('<style>' +
      '#pmOv{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:none;align-items:center;justify-content:center;}' +
      '#pmBox{background:#fff;color:#222;border-radius:6px;border-top:4px solid #ff6a00;box-shadow:0 6px 30px rgba(0,0,0,.4);max-width:96vw;max-height:90vh;display:flex;flex-direction:column;font-size:12px;}' +
      '#pmBox .pm-h{display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #ddd;}' +
      '#pmBox .pm-h b{flex:1;font-size:14px;}' +
      '#pmBox .pm-b{overflow:auto;padding:8px 12px;}' +
      '#pmBox table{border-collapse:collapse;}' +
      '#pmBox th{font-weight:600;text-align:left;padding:2px 3px;vertical-align:bottom;line-height:1.15;}' +
      '#pmBox td{padding:1px 3px;}' +
      '#pmBox input{height:24px;border:1px solid #bbb;border-radius:3px;padding:0 4px;font-size:12px;box-sizing:border-box;}' +
      '#pmBox .pm-btn{border:1px solid #999;background:#fff;border-radius:3px;padding:4px 10px;cursor:pointer;margin-left:4px;font-size:12px;}' +
      '#pmBox .pm-btn.pri{background:#ff6a00;color:#fff;border-color:#e05500;font-weight:700;}' +
      '#pmBox .pm-i{cursor:pointer;padding:0 4px;color:#666;}' +
      '#pmBox .pm-f{display:flex;align-items:center;padding:8px 12px;border-top:1px solid #ddd;}' +
      '</style>');
    ov = $('<div id="pmOv"><div id="pmBox"><div class="pm-h"><b><i class="fas fa-layer-group" style="color:#ff6a00"></i> Malzeme Kütüphanesi (Kesim Tablosu)</b><span class="pm-i" data-a="close" title="Kapat">✕</span></div>' +
      '<div class="pm-b"><div style="color:#666;margin-bottom:6px">Değerler örnektir; makinenin kesim tablosuna ve deneme kesimlerine göre düzeltin. Akım ve hava basıncı makinede elle ayarlanır, G-code\'a not olarak yazılır.</div><table id="pmTable"></table></div>' +
      '<div class="pm-f"><button class="pm-btn" data-a="add">+ Yeni malzeme</button><button class="pm-btn" data-a="reset" title="Örnek tabloya dön">Örnek tabloyu yükle</button><span style="flex:1"></span>' +
      '<button class="pm-btn" data-a="close">İptal</button><button class="pm-btn pri" data-a="save">Kaydet</button></div></div></div>');
    $('body').append(ov);
    ov.on('click', '[data-a]', function() {
      var a = $(this).data('a'), list = read();
      if (a === 'close') ov.css('display', 'none');
      else if (a === 'add') { list.push({ id: 'm' + Date.now(), name: 'Yeni malzeme', thick: '', kerf: 1.5, feed: 2000, pierceH: 3.8, pierceD: 0.5, cutH: 1.5, leadin: 4, amps: '', air: '', note: '' }); render(list); }
      else if (a === 'reset') { if (confirm('Tablo örnek değerlerle değiştirilsin mi? Kendi girdikleriniz silinir.')) render(JSON.parse(JSON.stringify(DEFAULTS))); }
      else if (a === 'del') { list.splice($(this).closest('tr').index() - 1, 1); render(list); }
      else if (a === 'dup') { var k = $(this).closest('tr').index() - 1, c = $.extend({}, list[k], { id: 'm' + Date.now(), name: list[k].name + ' (kopya)' }); list.splice(k + 1, 0, c); render(list); }
      else if (a === 'save') commit(list);
    });
  }
  function render(list) {
    var h = '<tr><th></th>' + FIELDS.map(function(f) { return '<th>' + f.t + '</th>'; }).join('') + '<th></th></tr>';
    list.forEach(function(m, r) {
      h += '<tr data-id="' + esc(m.id) + '"><td style="color:#999">' + (r + 1) + '</td>' + FIELDS.map(function(f) {
        return '<td><input data-k="' + f.k + '" type="' + (f.text ? 'text' : 'number') + '" step="any" style="width:' + f.w + 'px" value="' + esc(m[f.k]) + '"></td>';
      }).join('') + '<td><span class="pm-i" data-a="dup" title="Kopyala"><i class="far fa-copy"></i></span><span class="pm-i" data-a="del" title="Sil"><i class="fas fa-trash"></i></span></td></tr>';
    });
    $('#pmTable').html(h);
  }
  function read() {
    return $('#pmTable tr[data-id]').map(function() {
      var m = { id: $(this).data('id') + '' };
      $(this).find('input').each(function() {
        var k = $(this).data('k'), v = $(this).val();
        m[k] = $(this).attr('type') === 'number' ? (v === '' ? '' : parseFloat(v)) : v.trim();
      });
      return m;
    }).get();
  }
  function commit(list) {
    var bad = list.filter(function(m) { return !m.name || !(m.kerf >= 0) || !(m.feed > 0) || !(m.pierceH > 0) || !(m.cutH > 0) || !(m.pierceD >= 0); });
    if (bad.length) { toast('Eksik değer: ' + (bad[0].name || '(adsız)') + '. Ad, kerf, hız, delme ve kesim yüksekliği gerekli.', 'bg-red fg-white'); return; }
    save(list);
    ov.css('display', 'none');
    // Açık pencerelerdeki listeleri ve bu malzemeyi kullanan toolpath'leri güncelle
    $('select[id^=tplazmamat]').each(function() { var v = $(this).val(); $(this).html(options(v)); });
    var n = 0;
    (toolpathsInScene || []).forEach(function(tp, i) {
      var m = tp.userData && get(tp.userData.plazmaMaterial);
      if (!m) return;
      var before = JSON.stringify([tp.userData.camPlasmaKerf, tp.userData.camFeedrate, tp.userData.camPlasmaPierceHeight, tp.userData.camPlasmaPierceDelay, tp.userData.camPlasmaZHeight, tp.userData.camPlasmaLeadinDist]);
      applyToUserData(tp.userData, m);
      var after = JSON.stringify([tp.userData.camPlasmaKerf, tp.userData.camFeedrate, tp.userData.camPlasmaPierceHeight, tp.userData.camPlasmaPierceDelay, tp.userData.camPlasmaZHeight, tp.userData.camPlasmaLeadinDist]);
      if (before !== after) { n++; try { toolpathPreview(i); } catch (e) {} }
    });
    toast('Malzeme kütüphanesi kaydedildi' + (n ? '. ' + n + ' toolpath yeni değerlerle güncellendi, G-code\'u yeniden oluşturun.' : ''));
  }

  window.PlazmaMaterial = {
    list: load,
    get: get,
    applyToUserData: applyToUserData,
    manage: function() {
      if (!ov) build();
      render(load());
      ov.css('display', 'flex');
    }
  };
})();
