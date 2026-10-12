// Plasma Kontrol — Makine profilleri (ek özellik)
// Ayar penceresindeki her şey (makine ölçüsü, eklenti: plazma / router / lazer, G-code komutları, IHS,
// plazma ayarları) ve son kullanılan toolpath ayarları bir isimle saklanır. Program açılınca kayıtlı
// makinelerden biri seçilir; gün içinde şeritteki "Makine" düğmesiyle değiştirilir (ör. plazma ↔ router).
// Profil yokken orijinal davranış sürer (eksik ayar varsa ayar penceresi açılır); ilk Kaydet profili oluşturur.
(function() {
  'use strict';
  var KEY = 'plazmaMachineProfiles', ACTIVE = 'plazmaMachineActive', ASK = 'plazmaMachineAsk', SESSION = 'plazmaMachineSession';
  var HAS = ['hasRouter', 'hasPlasma', 'hasLaser', 'hasPenPlotter', 'hasSpindle', 'hasDust'];
  var editing = null; // null | 'new' | profil id

  function ls(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function ss(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function toast(m, c) { Metro.toast.create(m, null, 4000, c || 'bg-green fg-white'); }

  function load() { try { var a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function save(list) { lsSet(KEY, JSON.stringify(list)); }
  function byId(id) { return load().filter(function(p) { return p.id === id; })[0] || null; }
  function active() { return byId(ls(ACTIVE, '')); }

  // Profilde saklanan anahtarlar: ayar penceresinin alanları + eklentiler + son toolpath ayarları
  function keys() { return (window.localParams || []).map(function(p) { return p[0]; }).concat(HAS, ['lastCamOperation']); }
  function snapshot() { var o = {}; keys().forEach(function(k) { o[k] = ls(k, null); }); return o; }
  function same(a, b) { return keys().every(function(k) { return (a[k] === undefined ? null : a[k]) === (b[k] === undefined ? null : b[k]); }); }
  function apply(p) { keys().forEach(function(k) { lsSet(k, p.settings[k] === undefined ? null : p.settings[k]); }); }

  function kind(st) {
    if (st.hasPlasma === 'true') return { t: 'Plazma', i: 'fa-fire', c: '#ff6a00' };
    if (st.hasRouter === 'true' || st.hasSpindle === 'true') return { t: 'Router', i: 'fa-cog', c: '#1e88e5' };
    if (st.hasLaser === 'true') return { t: 'Lazer', i: 'fa-bolt', c: '#e53935' };
    if (st.hasPenPlotter === 'true') return { t: 'Kalem', i: 'fa-pen', c: '#6d4c41' };
    return { t: 'Diğer', i: 'fa-cube', c: '#757575' };
  }
  function sizeTxt(st) { return st.sizexmax && st.sizeymax ? st.sizexmax + ' × ' + st.sizeymax + ' mm' : ''; }

  function updateButton() {
    var p = active();
    $('#plazmaMachBtnName').text(p ? p.name : 'Seçilmedi');
    if (!$('#plazmaMachName').is(':focus')) $('#plazmaMachName').val(editing === 'new' ? '' : p ? p.name : '');
    $('#plazmaMachNewRow').toggle(!!p && editing !== 'new');
    $('#plazmaMachNew').prop('checked', false);
  }

  // Ayar penceresini aç: 'new' = yeni makine, id = o makineyi düzenle, null = aktif makine
  function openSettings(mode) {
    editing = mode || null;
    updateButton();
    if (mode === 'new') $('#plazmaMachName').val('');
    Metro.dialog.open('#settingsmodal');
    setTimeout(function() { $('#plazmaMachName').focus(); }, 300);
  }

  // Ayar penceresi Kaydet'ten sonra (orijinal saveSettingsLocal ayarları yazdıktan sonra)
  function saveFromSettings() {
    if (!$('#machinetype').val()) { $('#machinetype').val('custom'); saveSetting('machinetype', 'custom'); } // zorunlu alan: her açılışta sormasın
    var list = load(), cur = active();
    var asNew = editing === 'new' || !cur || $('#plazmaMachNew').is(':checked');
    var name = ($('#plazmaMachName').val() || '').trim();
    if (!name) name = asNew ? kind(snapshot()).t + ' ' + (list.length + 1) : cur.name;
    var p;
    if (asNew) { p = { id: 'mp' + Date.now(), name: name, settings: snapshot() }; list.push(p); }
    else { p = list.filter(function(x) { return x.id === cur.id; })[0]; p.name = name; p.settings = snapshot(); }
    save(list);
    lsSet(ACTIVE, p.id);
    ssSet(SESSION, p.id);
    editing = null;
    updateButton();
    toast('Makine kaydedildi: <b>' + esc(p.name) + '</b>');
  }

  // Seç: farklı ayarlar ise uygula ve CAM'i yenile (ızgara, eklentiler ve formlar yeni ayarla kurulsun)
  function choose(id, then) {
    var p = byId(id);
    if (!p) return;
    lsSet(ACTIVE, p.id);
    ssSet(SESSION, p.id);
    if (same(snapshot(), p.settings)) { close(); updateButton(); if (then === 'edit') openSettings(p.id); else toast('Makine: <b>' + esc(p.name) + '</b>'); return; }
    apply(p);
    if (then === 'edit') ssSet('plazmaMachineEditAfter', '1');
    location.reload();
  }

  // ---------- seçim penceresi ----------
  var ov = null, sel = null;
  function build() {
    $('head').append('<style>' +
      '#pmcOv{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2100;display:none;align-items:center;justify-content:center;}' +
      '#pmcBox{background:#fff;color:#222;width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;border-radius:6px;border-top:4px solid #ff6a00;box-shadow:0 6px 30px rgba(0,0,0,.4);font-size:13px;}' +
      '#pmcBox .h{padding:10px 14px;font-size:15px;font-weight:700;border-bottom:1px solid #ddd;}' +
      '#pmcBox .b{padding:8px 14px;overflow:auto;}' +
      '#pmcBox .row{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #ddd;border-radius:5px;margin-bottom:6px;cursor:pointer;}' +
      '#pmcBox .row:hover{background:#fafafa;}' +
      '#pmcBox .row.on{border-color:#ff6a00;background:#fff6ef;}' +
      '#pmcBox .row .n{font-weight:700;font-size:14px;}' +
      '#pmcBox .row .d{color:#777;font-size:12px;}' +
      '#pmcBox .row .ic{width:28px;text-align:center;font-size:20px;}' +
      '#pmcBox .ac{margin-left:auto;white-space:nowrap;}' +
      '#pmcBox .ac span{cursor:pointer;padding:3px 6px;color:#666;}' +
      '#pmcBox .ac span:hover{color:#000;}' +
      '#pmcBox .f{display:flex;align-items:center;gap:6px;padding:10px 14px;border-top:1px solid #ddd;}' +
      '#pmcBox button{border:1px solid #999;background:#fff;border-radius:3px;padding:5px 12px;cursor:pointer;font-size:13px;}' +
      '#pmcBox button.pri{background:#ff6a00;color:#fff;border-color:#e05500;font-weight:700;}' +
      '</style>');
    ov = $('<div id="pmcOv"><div id="pmcBox"><div class="h"><i class="fas fa-industry" style="color:#ff6a00"></i> Makine Seç</div>' +
      '<div class="b" id="pmcList"></div>' +
      '<div class="f"><button data-a="new">+ Yeni makine</button>' +
      '<label style="flex:1;color:#666;margin-left:6px"><input type="checkbox" id="pmcAsk"> Her açılışta sor</label>' +
      '<button data-a="close">İptal</button><button class="pri" data-a="ok">Seç</button></div></div></div>');
    $('body').append(ov);
    ov.on('click', '.row', function(e) {
      var id = $(this).data('id'), a = $(e.target).closest('[data-r]').data('r');
      if (a === 'edit') { choose(id, 'edit'); return; }
      if (a === 'copy') {
        var list = load(), p = list.filter(function(x) { return x.id === id; })[0];
        list.push({ id: 'mp' + Date.now(), name: p.name + ' (kopya)', settings: $.extend({}, p.settings) });
        save(list); render(); return;
      }
      if (a === 'del') {
        var q = byId(id);
        if (!confirm('"' + q.name + '" makinesi silinsin mi?')) return;
        save(load().filter(function(x) { return x.id !== id; }));
        if (ls(ACTIVE, '') === id) lsSet(ACTIVE, null);
        if (sel === id) sel = null;
        render(); updateButton(); return;
      }
      sel = id; render();
    });
    ov.on('dblclick', '.row', function() { choose($(this).data('id')); });
    ov.on('click', '[data-a]', function() {
      var a = $(this).data('a');
      if (a === 'new') { close(); openSettings('new'); }
      else if (a === 'close') { close(); ssSet(SESSION, ls(ACTIVE, '') || 'iptal'); }
      else if (a === 'ok') { if (sel) choose(sel); else toast('Bir makine seçin', 'bg-red fg-white'); }
    });
    ov.on('change', '#pmcAsk', function() { lsSet(ASK, this.checked ? '1' : '0'); });
  }
  function render() {
    var list = load();
    $('#pmcList').html(list.length ? list.map(function(p) {
      var k = kind(p.settings);
      return '<div class="row' + (p.id === sel ? ' on' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="ic"><i class="fas ' + k.i + '" style="color:' + k.c + '"></i></div>' +
        '<div><div class="n">' + esc(p.name) + (p.id === ls(ACTIVE, '') ? ' <small style="color:#ff6a00">(son kullanılan)</small>' : '') + '</div>' +
        '<div class="d">' + k.t + (sizeTxt(p.settings) ? ' · ' + sizeTxt(p.settings) : '') + '</div></div>' +
        '<div class="ac"><span data-r="edit" title="Ayarlarını düzenle"><i class="fas fa-edit"></i></span><span data-r="copy" title="Kopyala"><i class="far fa-copy"></i></span><span data-r="del" title="Sil"><i class="fas fa-trash"></i></span></div></div>';
    }).join('') : '<div style="color:#777;padding:10px 0">Kayıtlı makine yok. <b>+ Yeni makine</b> ile ayarları girip bir isimle kaydedin.</div>');
    $('#pmcAsk').prop('checked', ls(ASK, '1') === '1');
  }
  function open() {
    if (!ov) build();
    sel = ls(ACTIVE, '') || (load()[0] || {}).id || null;
    render();
    ov.css('display', 'flex');
  }
  function close() { if (ov) ov.css('display', 'none'); }

  // ---------- açılış ----------
  // Orijinal kontrol eksik ayarda ayar penceresini açar; profil varsa onun yerine makine seçimi gelir.
  if (typeof window.checkSettingsLocal === 'function') {
    var origCheck = window.checkSettingsLocal;
    window.checkSettingsLocal = function() {
      if (!load().length) return origCheck.apply(this, arguments);
      if (ss('plazmaMachineEditAfter')) { // düzenlemek için seçildi, sayfa yenilendi
        try { sessionStorage.removeItem('plazmaMachineEditAfter'); } catch (e) {}
        setTimeout(function() { openSettings(ls(ACTIVE, '')); }, 800);
        return;
      }
      if (ss(SESSION)) return; // bu oturumda seçildi
      if (ls(ASK, '1') === '1') setTimeout(open, 600);
      else ssSet(SESSION, ls(ACTIVE, '') || 'otomatik');
    };
  }

  $(function() {
    // Ayar penceresinin başına makine adı
    $('#settingsmodal .dialog-content form').prepend(
      '<div style="border:1px solid #ff6a00;border-radius:5px;padding:8px 10px;margin-bottom:10px;">' +
      '<div style="display:flex;align-items:center;gap:8px;"><b style="white-space:nowrap"><i class="fas fa-industry" style="color:#ff6a00"></i> Makine adı</b>' +
      '<input type="text" id="plazmaMachName" class="form-control form-control-sm" placeholder="ör. Plazma 1500x3000 veya Router" style="flex:1"></div>' +
      '<div id="plazmaMachNewRow" style="margin-top:4px;font-size:12px;"><label><input type="checkbox" id="plazmaMachNew"> Yeni makine olarak kaydet (mevcut makine değişmez)</label></div>' +
      '<div style="font-size:12px;opacity:.75;margin-top:2px;">Kaydet\'e basınca bu ayarlar bu isimle saklanır. Program açılınca kayıtlı makinelerden biri seçilir.</div></div>');
    $('#savesettings').on('click', function() { setTimeout(saveFromSettings, 0); });
    $('#settingsmodal').on('click', '.js-dialog-close:not(#savesettings)', function() { editing = null; });
    updateButton();
  });

  window.PlazmaMachines = { open: open, openSettings: openSettings };
})();
