// Plazma CONTROL — FluidNC plazma varsayılanları.
// Sayfa yüklenirken (document.ready'deki loadSettingsLocal'dan ÖNCE) çalışır.
// Bir kez uygulanır; sonra kullanıcının Settings'te yaptığı değişiklikler korunur.
(function () {
  window.PLAZMA_DEFAULT_TOOLOFF = "M3 S0";
  window.PLAZMA_DEFAULT_IHS =
    "G91; Relative\n" +
    "G38.2 Z-50 F300; Touch off Probe\n" +
    "G90; Absolute\n" +
    "G10 L20 P1 Z-3; Set Z Zero - switch offset\n";

  // V2: kesim kalitesi varsayılanları (bir kez): yay lead-in, 1 mm bindirme, kesim yönü, başlangıç noktası, önce delikler
  try {
    if (!localStorage.getItem("plazmaDefaultsV2")) {
      localStorage.setItem("plazmaLeadinType", "arc");
      if (!(parseFloat(localStorage.getItem("plazmaOvercut")) > 0)) localStorage.setItem("plazmaOvercut", "1");
      if (!(parseFloat(localStorage.getItem("plazmaHoleFeed")) > 0)) localStorage.setItem("plazmaHoleFeed", "60");
      localStorage.setItem("plazmaCutDir", "std");
      localStorage.setItem("plazmaStartOpt", "on");
      localStorage.setItem("plazmaHolesFirst", "on");
      localStorage.setItem("plazmaDefaultsV2", "1");
    }
  } catch (e) {
    console.warn("Plazma kalite varsayılanları uygulanamadı:", e);
  }

  var FLAG = "plazmaDefaultsV1";
  try {
    if (localStorage.getItem(FLAG)) return;
    var oldIhs = localStorage.getItem("ihsgcode") || "";
    // Boşsa veya OpenBuilds'in hatalı (P'siz G10) varsayılanıysa değiştir
    if (!oldIhs.trim() || oldIhs.indexOf("G10 L20 Z-3") !== -1) {
      localStorage.setItem("ihsgcode", window.PLAZMA_DEFAULT_IHS);
    }
    if (!(localStorage.getItem("plasmatooloff") || "").trim() ||
        localStorage.getItem("plasmatooloff") === "undefined") {
      localStorage.setItem("plasmatooloff", window.PLAZMA_DEFAULT_TOOLOFF);
    }
    localStorage.setItem(FLAG, "1");
  } catch (e) {
    console.warn("Plazma varsayılanları uygulanamadı:", e);
  }
})();
