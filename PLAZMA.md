# Plasma Kontrol — Eklenen Özellikler ve Test Listesi

OpenBuilds CONTROL + OpenBuilds CAM'in tek pencerede birleşmiş, FluidNC plazma için eklentili hâli.
**Kural:** Orijinal özelliklere dokunulmadı; eklemeler ayrı `plazma-*.js` dosyalarında.

## Çalıştırma

- Geliştirme: `openbuilds-control` klasöründe `node_modules\.bin\electron .`
- Paketli sürüm: `dist-plazma\win-unpacked\PlasmaKontrol.exe` (kurulum gerektirmez)
- Portlar: CONTROL `3100`, CAM `3110` (resmi OpenBuilds CONTROL `3000` ile çakışmaz)

## Özellikler

### CONTROL (makine tarafı)
| Özellik | Nerede | Not |
|---|---|---|
| Çizim (CAM) sekmesi | Üst sekmeler | CAM pencere içinde açılır |
| Çerçeve Gez | Machine Control şeridi → Plazma grubu (bağlantısız da görünür) | Önce Z güvenli yüksekliğe kalkar, **sadece kesim hareketlerinin** sınırını gezer |
| Kuru Çalıştır | Machine Control şeridi → Plazma grubu | Torç/probe/bekleme/koordinat komutlarını çıkarır, güvenli Z'de gezer. Başta ve sonda `M5` |
| Jog hızı | Sağdaki dikey Jog kaydırıcısı; altındaki hız yazısına tıkla → %100 hızı ayarla | Tıkla → %100 hızı (XY/Z mm/dk) ayarla. FluidNC'de kaydırıcı artık çalışıyor |
| Plasma On/Off | Tool menüsü | `M3 S1000` / `M3 S0` |
| Hazır makrolar | Macros sekmesi | Torç Testi, Yoklama Testi, Z Sıfırla (IHS), Torcu Kaldır, Sıfıra Git |

### CAM (çizim tarafı)
| Özellik | Nerede | Not |
|---|---|---|
| CONTROL'e Gönder | 4. Export G-code | G-code CONTROL'e yüklenir (çalıştırmaz) |
| Sıfır Noktası | Project şeridi → Plazma Yerleşim | 9 noktadan referans seç, hedef X/Y'ye taşı |
| Aynala X / Aynala Y | Plazma Yerleşim | Seçili parça yoksa tüm iş |
| Torca Hizala | Plazma Yerleşim | Referans noktasını torcun şu anki konumuna taşır (CONTROL bağlı olmalı) |
| Torç kapama komutu | Settings → Advanced | Varsayılan `M3 S0` |
| IHS dizisi | Settings → Advanced | `G91 / G38.2 Z-50 F300 / G90 / G10 L20 P1 Z-3` (anahtar boşluğu 3 mm) |
| Lead-in tipi: Yay | Settings → Advanced | Varsayılan **Yay** (kalite varsayılanları, bindirme 1 mm). Yay seçilince: kontura teğet giriş; CAM'in lead-in koyamadığı konturlara da hurda tarafında lead-in eklenir |
| Kontur sonu bindirme | Settings → Advanced | mm, 0 = kapalı (öneri 1–2 mm) |
| Küçük delik yavaşlatma | Settings → Advanced | Sınır (mm) ve hız (%). 0 = kapalı (öneri: malzeme kalınlığının ~2.5 katı, %60) |
| Kesim yönü | Settings → Advanced → Plasma: Kesim Yönü | Varsayılan **Standart**: dış konturlar saat yönünde, delikler saat tersine (iyi kenar hareket yönünün sağında kalır). Ters girdaplı sarf için **Ters** |
| Başlangıç noktası | Settings → Advanced → Plasma: Başlangıç Noktası | Yay lead-in açıkken delme parçanın dış köşesine, yoksa en uzun düz kenarın ortasına alınır; eğride / iç köşede giriş izi kalmaz |
| Önce delikler | Settings → Advanced → Plasma: Önce Delikler | Aynı toolpath içinde en içteki konturlar önce, aynı seviyede en yakın kontur. Delik toolpath'i dış toolpath'ten sonraysa CAM ve CONTROL uyarır |
| Otomatik küçük delik | Malzeme seçiliyse | Küçük delik sınırı girilmemişse çapı < 2,5 × sac kalınlığı olan delikler yavaş kesilir |

| Malzeme kütüphanesi | Şerit → Kesim Tablosu → **Malzemeler**; toolpath penceresinde **Plazma: Malzeme** | Malzeme/kalınlık seçilince kerf, hız, delme yüksekliği, delme bekleme, kesim yüksekliği ve lead-in dolar. Akım ve hava G-code'a not olarak yazılır, CONTROL çalıştırmadan önce gösterir. Tablo değişince o malzemeyi kullanan toolpath'ler güncellenir. Örnek değerler 60 A hava plazması içindir (1–15 mm siyah sac, paslanmaz, alüminyum). Kendi torç/sarf tablonuza göre düzeltin. Daha önce tabloyu kaydettiyseniz yeni örnekler için **Örnek tabloyu yükle** |
| Mikro bağlantı (köprü) | Toolpath penceresi → **Plazma: Mikro bağlantı** (adet, mm) | Dış konturlarda parçayı sacta tutan kesilmemiş köprüler (ızgaralı tabla için). Köprüde torç söner, delme yüksekliğine kalkar, köprü sonunda yeniden deler. Köprüler köşelerden düz kenarlara kaydırılır. Delikler (iç kesim) etkilenmez. 0 = kapalı |

Yerleşim araçlarından sonra toolpath'ler ve G-code kendiliğinden yeniden hesaplanır. Hepsi **Undo** ile geri alınabilir.

> Delikleri her zaman ayrı bir **Plasma: Vector (path inside)** toolpath'ine alın: dış (outside) işlem iç içe konturları da dışa ofsetler, delikler kerf kadar büyük çıkar (CAM uyarır).

### CAM — Çizim ve düzenleme
| Özellik | Nerede | Not |
|---|---|---|
| Çizim araçları | Sol dikey çubuk (turuncu simgeler) | Çizgi/çoklu çizgi, dikdörtgen (köşe yarıçaplı), daire, yay (3 nokta), çokgen, kanal |
| Yakalama (snap) | Araç panelinin altı | Çizgi uçları/köşeler (yeşil), şekil merkezleri (mavi), ilk nokta (sarı, kapatır), ızgara (mm). Shift: 45° kilit |
| Ölçüyle çizim | Araç paneli | Sayı yazmaya başlayınca ilgili alana geçer; Tab: sonraki alan, Enter: uygula. Çizgide uzunluk+açı veya X/Y |
| Kırp (Trim) | Sol çubuk, makas simgesi | Silinecek parçanın üzerine gel (kırmızı görünür), tıkla. Diğer tüm çizgiler kesme kenarıdır; açık çizgi ortadan kırpılırsa ikiye ayrılır, kapalı kontur açılır, hiç kesişmeyen çizgi silinir. Sonra **Birleştir** ile tek kapalı kontur yapılır |
| Düğüm düzenle | Sol çubuk, son simge | Çizgiye tıkla, noktayı sürükle, Shift+tık nokta ekle, Del sil, kenar uzunluğu/açısı sayıyla, böl/aç |
| Kopyala, Dizi, Dairesel dizi | Şerit → Plazma Düzenle | Seçili çizgilerle çalışır. Dizi: parçalar arası boşlukla satır×sütun |
| Köşe yuvarlat, Birleştir, Ofset | Şerit → Plazma Düzenle | Birleştir: uçları değen açık çizgileri tek (kapalı) kontura çevirir |
| Özellikler (parametrik) | Şerit → Plazma Düzenle → Özellikler | Programda çizilen şekillerin ölçüleri (en/boy/R, çap, kenar sayısı...) sonradan değiştirilebilir; toolpath ve G-code kendiliğinden güncellenir |

Esc: yarım şekli iptal / aracı kapat. Sağ tık sürükle: kaydır, tekerlek: yakınlaştır. Tüm işlemler Undo (Ctrl+Z) ile geri alınır.

### CAM — Nesting (sac yerleşimi)
Şerit → **Nesting** (veya parçaları seçip **Parça Ekle**).
1. **Parçalar:** CAM'de seçili (yoksa tüm) kapalı konturlar parçaya dönüşür; iç içe konturlar delik sayılır. Her parçaya adet girilir.
2. **Saclar:** Standart sac (varsayılan 3000 × 1500) + artık saclar (dikdörtgen veya CAM'de çizilmiş kontur, ör. L şekli). Artıklar önce kullanılır, standart sac gerektiği kadar çoğalır.
3. **Ayarlar:** parça arası boşluk, sac kenar payı, döndürme (serbest 15° / ince 5° / 90° / yok), delik içine parça, hassasiyet, iyileştirme süresi. Gerçek boşluk istenenden küçük olmaz.
4. **Sonuç:** her sac bir sekme (doluluk %, durum: Kesilecek / Kesildi / Hariç). Sac üzerinde **Parça dışla** (kesilmeyecekler) ve **Sırayı elle belirle**.
5. **✂ Bu sacı kes:** sadece o sac çalışma alanına gelir; delik ve dış kontur toolpath'leri otomatik oluşur (son kullanılan plazma ayarlarıyla; değiştirmek için toolpath "Edit"), G-code hazırlanır → **CONTROL'e Gönder**. Üstteki çubuktan **Çizimlere dön**.
6. **Kesim sırası:** varsayılan parça parça (önce delikler, sonra dış kontur, en yakın parçaya geç). Bir parçanın deliğine yerleşmiş parça **her zaman önce** kesilir (yoksa hurdayla birlikte düşer). G-code'da her parçanın başında `; ---- Parça N ----` notu vardır.
7. **Kalanı artık olarak kaydet:** sacın kullanılmayan sağ tarafı artık sac listesine eklenir.

Sacın sol alt köşesi makinede iş sıfırı (0,0) olmalıdır. Artık saclarda da artığın sol alt köşesi sıfır alınır.

### CONTROL — Sac hizalama ve artık sac tanıtma
| Özellik | Nerede | Not |
|---|---|---|
| Sac Hizala | Machine Control → Plazma grubu | 1) Torcu sacın sol alt köşesine getir → **Köşe burası** (iş sıfırı X0 Y0 buraya ayarlanır). 2) Torcu alt kenar boyunca uzak bir noktaya (≥500 mm) getir → **Kenar noktası burası**. Eğiklik açısı hesaplanır → **Uygula**. Düğmenin altında aktif açı görünür |
| Hizalamanın etkisi | Çalıştır, Kuru Çalıştır, Çerçeve Gez | G-code iş sıfırı etrafında bu açıyla döndürülerek gönderilir (3B görünüm döndürülmemiş hâlini gösterir). Prob sihirbazları döndürülmez. Önce Çerçeve Gez ile kontrol edin |
| Artık Tanıt | Machine Control → Plazma grubu | Torcu artığın köşelerinde sırayla gezdir, her köşede **Nokta ekle**. İlk nokta artığın iş sıfırıdır. **Bitir** → şekil CAM Nesting'te artık saclar listesine kendiliğinden gelir |
| Tanıtılmış artıkla kesim | Çalıştır | Bu işlerde hizalama uygulanmaz (şekil zaten gerçek konumunu taşır). Çalıştır'a basınca iş sıfırının artığın ilk köşesine ayarlanıp ayarlanmayacağı sorulur |

Paneller açıkken jog kullanılabilir (pencere değil, yüzen panel).

### CONTROL — İş öncesi kontrol ve kaldığı yerden devam
| Özellik | Nerede | Not |
|---|---|---|
| İş öncesi kontrol | **Çalıştır**'a basınca kendiliğinden | Hata: torç sonda açık kalıyor, torç açıkken G0, hızsız (F) kesim. Uyarı: torç hiç açılmıyor, IHS bazı delmelerde eksik, kesim iş sıfırının solunda/altında, nesting sacının dışına taşma, makine sınırı (30/31) aşımı, 10'dan hızlı kesim. Ayrıca malzeme ayarları (akım/hava), delme sayısı, kesim uzunluğu ve tahmini süre. Hata varsa "Hataları gördüm" işaretlenmeden çalışmaz |
| Kaldığı Yerden | Machine Control → Plazma grubu | Ark söndüyse / iş durduysa: torcun konumuna en yakın nokta (2 mm geriden) seçili gelir. Kontur ve konum kaydırıcıyla değiştirilir, 3B görünümde turuncu/kırmızı gösterilir. **Başı**: konturu IHS ve delmeyle baştan keser. Ortadan: torç noktaya gider, IHS + delme yapar, kalanı keser. Yaylarda yayın başından devam edilir. İş öncesi kontrol ve sac hizalamadan geçerek gönderilir |

## Makinede ilk test sırası (torç kapalı → açık)

1. Bağlan, `$H` / home, iş sıfırını ayarla.
2. **Yoklama Testi** makrosu: torç iner, metale değince durup 10 mm kalkmalı. Durmazsa hemen E-STOP: probe girişi ayarlı değil.
3. **Z Sıfırla (IHS)** → Z ekranı yaklaşık +10 göstermeli (3 mm anahtar boşluğu doğruysa).
4. CAM'de küçük bir test parçası → Generate → **CONTROL'e Gönder**.
5. **Çerçeve Gez**: torç parçanın dışını güvenli Z'de dolaşmalı (sac sınırları içinde mi?).
6. **Kuru Çalıştır**: tüm yol torç yanmadan gezilmeli.
7. **Torç Testi** makrosu (hurda sac üzerinde): 0.5 sn ark.
8. Gerçek kesim.
9. **Kaldığı Yerden** denemesi: kesimi ortada durdurun (torç kapanır), Kaldığı Yerden → önerilen noktayı kontrol edin → devam.

## Bilinen sınırlar / yapılmayanlar
- THC (kesim sırasında yükseklik takibi) yok, FluidNC donanımı gerektirir.
- İnternetsiz Yazı aracı (Google Fonts bağımlılığı) yapılmadı.
- Yay lead-in ve küçük delik ayarları makinede henüz denenmedi; G-code'u satır satır kontrol edin.
