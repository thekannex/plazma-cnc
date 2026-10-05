// Plazma CONTROL: CAM'de üretilen G-code'u CONTROL'ün mevcut POST /upload kapısına gönderir.
// CONTROL G-code'u editöre + 3B görünüme yükler ve Machine Control sekmesini açar (çalıştırmaz).
function plazmaControlUrl() {
  var m = /[?&]control=([^&]+)/.exec(location.search);
  if (m) return decodeURIComponent(m[1]);
  try { if (document.referrer) return new URL(document.referrer).origin; } catch (e) {}
  return 'http://localhost:3100';
}

function plazmaSendToControl() {
  var hasGcode = toolpathsInScene.some(function(tp) {
    return tp.userData && tp.userData.visible && typeof tp.userData.gcode === 'string' && tp.userData.gcode.length > 0;
  });
  if (!hasGcode) {
    Metro.toast.create("Önce toolpath oluşturup '3. Create G-code' bölümünden <b>Generate G-Code</b>'a basın", null, 4000, 'bg-red fg-white');
    return;
  }
  var g = prepgcodefile();
  var fd = new FormData();
  fd.append('file', new Blob([g], { type: 'text/plain' }), 'CAM-' + date.yyyymmdd() + '.gcode');
  var btn = $('#plazmaSendBtn').prop('disabled', true);
  fetch(plazmaControlUrl() + '/upload', { method: 'POST', body: fd })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      Metro.toast.create('G-code CONTROL\'e gönderildi', null, 2500, 'bg-green fg-white');
    })
    .catch(function(e) {
      Metro.toast.create('Gönderilemedi: ' + e.message + ' (CONTROL açık mı?)', null, 5000, 'bg-red fg-white');
    })
    .then(function() { btn.prop('disabled', false); });
}
