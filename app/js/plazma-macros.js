// Plazma CONTROL — hazır plazma makroları (ek özellik)
// macros.js'ten sonra, document.ready'den önce yüklenir; makrolar bir kez eklenir.
// Kullanıcı sonradan düzenler/silerse tekrar eklenmez (mevcut makro sistemi aynen kullanılır).
(function() {
  'use strict';
  var FLAG = 'plazmaMacrosV1';
  try {
    if (localStorage.getItem(FLAG) || typeof buttonsarray === 'undefined') return;
    var macros = [{
      title: 'Torç Testi',
      icon: 'fas fa-fire',
      class: 'alert',
      tooltip: 'Torcu 0.5 sn ateşler ve kapatır. Torç altında metal olsun!',
      gcode: 'M3 S1000; Torc ac\nG4 P0.5\nM3 S0; Torc kapa\nM5'
    }, {
      title: 'Yoklama Testi',
      icon: 'fas fa-arrow-down',
      class: 'warning',
      tooltip: 'Yüzeye iner (G38.2), değdiğinde durur ve 10 mm kalkar. Z sıfırını DEĞİŞTİRMEZ.',
      gcode: 'G91\nG38.2 Z-50 F300; Yuzeye in\nG0 Z10; Kalk\nG90'
    }, {
      title: 'Z Sıfırla (IHS)',
      icon: 'fas fa-ruler-vertical',
      class: 'info',
      tooltip: 'Yüzeye iner, Z sıfırını metal yüzeyine ayarlar (anahtar boşluğu 3 mm), 10 mm kalkar. Boşluk farklıysa makroyu düzenleyin.',
      gcode: 'G91\nG38.2 Z-50 F300; Yuzeye in\nG90\nG10 L20 P1 Z-3; Z sifir (anahtar boslugu)\nG0 Z10'
    }, {
      title: 'Torcu Kaldır',
      icon: 'fas fa-arrow-up',
      class: 'secondary',
      tooltip: 'Torcu bulunduğu yerden 10 mm yukarı kaldırır',
      gcode: 'G91\nG0 Z10\nG90'
    }, {
      title: 'Sıfıra Git',
      icon: 'fas fa-crosshairs',
      class: 'success',
      tooltip: 'Önce 10 mm kalkar, sonra iş sıfırına (X0 Y0) gider',
      gcode: 'G91\nG0 Z10\nG90\nG0 X0 Y0'
    }];
    macros.forEach(function(m) {
      var exists = buttonsarray.some(function(b) { return b.title === m.title; });
      if (exists) return;
      buttonsarray.push({
        title: m.title,
        icon: m.icon,
        codetype: 'gcode',
        gcode: m.gcode,
        javascript: '',
        class: m.class,
        tooltip: m.tooltip,
        macrokeyboardshortcut: '',
        jsrunonstartup: false
      });
    });
    localStorage.setItem('macroButtons', JSON.stringify(buttonsarray));
    localStorage.setItem(FLAG, '1');
  } catch (e) {
    console.warn('Plazma makroları eklenemedi:', e);
  }
})();
