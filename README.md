# Deskody

Tauri v2 + Rust + React/TypeScript ile geliştirilmiş, macOS öncelikli menü çubuğu uygulaması. Aktif uygulama, dosya ve tarayıcı bağlamından müzik kuralları üretir. Pencereyi kapatmak uygulamayı gizler; menü çubuğundaki **Çıkış** tamamen kapatır.

## Çalıştırma

Gerekenler: Node.js 22+, Rust 1.91+, işletim sisteminiz için [Tauri önkoşulları](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run desktop
```

Yalnızca arayüzü görmek için `npm run dev`. Web önizlemesi müzik kontrol etmez; taslak kuralları kendi `localStorage` alanına kaydeder.

`scripts/run.mjs`, standart Rust kurulumunu PATH'te bulur. macOS'ta kurulu Command Line Tools'u kullanır; açıkça verilen `DEVELOPER_DIR` değerine dokunmaz. Projede `.tools/cargo` önbelleği varsa kullanır; temiz kurulumlarda normal Cargo önbelleği geçerlidir.

## İlk kullanım

1. Spotify masaüstü uygulamasını açıp bir parça seçin.
2. **Ayarlar → Sistem izinleri** bölümünden macOS Erişilebilirlik iznini verin. Spotify/tarayıcı erişiminde macOS Automation onayını tamamlayın. İzin değişince **Yenile** düğmesini kullanın. macOS bazen uygulamanın yeniden açılmasını ister.
3. **Kurallarım** bölümünde uygulama veya dosya bağlamını, eylemi ve isteğe bağlı müzik bağlantısını seçin. **Kuralı uygula** doğrudan kaydeder ve çalışan motora iletir. Kural anahtarları ve silme işlemi de doğrudan kaydedilir. Genel ayarlar ve içe aktarma için **Değişiklikleri kaydet** kullanılır.
4. **Genel bakış** ekranındaki otomasyonu açın. Varsayılan olarak kapalıdır.

Boş liste alanı mevcut müziği devam ettirir. PDF, VS Code, Terminal, Xcode ve Windows Terminal kuralları hazır gelir; kendi listelerinizi eşleştirin. Kural uygulama alanında yerel uygulama adı veya tam uygulama kimliği kullanabilirsiniz.

macOS'taki `Code` / `com.microsoft.VSCode`, Windows'taki `Code.exe` ve Linux'taki `code`, `Visual Studio Code` koşuluyla eşleşir. **Kural durumu** alanı son çalışma uygulamasını, kimliğini, dosya/sekme bilgisini, kontrol edilen oynatıcıyı ve son kural olayını gösterir. Düzenleyicide **Son algılanan uygulamayı kullan** ile kesin uygulama kimliğini alabilirsiniz. Bu tanılama verileri yalnızca bellekte tutulur.

**Müzik bağlantısı** alanı Spotify şarkı/liste/albüm ve YouTube Music şarkı/liste/radyo/mix bağlantılarını kabul eder. **Diğer oynatıcılar** listesinden Spotify seçilirse de Spotify liste komutları uygulanır; YouTube Music veya Apple Music seçiliyken Spotify bağlantıları korunur ve mevcut müzik kontrol edilir. Otomasyon yalnızca seçili oynatıcıya komut verir; Spotify kapalıyken açık YouTube Music'e kendiliğinden geçmez.

## Platform yetenekleri

| Yetenek                | macOS                                    | Windows                             | Linux                                    |
| ---------------------- | ---------------------------------------- | ----------------------------------- | ---------------------------------------- |
| Aktif uygulama/pencere | NSWorkspace + AX                         | Win32 + UIAutomation                | X11/EWMH, Sway, Hyprland                 |
| Tarayıcı URL'si        | Safari/Chromium JXA; eklenti alternatifi | UIAutomation; eklenti alternatifi   | Eklenti                                  |
| Spotify play/pause     | AppleScript/JXA                          | GSMTC                               | MPRIS                                    |
| Spotify liste başlatma | Spotify’ın yerel CLI aracı veya Web API | **Web API gerekir**                 | MPRIS OpenUri desteklenirse veya Web API |
| Diğer oynatıcılar      | Apple Music; eklentili YouTube Music     | Seçili GSMTC oturumu; eklentili YTM | Seçili MPRIS oturumu; eklentili YTM      |
| Ses geçişleri          | Spotify/Apple Music ses seviyesi         | Spotify WASAPI oturumu              | MPRIS Volume desteklenirse               |
| Diğer medya algılama   | macOS 14.2+ CoreAudio çıkış süreçleri    | WASAPI peak meter + GSMTC           | MPRIS oynatma durumu                     |
| Manuel medya tuşu      | CGEvent sistem medya olayı               | SendInput                           | X11 XTest; Wayland'da kısıtlı            |

Tarayıcı eklentisi tüm platformlarda diğer sekmelerin `audible` durumunu ve YouTube Music oynatıcısını okuyabilir. Genel medya tuşu **yalnızca açık kullanıcı komutuyla** gönderilir: hedefi ve oynatma durumu belirsiz olan bir toggle, otonom pause yerine kullanılmaz.

### Gerçek platform sınırları

- Genel Wayland standardı, tüm uygulamalar için aktif pencere/URL okumaya izin vermez. Sway/Hyprland adaptörleri var; GNOME/KDE Wayland'da uygulama kuralları desteklenmez. Eklentiyle odaktaki tarayıcı kuralları kullanılabilir. XWayland verisi, tüm Wayland pencerelerini temsil ediyormuş gibi kullanılmaz.
- macOS 12–14.1'de genel CoreAudio süreç algılaması yoktur. macOS 14.2+ için `IsRunningOutput`, gerçek duyulabilirlik garantisi değildir; sessiz fakat açık akışları da sayabilir. Ses örnekleri kaydedilmez.
- Linux'ta MPRIS dışındaki ham sistem sesi ölçülmez. Windows WASAPI kontrolü varsayılan multimedya çıkışını tarar; farklı çıkış cihazları üzerinden çalan MPRIS/GSMTC dışı sesler kaçabilir.
- Eklentili YTM seçildiğinde yerel tarayıcı ses oturumları kendini kesmemesi için dışlanır; tarayıcı içi diğer ses için eklenti kullanılır. Aynı anda tek eşleştirilmiş tarayıcı profili desteklenir. Birden fazla YTM sekmesi varsa ilk seçilen/çalan sekme korunur.
- Ses geçişinin süresi hedef değerdir. AppleScript, D-Bus, tarayıcı ve ağ gecikmeleri bunu uzatabilir. Sistem ana sesi değiştirilmez. Desteklenmeyen oynatıcılarda doğrudan play/pause uygulanır.
- `MPRemoteCommandCenter`, başka uygulamaları yöneten genel bir denetleyici değildir; uygulamanızın uzaktan medya komutlarını alması içindir. Bu nedenle üçüncü taraf kontrolünde kullanılmaz. [Apple açıklaması](https://developer.apple.com/documentation/mediaplayer/remote-command-center-events)
- Windows yönetici izni istemez. Yükseltilmiş uygulamaların UIAutomation ağacına erişim Windows tarafından sınırlandırılabilir.
- Buradaki **odak modu**, müzik otomasyonu durumudur. İşletim sisteminin bildirim/DND ayarını değiştirmez; bu özellik platformlar arasında ortak bir API'ye sahip değildir.

## Spotify masaüstü — arka planda oynatma (0.1.11)

Mac’te Spotify şarkı, liste ve albüm bağlantıları artık kurallarda kullanılabilir. Paylaşım bağlantısındaki `?si=...` kısmını silmeniz gerekmez. Spotify masaüstü uygulaması açık ve hesabınıza giriş yapılmış olmalı; bu yerel yol için Premium, Developer Client ID veya tarayıcı eklentisi gerekmez.

İçerik başlatmak için açık Spotify uygulamasının kendi paketindeki `spotify_cli` kullanılır. Önce bu Mac’in Spotify oturumu doğrulanır; başka cihaz aktifse oynatma bu Mac’e aktarılır ve ardından şarkı/liste/albüm başlatılır. Önceki AppleScript `play track` ve odak geri alma kodu kaldırıldı. Normal ve tam ekran pencerelerde Spotify’ın hiç aktive olmaması canlı testin kabul koşuludur.

Spotify güncel olmalı ve paketinde bu kontrol aracı bulunmalı (doğrulanan istemci: 1.2.99.317). Eski sürümlerde pencereyi öne getiren bir yedek yöntem çalıştırılmaz; Spotify’ı güncelleme hatası gösterilir. Duraklatma, devam etme ve ses ayarı mevcut AppleScript kontrolünü kullanır. Spotify’ın kendi hesap/reklam/içerik kısıtları geçerlidir. [Araştırma, uygulama ayrıntıları ve test sınırları](docs/SPOTIFY.md).

## Spotify Web API (isteğe bağlı)

macOS yerel kontrolünde gerekli değildir. Windows'ta belirli bir listeyi başlatmak için kullanın; GSMTC mevcut oturumu kontrol eder, playlist seçimi sunmaz.

1. Spotify Developer Dashboard'da uygulama oluşturun; hesabın ve Developer uygulamasının erişim koşullarını sağlayın.
2. Redirect URI'yi **tam olarak** `http://127.0.0.1:43828/callback` ekleyin.
3. Ayarlarda **Spotify Web API** seçeneğini açın, Client ID'yi girip kaydedin. Client secret kullanılmaz.
4. **Spotify hesabını bağla** düğmesine basın. Sistem tarayıcısında yetkilendirin.
5. Cihaz listesinden bu bilgisayarın Spotify cihazını seçip kaydedin. Cihazın Spotify'da görünmesi için önce bir parça çalın.

PKCE S256, rastgele OAuth state, iki dakikalık tek oturumlu loopback callback, HTTPS, refresh token yenileme ve 429 `Retry-After` beklemesi uygulanır. Token'lar macOS Keychain / Windows Credential Manager / Linux Secret Service'te saklanır; IPC'ye veya ayar JSON'una verilmez. Linux'ta GNOME Keyring/KWallet gibi açık bir Secret Service gerekir. **Bağlantıyı kaldır** yerel kimliği siler; Spotify hesabındaki uygulama yetkisini ayrıca Spotify hesabınızdan kaldırabilirsiniz.

Spotify oynatma Web API'si Premium ve ilgili uygulama erişimini gerektirir. OAuth gerçek hesapla bağlanmadan ağ/hesap uçtan uca testi yapılamaz. [PKCE akışı](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [oynatma API'si](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback), [redirect kuralları](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Tarayıcı eklentisi

```sh
npm run extension:build
```

- Chrome/Edge/Brave: `chrome://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle → `dist-extensions/chromium`.
- Firefox: `about:debugging#/runtime/this-firefox` → Geçici eklenti yükle → `dist-extensions/firefox/manifest.json`. Kalıcı dağıtım için Mozilla imzası gerekir.
- Masaüstünde **Tarayıcı köprüsü** ayarını açıp kaydedin. **Eşleştirme anahtarını göster** ile anahtarı eklenti seçeneklerine kopyalayın.
- YouTube Music için `music.youtube.com` sayfasını yenileyin, ilk parçayı elle başlatın ve uygulamada **Diğer oynatıcılar → YouTube Music · tarayıcı eklentisi** seçin. Bu oynatıcı mevcut müziği yönetir ve **Müzik bağlantısı** alanına girilen YouTube Music içeriğini açar.

Eklenti `tabs`, `storage`, `alarms` ve yerel sunucu erişimi kullanır. HTTP(S) sayfalarındaki küçük heartbeat script'i sayfa içeriğini okumadan MV3 bağlantısını canlı tutar. `music.js` yalnızca music.youtube.com üzerinde medya elementine erişir. Algılanan bağlamdan gizli sekmeler, URL sorguları, fragment'ler ve tarayıcı geçmişi gönderilmez. Kullanıcının kurala yazdığı oynatma bağlantısı ayrı bir komut olarak, yalnızca gerekli oynatma parametreleriyle (`v`, `list`, `start_radio`, `index`, `params`) eklentiye iletilir. Sistem sesi kaydedilmez.

Köprü yalnızca `127.0.0.1:43827` dinler. İstekler 16 KiB ile sınırlıdır; Host, Origin ve sabit zamanda Bearer anahtarı kontrol edilir. Eski bağlam sekiz saniye sonra geçersizdir. Web sayfalarına CORS izni verilmez. Anahtar kullanıcıya özel izinlerle diskte tutulur; aynı kullanıcı yetkisine sahip zararlı süreçlere karşı işletim sistemi izolasyonunun yerini almaz.

### Uygulama seçimi ve ortak kurallar (masaüstü 0.1.5)

Kural düzenleyicisinde **Şu bağlamda → Uygulamalar** seçin. Bilgisayardaki uygulamalar alfabetik listelenir; arama alanıyla bulup birden fazla kutucuğu işaretleyin. Örneğin **Visual Studio Code + Preview** seçildiğinde aynı kural ve müzik bağlantısı ikisinde de geçerlidir. Seçili uygulamalar arasında geçiş yapmak aynı playlist'i baştan açmaz. Duraklatma kuralları ve diğer medya kesicileri önceliklerini korur.

Liste yalnızca düzenleyici açıldığında veya yenile düğmesine basıldığında okunur; uygulamaları açmaz ve ek Accessibility/Admin izni istemez. macOS `/Applications`, `/System/Applications` ve `~/Applications` içindeki bundle kimlikleri; Windows Başlat menüsü EXE kısayolları/App Paths; Linux XDG `.desktop` kayıtları kullanılır. Standart konumlar dışındaki taşınabilir programlar ve bazı Windows Store uygulamaları listelenmeyebilir. **Son kullanılanı ekle** veya **Listede olmayan bir uygulama ekle** seçenekleri korunur.

Mevcut tek uygulamalı kurallar aynen okunur. Çoklu seçimde 1–64 uygulama saklanabilir; kaldırılmış bir uygulama mevcut kuraldan otomatik silinmez. Tarayıcı eklentisi 0.1.4 bu masaüstü sürümüyle uyumludur; eklenti güncellemesi gerekmez.

### YouTube Music bağlantıları (uygulama ve eklenti 0.1.4)

Uygulama ve tarayıcı eklentisi en az 0.1.4 olmalı. Eklentiyi yüklediğiniz dizinin dosyaları güncellendikten sonra `chrome://extensions` üzerindeki **Yeniden yükle** düğmesine basın; açık YouTube Music sekmesini/PWA penceresini de yenileyin. Eşleştirme anahtarı değişmez. İngilizce Chrome arayüzünde düğme **Reload** olarak görünür; macOS dilini veya Apple Events JavaScript ayarını değiştirmek gerekmez. Eski sürüm sesi sıfırda bırakmışsa YouTube Music sesini bir kez istediğiniz seviyeye getirin; yeni sürüm bu seviyeyi korur.

**Ayarlar → Diğer oynatıcılar → YouTube Music** seçin. Kural düzenleyicisindeki **Müzik bağlantısı** alanına aşağıdakilerden birini yapıştırıp **Kuralı uygula** düğmesine basın:

- Şarkı ve liste: `https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg`
- Yalnızca şarkı: `https://music.youtube.com/watch?v=LkoXilp7FPY`
- Liste: `https://music.youtube.com/playlist?list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg`
- Radyo/mix: YouTube Music'te açılan radyo veya mix'in `watch?v=…&list=…` bağlantısını kullanın; varsa `start_radio=1` korunur.

Mevcut YouTube Music sekmesinde sayfa içi (`yt-navigate`) yönlendirme kullanılır. Otomatik geçişlerde sayfa yeniden yüklenmez, pencere/sekme öne getirilmez ve `beforeunload` / “Leave app?” koruması tetiklenmez veya devre dışı bırakılmaz. Sayfa içi yönlendirme hazır değilse hata gösterilir; tam sayfa açmaya geri dönülmez. Liste sayfasında istenen listedeki ilk şarkının bağlantısı açılır; oynatma başlamadan başarı onayı verilmez. Aynı hedef her taramada yeniden açılmaz. Ses geçişi eklentide tek işlem olarak yapılır; Rust ayrıca sesi sıfırlamaz ve sekme sessize alınmaz. Oynatıcı kimliği ve ilerleyen oynatma süresi kontrol edilir; adres çubuğundaki liste parametresinin birebir eşit olması gerekmez. Doğrulama zaman aşımında çalan parça duraklatılmaz ve önceki ses/mute ayarı geri yüklenir. Kullanıcının açık iptal/durdurma komutu ise çalmayı durdurur. Hedef, eşleştirilen hesabın erişebildiği bir içerik olmalı. Otomatik oynatma engellenirse hata görünür; sayfada bir kez Çal'a basıp tekrar deneyin. Kişisel mix/radyo sırasını YouTube Music belirler; uygulama kendi kuyruğunu üretmez.

Bağlantı açma işlemi en fazla 16 saniye onay bekler. Kullanıcının yeni kaydetme/duraklatma/kapatma komutu beklemeyi iptal eder; bekleyen eklenti işlemi de iptal edilir. Yeni bağlam taraması mevcut geçiş tamamlandıktan sonra yapılır. YouTube Music'in sayfa yapısı değişirse liste sayfasından ilk şarkıyı bulma uyarlama gerektirebilir; doğrudan `watch` bağlantıları bu adıma ihtiyaç duymaz.

## Paketleme

Paketleri hedef işletim sisteminde üretin:

```sh
# macOS: .app ve .dmg
npm run bundle -- --bundles app,dmg

# Windows: NSIS .exe
npm run bundle -- --bundles nsis

# Linux: .deb ve .AppImage
npm run bundle -- --bundles deb,appimage
```

Çıktılar `src-tauri/target/release/bundle/` altındadır. macOS'ta otomatik test/CI için `CI=true` DMG'nin Finder yerleşim betiğini atlar. Linux AppImage için `APPIMAGE_EXTRACT_AND_RUN=1` kullanılabilir. `.github/workflows/build.yml` üç yerel runner üzerinde test, lint ve paket üretir; paketleri artifact olarak saklar, yayınlama yapmaz.

macOS Intel/universal dağıtım için ilgili Rust target'larını kurup `npm run bundle -- --target universal-apple-darwin --bundles app,dmg` kullanın. Yerel geliştirme paketi ad-hoc imzalanır; Apple Developer imzası ve notarization içermez. Dağıtım imzası için `bundle.macOS.signingIdentity` değerini kendi Developer ID kimliğinizle değiştirin. Dağıtımda Apple sertifikası/notarization ve Windows code signing bilgilerini kendi CI secrets alanınıza ekleyin; anahtarlar repoya konmaz. [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/).

## Mimari

```text
src/                         React arayüzü ve tipli IPC istemcisi
  App.tsx                    Kontrol paneli, kurallar, ayarlar, etkinlik
  bridge.ts                  invoke + listen; ayrı web önizlemesi
  settings.ts                İçe aktarma ve form doğrulama
src-tauri/src/
  model.rs                   IPC/veri sözleşmeleri
  platform/mod.rs            Platform trait + cfg seçimi
  platform/macos.rs          JXA oynatıcı ve tarayıcı adaptörü
  platform/windows.rs        Win32, UIAutomation, GSMTC, WASAPI
  platform/linux.rs          X11, compositor, MPRIS
  engine.rs                  Saf öncelik motoru ve monotonic debounce
  media.rs                   Oynatma sahipliği, manuel müdahale, fade
  runtime.rs                 Seri iş kuyruğu, snapshot, iptal, hata beklemesi
  config.rs                  Doğrulama, atomik kayıt, Spotify URI güvenliği
  browser.rs                 Eşleştirilmiş loopback köprüsü ve YTM adaptörü
  spotify.rs                 OAuth/PKCE, güvenli depo, Spotify Web API
  spotify_desktop.rs         macOS Spotify yerel CLI oynatma ve cihaz seçimi
  desktop.rs                 Tauri komutları, tray ve pencere yaşam döngüsü
src-tauri/native/macos.m      Rust FFI için küçük Cocoa/AX/CoreAudio katmanı
browser-extension/           Chromium eklentisi kaynakları
scripts/package-extension.mjs Chromium ve Firefox manifest üretimi
tests/                       Playwright kullanıcı akışları + gerçek eklenti testi
docs/ARCHITECTURE.md          Kararlar, IPC ve operasyonel sınırlar
```

## Doğrulama

```sh
npm run check
npm run test:rust
npx playwright install chromium
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust testleri kural önceliği, sahte alan adları, PDF tespiti, debounce, fade hatasında sesi geri yükleme, kullanıcı pause davranışı, aynı playlist'e kesinti sonrası dönüş, PKCE ve köprü doğrulamasını kapsar. Playwright testleri kural oluşturma/kaydetme/silme, modal klavye davranışı, mobil taşma, tarayıcı hata kontrolü ve gerçek Chromium eklentisinin temizlenmiş URL + kimlik anahtarı göndermesini sınar.

Gerçek Spotify/Apple Music hesapları, macOS TCC izinleri ve fiziksel Windows/Linux masaüstü oturumları kullanıcı ortamında kabul testi gerektirir. Çapraz `cargo check`, bir hedefin çalışma zamanı veya kurulum paketini doğrulamaz.

## Gizlilik ve kurtarma

Varsayılan yol işletim sisteminin uygulama ayar dizinidir (`dev.musicoptimizer.desktop`). `DESKODY_CONFIG_DIR` ortam değişkeniyle ayrı bir ayar dizini seçilebilir; testlerde kullanıcı ayarlarını etkilemeden çalıştırmak içindir. OAuth token'ları bu override'dan bağımsız olarak sistem güvenli deposundadır.

Ayarlar geçici dosya + fsync + atomik değiştirme ile kaydedilir. Bozuk veya bilinmeyen sürümlü ayarlar otomatik olarak silinmez; otomasyon kapalı başlar ve hata görünür. Kullanıcı kaydettiğinde dosya yenilenir. En fazla 100 kural kabul edilir. Son 40 etkinlik yalnızca bellektedir; aktif pencere başlığı ve temizlenmiş URL diske yazılmaz. Spotify Web API kapalıyken uygulamanın buluta veri gönderen bir özelliği yoktur.


### macOS sistem menüsü (0.1.9)

Deskody’nin macOS hızlı kontrolleri artık doğrudan `NSStatusItem` → `NSMenu` içinde sunulur. Menü arka planını, cam/saydamlık görünümünü, açık/koyu temayı, gölgeyi, simgenin seçili halini ve tam ekranda menü çubuğu davranışını macOS çizer ve yönetir. Yeşil uygulama teması bu menüde kullanılmaz. macOS 26 kendi güncel menü görünümünü, eski sürümler kendi yerel menü stilini kullanır.

Akış ve kural anahtarları gerçek `NSSwitch`; simgeler SF Symbols, metinler sistem yazı tipi ve semantik sistem renkleridir. Kontroller menüyü kapatmadan çalışır. Oynat/duraklat, gerektiğinde otomasyona dönüş, hata gösterimi, ana uygulamayı açma, yenileme ve çıkış korunur. Kurallar uzunsa yerel kaydırma alanında listelenir. Menü açıkken başka uygulamaya/masaüstüne geçiş yaptırılmaz; ana pencere yalnızca açıkça seçildiğinde açılır. macOS’ta hızlı kontroller için webview oluşturulmaz; Windows/Linux React paneli devam eder.

Yerel entegrasyon testi: `python3 scripts/test-native-menu.py`. Test kendi normal ve tam ekran pencerelerini kullanır, kullanıcı ayarlarına veya müziğine dokunmaz. [Apple’ın menü içinde özel görünümler belgesi](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MenuList/Articles/ViewsInMenuItems.html) ve SDK `NSMenuItem.view` davranışı temel alınmıştır. 0.1.8’deki NSPanel barındırıcısı macOS üretim yolunda artık kullanılmaz.

### macOS tam ekran ve Spaces desteği (0.1.8, önceki uygulama)

Hızlı panel artık macOS’ta gerçek bir AppKit `NSPanel` içinde açılır. VS Code gibi başka bir uygulama tam ekrandayken veya farklı bir masaüstündeyken menü çubuğundaki Deskody simgesine tıklayabilirsiniz; panel o ekranda açılır ve Deskody’nin ana penceresine/masaüstüne geçiş yaptırmaz. Ana pencere yalnızca **Deskody’yi aç** ile getirilir. Menü çubuğu tam ekranda gizliyse imleci ekranın üstüne götürün.

Panel başka bir uygulamayı etkinleştirmeyen `nonactivatingPanel`, tüm Spaces için `canJoinAllSpaces`, tam ekran için `fullScreenAuxiliary` davranışlarını kullanır. macOS 13 ve üzerinde Stage Manager için `canJoinAllApplications` de uygulanır. macOS 12 desteği korunur. Panel dışına tıklama, Escape, uygulama/Space/ekran değişimi paneli kapatır. Panel kullanımı için yeni bir Erişilebilirlik veya Input Monitoring izni istenmez; otomasyonun mevcut uygulama algılama izinleri ayrı kalır.

Yerel test: `python3 scripts/test-native-panel.py`. Bu komut üretimdeki panel kodunu gerçek WebKit ile çalıştırır; ayrıca otomatik kapanan ayrı bir tam ekran test uygulaması açar. Testler, tam ekran uygulamasının aktif Space’inde kalındığını, panelin uygulama aktivasyonunu değiştirmediğini, WebKit bağlantısını ve klavye davranışını doğrular.

Dayanak: Apple’ın [nonactivatingPanel](https://developer.apple.com/documentation/appkit/nswindow/stylemask-swift.struct/nonactivatingpanel), [fullScreenAuxiliary](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary), [canJoinAllApplications](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications) ve [olay izleme](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/MonitoringEvents/MonitoringEvents.html) belgeleri.

### Menü çubuğundan hızlı kontrol (0.1.7)

macOS ve Windows’ta Deskody simgesine sol tıklamak ana pencere yerine küçük bir kontrol paneli açar. Akış kontrolünü ve her kuralı ayrı ayrı açıp kapatabilir, seçili oynatıcıyı oynatıp duraklatabilir, elle duraklattıktan sonra **Otomasyona dön** ile kuralları yeniden devreye alabilirsiniz. Akış kontrolünü kapatmak mevcut müziği durdurmaz. Kapalıyken yapılan kural seçimleri kaydedilir ve otomasyon yeniden açıldığında uygulanır.

Panel son uygulamayı, eşleşen kuralı ve parça bilgisini gösterir. **Deskody’yi aç** ana pencereye geçer; Escape, kapatma düğmesi veya panel dışına tıklamak paneli gizler. Sağ tıklama menüsü de hızlı kontrole, ana pencereye ve çıkışa erişim sağlar. Linux’ta tray tıklama olayları desteklenmediği için panel tray menüsündeki **Hızlı kontrol** üzerinden açılır; konum bilgisi yoksa birincil ekranın sağ üstüne yerleşir. Bu platform sınırı [Tauri tray belgelerinde](https://v2.tauri.app/learn/system-tray/) açıklanır.

İlk kurulumda ana pencere açılır; kaydedilmiş ayarları olan sonraki başlangıçlar menü çubuğunda çalışır. Uygulamayı Finder’dan yeniden açmak ana pencereyi getirir. Panelde kural değişiklikleri doğrudan kaydedilir ve ana pencereyle eşzamanlanır. Ana penceredeki kaydedilmemiş diğer alanlar korunur. Panel açılınca Deskody’nin kendisi müzik bağlamı sayılmaz; son dış uygulama korunur. İlgisiz bir kuralın anahtarını değiştirmek çalan listeyi yeniden başlatmaz. Eklentiyi yeniden kurmak veya eşleştirmek gerekmez.

### Deskody adı ve sürüm bilgisi (0.1.6)

Uygulama adı Deskody, tarayıcı eklentisi Deskody Bridge’dir. macOS paketi `Deskody.app`, çalıştırılabilir dosya `deskody` adını taşır. Arayüzün altındaki sürüm bilgisi doğrudan `package.json` sürümünden derlenir. Tarayıcı eklentisindeki yeni adı görmek için mevcut eklentiyi **Reload / Yeniden yükle** ile güncelleyin; eşleştirme anahtarı korunur.

Önceki kurulumlarla uyum için OS bundle kimliği (`dev.musicoptimizer.desktop`), ayar dizini, Spotify keyring hizmeti, Firefox extension kimliği ve sayfa köprüsünün dahili olay adları korunur. Böylece isim değişikliği yeni bir hesap/eşleştirme gerektirmez. `MUSIC_OPTIMIZER_CONFIG_DIR` eski ortam değişkeni de desteklenir; `DESKODY_CONFIG_DIR` önceliklidir. Web önizlemesi eski yerel ayar anahtarını okuyabilir; yeni kayıtlar `deskody-preview-v1` anahtarına yazılır.
