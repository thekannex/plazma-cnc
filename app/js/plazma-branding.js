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

  // Otomatik güncelleme kapalı: OpenBuilds'in GitHub sürümlerini kontrol edip
  // programı resmi OpenBuilds CONTROL ile değiştirmesin
  window.checkUpdate = function() {};
  window.updateTime = function() {};
  window.getReleaseStats = function() {};
  window.getChangelog = function() {};
})();
