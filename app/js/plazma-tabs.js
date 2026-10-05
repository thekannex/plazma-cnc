// Plazma CONTROL: "Çizim (CAM)" sekmesi
// OpenBuilds CAM kendi sunucusunda (127.0.0.1:3110) çalışır ve bu sekmede çerçeve içinde gösterilir.
// CAM'deki "CONTROL'e Gönder" düğmesi, CONTROL'ün mevcut POST /upload kapısını kullanır.
// CONTROL'ün mevcut 'gcodeupload' işleyicisi G-code'u yükler ve #controlTab'e tıklar,
// böylece Machine Control sekmesi kendiliğinden açılır.
(function() {
  'use strict';
  var CAM_URL = 'http://localhost:3110/';

  function sizeFrame() {
    var fr = document.getElementById('camFrame');
    if (!fr || !$('#camPanel').is(':visible')) return;
    var top = fr.getBoundingClientRect().top;
    fr.style.height = Math.max(300, window.innerHeight - top) + 'px';
  }

  window.camPanel = function() {
    $('#manualControlPanel, #grblPanel, #fluidncPanel, #updatePanel, #troubleshootingPanel').hide();
    $('#camPanel').show();
    // CAM sekmesinde üst şerit alanı boş kalıyor: gizle, CAM'e yer aç
    $('#section-cam').closest('.content-holder').hide();
    var fr = document.getElementById('camFrame');
    if (!fr.getAttribute('src')) {
      fr.setAttribute('src', CAM_URL + '?control=' + encodeURIComponent(location.origin));
    }
    sizeFrame();
  };

  // Mevcut panel fonksiyonları çağrıldığında CAM panelini gizle (orijinal davranış korunur)
  ['manualcontrolPanel', 'grblPanel', 'fluidncPanel', 'updatePanel', 'troubleshootingPanel'].forEach(function(name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function() {
      $('#camPanel').hide();
      $('#section-cam').closest('.content-holder').show();
      return orig.apply(this, arguments);
    };
  });

  $(window).on('resize', sizeFrame);
})();
