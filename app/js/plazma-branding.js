// Plasma Kontrol — marka ve güncelleme ayarları (ek dosya, en son yüklenir)
(function() {
  'use strict';
  var NAME = 'Plasma Kontrol';

  // Pencere başlığı: orijinal fonksiyon "OpenBuilds CONTROL" yazıyor, adı değiştir
  if (typeof window.setWindowTitle === 'function') {
    var origTitle = window.setWindowTitle;
    window.setWindowTitle = function() {
      var r = origTitle.apply(this, arguments);
      document.title = document.title.replace('OpenBuilds CONTROL', NAME);
      return r;
    };
  }

  // Kapat düğmesi: tepsiye gizlemek yerine programı kapatır. Kesim sürüyorsa önce onay ister.
  window.plazmaQuit = function() {
    var running = typeof laststatus !== 'undefined' && laststatus.comms && (laststatus.comms.connectionStatus === 3 || laststatus.comms.connectionStatus === 4);
    if (!running) { socket.emit('minimisetotray'); return; }
    Metro.dialog.create({
      title: '<span class="fg-red">Kesim devam ediyor!</span>',
      content: '<div>Programı kapatırsanız makineye komut akışı yarıda kesilir ve <b>torç açık kalabilir</b>. Önce işi durdurun.</div>',
      actions: [
        { caption: 'Kapatma', cls: 'js-dialog-close success' },
        { caption: 'Yine de kapat', cls: 'js-dialog-close alert', onclick: function() { socket.emit('minimisetotray'); } }
      ]
    });
  };

  // Otomatik güncelleme kapalı: OpenBuilds'in GitHub sürümlerini kontrol edip
  // programı resmi OpenBuilds CONTROL ile değiştirmesin
  window.checkUpdate = function() {};
  window.updateTime = function() {};
  window.getReleaseStats = function() {};
  window.getChangelog = function() {};
})();
