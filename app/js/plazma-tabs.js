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

  // Electron (Windows) hatası: confirm() / alert() kutusu kapandıktan sonra pencere klavye odağını kaybeder,
  // yazı alanlarına tıklansa da yazılamaz. Kutudan sonra ana süreç pencereyi blur + focus yapar (index.js
  // 'plazmaRefocus'). CAM çerçevesindeki kutular da postMessage ile buraya bildirilir (plazma-viewer-fix.js).
  var refocusFrame = false;
  function refocus(frame) {
    refocusFrame = frame;
    if (typeof socket !== 'undefined' && socket && socket.emit) socket.emit('plazmaRefocus');
  }
  ['confirm', 'alert', 'prompt'].forEach(function(name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function() {
      var r = orig.apply(window, arguments);
      refocus(false);
      return r;
    };
  });
  window.addEventListener('message', function(e) {
    if (e.origin !== new URL(CAM_URL).origin && e.origin !== 'http://127.0.0.1:3110') return;
    if (e.data && e.data.plazma === 'refocus') refocus(true);
  });
  // Pencere odağı geri gelince odağı kutuyu açan çerçeveye ver
  window.addEventListener('focus', function() {
    if (!refocusFrame) return;
    refocusFrame = false;
    var fr = document.getElementById('camFrame');
    if (fr && fr.contentWindow) fr.contentWindow.focus();
  });
})();
