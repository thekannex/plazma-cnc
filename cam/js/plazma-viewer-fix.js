// Plasma Kontrol — çizim alanı donma düzeltmesi (ek dosya; viewer.js'teki animate() yerine geçer)
// Orijinal animate() her çağrıda kendine yeni bir zamanlayıcı kurar. Toolpath her hesaplandığında ve pencere
// her odak aldığında animate() tekrar çağrıldığı için çizim döngüleri birikir: bir süre sonra saniyede yüzlerce
// kare çizilir, işlemci dolar ve çizim alanı donar. Ayrıca döngü içinde tek bir hata oluşursa zamanlayıcı
// kurulmadan çıkılır ve çizim tamamen durur (Reset View de kurtarmaz).
// Bu sürüm: aynı anda tek döngü, hatada döngü durmaz (hata konsola bir kez yazılır), duraklatma takılı kalırsa
// çizim alanına tıklanınca / tekerlek çevrilince döngü yeniden başlar. Çizilen sahne orijinalle aynıdır.
(function() {
  'use strict';
  if (typeof window.animate !== 'function') return;

  var timer = null, lastErr = '';

  function report(where, e) {
    var msg = where + ': ' + (e && e.message || e);
    if (msg === lastErr) return;
    lastErr = msg;
    console.error('Çizim alanı hatası (döngü devam ediyor) — ' + msg, e);
  }

  function schedule() {
    if (timer) return; // zaten bir sonraki kare kurulu: ikinci döngü açma
    timer = setTimeout(function() {
      requestAnimationFrame(function() { timer = null; window.animate(); });
    }, 60);
  }

  function rebuildScene() {
    animateTree();
    while (scene.children.length > 1) scene.remove(scene.children[1]);

    if ($('#view-docs').is(':checked')) {
      var documents = new THREE.Group();
      documents.name = 'Documents';
      for (var k = 0; k < objectsInScene.length; k++) documents.add(objectsInScene[k]);
      scene.add(documents);
    }

    if ($('#view-toolpath').is(':checked')) {
      var toolpaths = new THREE.Group();
      toolpaths.name = 'Toolpaths';
      for (var t = 0; t < toolpathsInScene.length; t++) {
        var ud = toolpathsInScene[t] && toolpathsInScene[t].userData;
        if (!ud || !ud.visible || !ud.inflated) continue;
        var pretty = ud.inflated.userData && ud.inflated.userData.pretty;
        toolpaths.add(pretty && pretty.children.length > 0 ? pretty : ud.inflated);
      }
      scene.add(toolpaths);
    }

    if ($('#view-gcode').is(':checked') && typeof object !== 'undefined' && object) scene.add(object);

    var hovers = new THREE.Group();
    hovers.name = 'Hover';
    for (var h = 0; h < hoverShapesinScene.length; h++) hovers.add(hoverShapesinScene[h]);
    scene.add(hovers);
  }

  window.animate = function() {
    if (pauseAnimation) return;
    try {
      camera.updateMatrixWorld();
      // seçim modunda toolpath'ler yarı saydam (orijinal davranış)
      setOpacity(toolpathsInScene, mouseState == 'select' && simstopped == true ? 0.6 : 0.1);
    } catch (e) { report('saydamlık', e); }

    if (clearSceneFlag) {
      clearSceneFlag = false; // hata olsa bile her karede yeniden denemesin
      try { rebuildScene(); } catch (e) { report('sahne', e); }
    }

    schedule();
    try { renderer.render(scene, camera); } catch (e) { report('çizim', e); }
  };

  // Odak kaybında konan duraklatma bir şekilde takılı kalırsa: çizim alanıyla etkileşimde döngüyü uyandır
  function wake() {
    if (!pauseAnimation) return;
    pauseAnimation = false;
    window.animate();
  }
  $(function() {
    $('#renderArea').on('mousedown wheel touchstart', wake);
  });

  // Electron (Windows): confirm() / alert() kutusundan sonra klavye odağı kaybolur ve ölçü alanlarına
  // yazılamaz. Kutu kapanınca CONTROL penceresine bildir, o da pencereye odağı geri verdirir (plazma-tabs.js).
  if (window.parent !== window) {
    ['confirm', 'alert', 'prompt'].forEach(function(name) {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function() {
        var r = orig.apply(window, arguments);
        try { window.parent.postMessage({ plazma: 'refocus' }, '*'); } catch (e) {}
        return r;
      };
    });
  }
})();
