# Deskody doğrulama — 0.1.6 / 2026-09-07

- Uygulama/pencere/tray/izin/OAuth/HTML başlıkları Deskody; eklenti ve eşleştirme sayfası Deskody Bridge olarak güncellendi. Rust/npm paket ve executable adları deskody. Kural dışa aktarma adı deskody-rules.json.
- Sol alt sürüm etiketi package.json sürümünü okuyor. Playwright, HTML başlığını Deskody, sidebar markasını Deskody ve etiketi v0.1.6 olarak doğruladı; ekran görüntüsü gözle incelendi.
- 36 Rust, 7 Vitest ve 8 Playwright arayüz testi başarılı. macOS Clippy tüm target’lar için -D warnings ve üretim frontend/release derlemeleri başarılı.
- Masaüstü paketleri ve Chromium/Firefox eklenti manifestleri 0.1.6 olarak eşleşiyor. Eklenti paketlerindeki JS dosyaları kaynakla byte eşit. Medya content script/protokolü değiştirilmedi; önceki medya kabul testlerinin sonuçları önceki kayıtlardadır.
- Deskody.app ve Deskody_0.1.6_aarch64.dmg üretildi; codesign strict doğrulaması ve hdiutil checksum kontrolü geçti. Yeni binary adı deskody ve mevcut OS bundle kimliği doğrulandı.
- /Applications/Deskody.app kuruldu ve açıldı; tek örnek çalışıyor. Eski /Applications/Music Optimizer.app yedeklendi, o adla ikinci kurulum bırakılmadı. Ayar/eşleştirme dosyalarının kurulum öncesi/sonrası hash’leri aynı.
- Yedek: .tools/installed-backups/20260907-090144/. Bundle/ayar/keyring/Firefox kimlikleri uyumluluk için korunuyor; eski önizleme verisi okunabiliyor.
- Kurulu tarayıcı uzantısındaki yeni adın görünmesi için kullanıcı mevcut uzantıyı Reload ile yeniden yüklemeli. Eşleştirme anahtarı değişmedi; açık YTM sayfasının content script olay adları uyumlu kaldı.
- Windows/Linux yerel paketleri bu isim değişikliği sırasında çalıştırılmadı; CI paket ve artifact adları Deskody olarak güncellendi.

DMG: `src-tauri/target/release/bundle/dmg/Deskody_0.1.6_aarch64.dmg`

SHA-256: `e2dc7850e10ea7c13fab92e9f1b6fe7a6015d4524a08942b74c64da184122782`

---

# Önceki doğrulama — 0.1.5 / 2026-09-06

- Bu Mac üzerinde gerçek katalog taraması 110 uygulama buldu. Visual Studio Code (`com.microsoft.VSCode`), Preview (`com.apple.Preview`), Microsoft Word ve Excel kimlikleri doğrulandı. Tekrarlanabilir kontrol: `cargo run --no-default-features --example list_applications` (src-tauri manifesti).
- Rust: 36 test; TypeScript/Vitest: 7 test; Playwright arayüz: 8 test başarılı. Yeni testler çoklu uygulamanın OR eşleşmesini, kesici önceliğini, eski ayarların roundtrip’ini, boş/yinelenen/geçersiz seçim reddini, binary plist okumasını ve Linux desktop entry ayrıştırmasını kapsıyor.
- Arayüzde arama → VS Code + Preview seçimi → playlist ile kayıt → yeniden açma → katalog mevcut değilken seçili uygulamayı koruma → birini kaldırıp yeniden kayıt doğrulandı. UI kataloğu açıkça IPC fixture’ı; gerçek 110 uygulamalı katalog ayrıca Rust üzerinden okundu.
- React/TypeScript üretim derlemesi, macOS tüm target’lar için Clippy (`-D warnings`) ve biçimlendirme başarılı.
- Windows x86_64 GNU ve Linux x86_64 GNU çekirdek/adaptör çapraz derleme kontrolleri başarılı. Proje içindeki Rust sysroot ve Zig cache kullanıldı. Bu kontroller Windows PowerShell kataloğunu veya Linux compositor’ını fiziksel cihazda çalıştırmaz.
- macOS ARM64 .app/.dmg üretildi; imza ve disk görüntüsü checksum kontrolleri başarılı. `/Applications/Music Optimizer.app` 0.1.5 olarak açıldı, tek çalışan örnek doğrulandı. Ayarlar ve eşleştirme dosyaları kurulum öncesi/sonrası hash karşılaştırmasında değişmedi.
- Önceki uygulama: `.tools/installed-backups/20260906-234647/Music Optimizer.app`.
- Tarayıcı eklentisi 0.1.4 olarak korundu. Bu sürüm medya geçiş protokolünü değiştirmez; önceki eklenti/ses testleri aşağıdaki 0.1.4 kaydına aittir.

DMG: `src-tauri/target/release/bundle/dmg/Music Optimizer_0.1.5_aarch64.dmg`

SHA-256: `e10ce5b11376b426991bfb61925575d07fbf9cfd885848d90a3ddb97afba963d`

---

# Önceki doğrulama — 0.1.4 / 2026-09-06

- Rust: 32 test; TypeScript/Vitest: 6 test; Playwright: 7 arayüz ve 1 kapsamlı eklenti testi başarılı. Arayüz ve son eklenti doğrulaması ayrı koşularda tamamlandı.
- macOS tüm target'lar için Clippy (`-D warnings`), Rustfmt ve değiştirilmiş JS/TS dosyalarının Prettier biçimlendirmesi başarılı.
- macOS ARM64 `.app` ve `.dmg` üretildi; `codesign --verify --deep --strict` ve `hdiutil verify` başarılı.
- `/Applications/Music Optimizer.app` 0.1.4 olarak güncellendi ve tek çalışan örnek doğrulandı. Ayarlar/eşleştirme dosyaları kurulum ve açılış öncesi/sonrası SHA-256 karşılaştırmasında değişmedi. Eski uygulama `.tools/installed-backups/20260906-230913/Music Optimizer.app` altında.
- Chromium ve Firefox paketleri 0.1.4; paket script'lerinin kaynakla byte eşitliği doğrulandı. Çalışan Chrome eklentisi otomatik yeniden yüklenmedi; kullanıcı **Reload** ve açık YouTube Music/PWA için bir yenileme yapmalı.

## Ses ve zaman aşımı regresyonu

Gerçek Chromium eklentisi, loopback HTTP komutları ve yerel YTM SPA test sayfası kullanıldı. Test artık sıfır örnekli sessiz WAV yerine 440 Hz PCM içeriyor. Playwright'ın headless modda varsayılan `--mute-audio` bayrağı ilk ses çıkışı kontrolünü engelledi; yalnızca bu testte bayrak kaldırıldıktan sonra gerçek `tabs.audible === true` ve sekme `muted === false` doğrulandı.

- Kullanıcının watch+playlist bağlantısı, playlist kataloğu, radyo, mix ve tek şarkı; gerçek `transition/fadeMs/pause` komutlarıyla çalıştı.
- En az 16 saniye boyunca çalma, 0.2 ses seviyesi ve mute=false korundu; eski zaman aşımındaki gecikmiş pause olmadı.
- Adres çubuğundan `list` silinse ve `getVideoData()` hata verse bile `getPlayerResponse()` ile parça onaylandı.
- DOM'un ilk elemanı boş video olduğunda doğru oynatıcı kullanıldı; asıl medya elementi değiştiğinde ses geri yüklendi. Video kimliği API'si yokken yeni yükleme/element + URL video kimliği + ilerleyen currentTime ile onaylandı.
- Gerçekte çalan ancak parça kimliği doğrulanamayan senaryoda 11 saniyelik gözlem zaman aşımı görünür tanı hatası üretti; parça duraklatılmadı ve ses korundu.
- Açık fade-pause, kullanıcı mute ayarı, iptalde pause/restore, yinelenen komutta yeniden yönlendirmeme ve kötü host reddi geçti.
- SPA geçişlerinde belge kimliği/navigasyon sayısı sabit kaldı, diğer sekmenin odağı korundu, dialog oluşmadı. Elle reload pozitif kontrolü gerçek beforeunload dialog'u oluşturdu.
- Rust regresyon testi, uzaktaki tek geçiş işlemi başarılı veya hatalı bittiğinde ek volume/play/pause çağrısı olmadığını doğruladı. Yeni protokol alanları ve eski bağlamların geriye uyumlu okunması test edildi.

Bu doğrulama canlı YouTube Music hesabı, abonelik veya macOS PWA DOM'u üzerinde yapılmadı. Kullanıcının Chrome profilinde Apple Events üzerinden JavaScript yürütme kapalı; bu güvenlik ayarı değiştirilmedi. Eklenti MAIN-world köprüsü bu ayara ve macOS arayüz diline ihtiyaç duymaz. Windows/Linux yerel paketleri ve Firefox çalışma testi bu düzeltmede çalıştırılmadı.

DMG: `src-tauri/target/release/bundle/dmg/Music Optimizer_0.1.4_aarch64.dmg`

SHA-256: `5d6090f8dd50e7a11a94705312036c50d61e473f5efcce3abd3d9307d2ec29a7`

---

# Önceki sürümlerin doğrulama kayıtları — 0.1.2 / 2026-09-06

| Kontrol | Sonuç |
|---|---|
| React/TypeScript üretim derlemesi | Başarılı |
| TypeScript/Vitest | 6 test başarılı |
| Rust birim ve servis testleri | 30 test başarılı |
| Playwright kullanıcı akışları / gerçek Chromium eklentisi | 8 test başarılı (7 arayüz + 1 eklenti) |
| Rustfmt / Prettier | Başarılı |
| macOS tüm target'lar için Clippy (`-D warnings`) | Başarılı |
| Windows x86_64 GNU adaptörü, çapraz check/Clippy | Başarılı |
| Linux x86_64 GNU adaptörü, çapraz check/Clippy | Başarılı |
| macOS aarch64 release build | Başarılı |
| Ad-hoc imzalı `.app` açılışı | 0.1.2, `/Applications/Music Optimizer.app` üzerinden açıldı; tek çalışan örnek doğrulandı |
| Kapalı köprüye yetkisiz istek | HTTP 401 |
| Eşleştirme anahtarı dosya izni | 0600 |
| `codesign --verify --deep --strict` | Başarılı |
| `hdiutil verify` | DMG checksum geçerli |

Eklenti testi gerçek Chromium uzantısını yükler; temizlenmiş URL ve Bearer başlığını doğrular. Hesap gerektirmeyen, yerelde karşılanan music.youtube.com test sayfasındaki gerçek HTMLAudioElement üzerinde play, pause, volume ve komut onayını sınar. Gerçek YouTube Music servisiyle oturum açma testi değildir.

Çapraz kontroller `--no-default-features` ile Rust çekirdeğini ve işletim sistemi adaptörünü doğrular. Windows/Linux masaüstü webview, kurulum paketi ve fiziksel medya oturumları bu Mac üzerinde çalıştırılmadı. Üç işletim sistemi için yerel paketleme GitHub Actions yapılandırması eklendi; uzak workflow burada tetiklenmedi.

Spotify OAuth canlı hesap, Premium/Developer uygulama erişimi, macOS kullanıcı TCC onayı ve Firefox gerçek tarayıcı kabul testi kullanıcı ortamında tamamlanmalıdır. Paketler ad-hoc imzalıdır; Apple Developer ID ve notarization kullanılmadı.

## Üretilen dosyalar

### 0.1.10 Spotify şarkıları ve masaüstü odak koruması

- `/Applications/Deskody.app` 0.1.10 kuruldu; tek çalışan örnek ve ayar/eşleştirme dosyalarının değişmediği doğrulandı. Önceki uygulama `.tools/installed-backups/20260909-215234/` altında. Ad-hoc app imzası ve `hdiutil verify` başarılı. DMG SHA-256: `33d6d9d8791f6f3aa164838cd2fa3328060d39ae5ed34523fd3e5f3a13c1e8b4`.
- TypeScript/Vite build, 10 Vitest ve 40 Rust testi başarılı. Mac Clippy `--all-targets -- -D warnings` ve Windows x86_64 GNU **desktop feature açık tam çapraz cargo check** başarılı. Windows üzerinde çalıştırma/kurulum testi değildir.
- Playwright ana uygulama/tray: 13 başarılı. Kullanıcının tam Spotify `track` paylaşım URL’si arayüzden kaydedilip yeniden açılarak doğrulandı; mevcut playlist ve YouTube Music testleri de geçti.
- `python3 scripts/test-native-spotify.py --live spotify:track:4LhgwcTWwJQc6DFTkLXVEc`: odak korumasının sınırları ve gözlemci temizliği, ardından gerçek Spotify masaüstünde normal ve başka sürecin gerçek tam ekran penceresiyle başarılı. Her iki canlı testte doğru track ID/playing=true, özgün ön uygulama ve Space korundu; kullanıcı tıklaması/üçüncü uygulama aktivasyonu yoktu. Bildirimler arasındaki en uzun Spotify ön-plan aralığı 3,5/3,7 ms idi. Bu ekran animasyonu süresi değildir ve sıfır görsel geçiş garantisi vermez.
- Canlı test Premium/Web API/Spotify Web kullanmadı. Başlangıçta duraklatılmış olan oynatıcı tekrar duraklatıldı. Eklenti kodu değiştirilmedi. [Araştırma ve üretim sınırları](SPOTIFY.md).

### 0.1.9 macOS sistem menüsü

- `/Applications/Deskody.app` 0.1.9 olarak kuruldu ve tek çalışan örnek doğrulandı. Ayar/eşleştirme dosyalarının hash’leri değişmedi. Önceki uygulama `.tools/installed-backups/20260907-143643/` altında. App imzası ve `hdiutil verify` başarılı; `Deskody_0.1.9_aarch64.dmg` SHA-256: `b61f2a483538fd45d10a46adfda6a2b2f10e2a31c4677a161be7be978079645b`.
- Windows `x86_64-pc-windows-gnu` için **varsayılan desktop feature açıkken tam `cargo check --offline` başarılı**: Tauri/WebView2/tray ve yeni koşullu panel oluşturma yolu dahil. Bu makinedeki yerel Rust sysroot, Zig C araçları ve gerçek x86_64 COFF üreten Zig RC komut adaptörü kullanıldı; kaynak derleme adımı atlanmadı. Windows üzerinde çalıştırma, `.exe` linkleme/kurulum ve fiziksel tray/medya davranışı bu kontrolde test edilmedi; mevcut Windows CI yapılandırması burada tetiklenmedi.
- `python3 scripts/test-native-menu.py`: gerçek NSStatusItem/NSMenu, normal Space ve başka sürecin gerçek tam ekran Space’inde başarılı. Menü penceresinin görünürlüğü/aktif Space’i, sistem menü çubuğu görünürlüğü, status simgesinin native highlight durumu, dış uygulamanın frontmost kalması ve test sonunda hâlâ tam ekranda kalması doğrulandı.
- Gerçek NSSwitch/NSButton `performClick` ile akış kapatma, kural kapatma, pause, async worker sonucu menü tracking loop’u içindeyken UI güncellenmesi, başarısız kayıtta anahtarın geri alınması/hata gösterimi ve Escape ile kapanma doğrulandı. Bu testte servis callback’i kontrollü fixture’dır; Rust worker’ın kalıcı kayıt davranışı 38 çekirdek testiyle ayrıca doğrulanır.
- `npm run check`: TypeScript/Vite + 8 Vitest başarılı. macOS Clippy ve Objective-C derleme kontrolü başarılı. Test ekran görüntüleri `/tmp/deskody-native-menu.png` ve `/tmp/deskody-native-menu-fullscreen.png`: NSView cache görüntüsü metin/kontrol yerleşimini gösterir; WindowServer’ın cam arka plan kompozitini içermez. Cam, sistem renkleri ve saydamlık macOS’un gerçek NSMenu görünümüne bırakılır.
- Kullanıcının Bluetooth/Control Center modülünün özel implementation’ı kopyalanmaz; public NSMenu/NSSwitch/SF Symbols kullanılır. Bu Mac’te native menü davranışı test edildi; tüm eski macOS sürümleri ve fiziksel çok monitör düzenleri ayrıca çalıştırılmadı.

### 0.1.8 yerel macOS paneli

- `/Applications/Deskody.app` 0.1.8 olarak kuruldu, tek çalışan örnek doğrulandı. Önceki paket `.tools/installed-backups/20260907-141053/` altında. Ayar/eşleştirme dosyalarının hash’leri değişmedi. App imzası ve DMG checksum doğrulaması başarılı; DMG SHA-256: `ca4df441cb454dbd59c75ee9372a1b929e3665e8b82a44a2262a07526645a761`.
- Ortam: macOS 26.6.2 (25G83), Apple Silicon. `python3 scripts/test-native-panel.py` gerçek AppKit/NSPanel/WKWebView ile hem mevcut Space’te hem **ayrı bir sürecin gerçek tam ekran Space’inde** başarılı. Testler Accessibility izni istemeden kendi pencerelerini kullanır.
- Doğrulananlar: gerçek nonactivating NSPanel; fullScreenAuxiliary ve macOS 13+ canJoinAllApplications; panelin aktif Space’te görünmesi; arka uygulamanın frontmost kalması; dış uygulamanın test sonunda hâlâ tam ekranda ve aktif Space’te olması; kaynak pencerenin gizli kalması; WebKit’in görünür/odaklı kalması ve önceden kayıtlı script-message IPC handler’ının çalışması; Escape, ekran/Space bildirimiyle kapanma; monitor temizliği ve aç/kapat debounce; kapatmada webview’ın kaynak pencereye geri alınması.
- `npm run check`: TypeScript/Vite + 8 Vitest başarılı. Rust: 38 test başarılı. Ana pencere/panel Playwright: 12 başarılı. Clippy `--all-targets -- -D warnings` başarılı. Objective-C macOS 12 deployment target ile `-Wall -Wextra -Werror` derleme kontrolü başarılı.
- UI testindeki tam ekran host, VS Code yerine kontrollü bir AppKit test uygulamasıdır; kullanıcı hesabına veya müziğine müdahale etmez. WebKit handler testi native host entegrasyonunu, Playwright taklit IPC testi React komutlarını doğrular. Fiziksel çok monitör ve Stage Manager yerleşimi, macOS 12/13 üzerinde çalışma ve Windows/Linux masaüstü bu ortamda ayrıca çalıştırılmadı. Sürüm uyumluluğu Apple’ın belgelenmiş API’leri ve runtime sürüm kontrolüyle sağlanır; bütün macOS konfigürasyonlarında yüzde yüz test edilmişlik iddiası yoktur.

### 0.1.7 hızlı kontrol paneli

- `npm run check`: TypeScript/Vite build ve 8 Vitest testi başarılı.
- Rust çekirdek/worker testleri: 38 başarılı. Yeni testler aynı anda gelen hızlı değişikliklerin birbiriyle ayar kaybetmemesini, silinen kural kimliğinin reddini, atomik kalıcı kaydı, panelde son dış bağlamın korunmasını, ilgisiz kural anahtarında playlist’in yeniden başlamamasını ve elle duraklatmanın korunmasını kapsar.
- Playwright ana uygulama + panel: 12 başarılı. Panel testleri açıkça taklit edilmiş Tauri IPC üzerinde anahtar payload’larını, başarısız kayıtta durumun korunmasını, oynat/duraklat/otomasyona dön komutlarını, ayrı aç düğmesini, Escape’i, gelen status eşzamanlamasını ve 100 kurallı dar pencerenin kaydırmasını doğrular. Ekran görüntüsü: `test-results/tray-panel.png`.
- macOS desktop bütün hedefler Clippy (`-D warnings`) başarılı; aarch64 `.app` ve `.dmg` üretildi. Eklenti bu sürümde değişmedi; medya servisine karşı canlı çalma testi yapılmadı.
- `/Applications/Deskody.app` 0.1.7 olarak güncellendi ve tek çalışan örnek doğrulandı. Önceki paket `.tools/installed-backups/20260907-113719/` altına yedeklendi. Kurallar ve eşleştirme dosyalarının içerik hash’leri kurulum öncesi/sonrası aynı. `codesign --verify --deep --strict` ve `hdiutil verify` başarılı. DMG SHA-256: `e7c0a6d76abfffd3987cd30a92e59c95e1b71a2bd1818776de8b62605656c08e`.
- Gerçek macOS tray tıklaması/blur ve çok monitör/tam ekran davranışı otomatik doğrulanamadı: kontrol sürecinde `AXIsProcessTrusted()` false. Windows/Linux native popup testleri bu Mac üzerinde çalıştırılmadı. Web testleri gerçek işletim sistemi odağı testinin yerine geçmez.

- `src-tauri/target/release/bundle/macos/Deskody.app` — 0.1.8
- `src-tauri/target/release/bundle/dmg/Deskody_0.1.8_aarch64.dmg`
- `dist-extensions/chromium/` ve `dist-extensions/firefox/`

## 0.1.1 kural düzeltmesi

- Bu Mac'teki gerçek uygulama `Code` / `com.microsoft.VSCode` olarak doğrulandı. Bu adlar artık `Visual Studio Code` koşuluyla eşleşiyor; aynı anda eşleşen Linux `code` çalma kuralı, VS Code duraklatma kuralını geçemiyor.
- Çalışan worker, gerçek ayar deposu ve komut kuyruğu üzerinden yapılan testlerde seçili oynatıcıya pause/play/liste komutlarının ulaştığı doğrulandı. Yerel oynatıcı bu testlerde kayıt tutan bir test adaptörüdür; canlı Spotify hesabında müzik çalınmadı.
- Servis testleri: VS Code pause → Terminal play → video pause; listeyi her taramada yeniden açmama; kuralı kaydedince yeniden başlatmadan uygulama; PDF kuralında YouTube Music oynatıcısı yeniden bağlanınca hata durumundan çıkma.
- Playwright: Kuralı uygula ile doğrudan kalıcı kayıt, kalıcı silme, başka kaynakta Spotify alanına yazma, başarısız kayıtta formun korunması.
- Eklenti testi geçici kopyada rastgele yerel port kullanır; çalışan kullanıcının 43827 portundaki köprüsünü etkilemez. Üretim eklentisinin adresi değişmedi; yeniden kurmak gerekmez.
- Yerinde güncellemede eski uygulama `.tools/installed-backups/20260905-235115/` altına taşındı; ayar ve eşleştirme dosyalarının byte içeriğinin değişmediği doğrulandı.
- Windows/Linux çapraz adaptör kontrolleri önceki 0.1.0 temel sürümüne aittir; bu düzeltmedeki ortak motor/servis değişiklikleri macOS üzerinde doğrulandı.

## 0.1.2 YouTube Music hedef desteği

- Kullanıcının tam `watch?v=LkoXilp7FPY&list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg` bağlantısı Rust, frontend, kural kaydı ve gerçek Chromium eklentisi testlerinde kullanıldı.
- Şarkı, playlist sayfası, şarkı+playlist, radyo (`start_radio=1`) ve mix hedeflerinde navigasyon ve oynatma onayı doğrulandı. Liste sayfasından ilk şarkıya geçiş, tekrar gönderilen komutta kuyruğu başa sarmama, başka sekmenin odağını koruma ve ses düzeyini koruma da sınandı.
- Kötü niyetli host'a navigasyon reddi; açılış sürerken komut iptalinde pause ve sekme mute durumunun geri alınması doğrulandı.
- Playwright gerçek Chromium/content script ve HTMLAudioElement kullanır; YouTube Music yanıtı yerel fixture'dır. Canlı oturumdaki YouTube Music DOM'u, kişisel mix sırası, özel liste erişimi ve hesap/abonelik davranışları burada doğrulanmadı.
- Uygulama ve Chromium/Firefox eklenti klasörleri 0.1.2'ye güncellendi. Kurulu eklentinin tarayıcıdan yeniden yüklenmesi ve YouTube Music sayfasının yenilenmesi gerekir. Kullanıcı ayarları ve eşleştirme dosyaları korunarak `/Applications` sürümü güncellendi.

DMG SHA-256:

```text
ccf6c149353b42c655f4189994e2441ef39dcfb4c96e44e32298325d6898740d
```

## Eklenti 0.1.3 — “Leave app?” ve odak regresyonu

Masaüstü 0.1.2 ile uyumlu, yalnızca eklenti düzeltmesi. Chromium/Firefox paketleri 0.1.3 olarak üretildi ve kaynakla byte eşitliği doğrulandı. Güncel manifestin MAIN-world `music-page.js` girdisi kontrol edildi.

Gerçek Chromium uzantısı + yerel SPA fixture testinde şarkı/liste/radyo/mix geçişleri sırasında HTTP belge navigasyonu sayısı artmadı, belge kimliği sabit kaldı, `beforeunload` sayacı sıfır ve dialog listesi boş kaldı. Odak diğer sekmede korundu. Tekrarlanan komutlar SPA yönlendirmesini yeniden başlatmadı. Yönlendirici bulunamadığında hata oluştu; tam sayfa navigasyonu yapılmadı. İptal sırasında duraklatma ve mute durumunu geri yükleme kontrolü geçti.

Pozitif kontrol olarak aynı fixture üzerinde en sonda elle reload denendiğinde gerçek Chromium `beforeunload` dialog'u oluştu ve test tarafından iptal edildi. Böylece uyarının test ortamında bastırılmadığı da doğrulandı. Test: `playwright test tests/extension.spec.ts` — başarılı.

Bu test canlı YouTube Music hesabı veya macOS PWA penceresi üzerinde yapılmadı. Önceki Rust/UI test sonuçları masaüstü 0.1.2 temel sürümüne aittir. Eklenti yeniden yüklendikten sonra açık YouTube Music sayfası bir kez yenilenmelidir; yeni MAIN-world köprüsü bu sırada yüklenir.
