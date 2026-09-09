# Spotify şarkı bağlantıları ve macOS odak davranışı — 0.1.10

## Bağlantının reddedilme nedeni

Önceki React ve Rust doğrulayıcıları yalnızca `playlist`/`album` türlerini kabul ediyordu. `track` bağlantısı, geçerli bir Spotify paylaşım bağlantısı olsa bile reddediliyordu. İki doğrulayıcı artık şarkı/liste/albüm HTTPS bağlantılarını ve karşılık gelen `spotify:` URI’larını kabul eder. `si` gibi paylaşım parametreleri oynatma komutuna aktarılmaz. Kullanıcı adı/parola, sahte alan adı, fazladan yol segmenti ve desteklenmeyen türler reddedilir. Paylaşılan test corpus’u iki dili aynı örneklerle sınar; mevcut `playlist` ayar alanı korunur, kullanıcı kuralları göç gerektirmez.

İsteğe bağlı Web API adaptöründe de şarkı hedefi için `{"uris":["spotify:track:..."]}`, albüm/liste için `{"context_uri":"spotify:..."}` gönderilir. Boş hedef mevcut oynatmayı sürdürür. Bu ayrım [Spotify Start/Resume Playback sözleşmesinden](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback) gelir. Web API Premium gerektirir; macOS yerel masaüstü yolu bu API’yi veya Client ID’yi kullanmaz.

## Öne gelme sorununun araştırılması

Mevcut kod JXA `playTrack` kullanıyordu; açık bir `activate` çağrısı yoktu. Yerelde kurulu Spotify’ın `Contents/Resources/Spotify.sdef` sözlüğünde `play track` komutu `spfy/PCtx`, doğrudan parametre metin URI’si olarak tanımlıdır.

Canlı testte JXA yerine çalışan Spotify PID’sine `NSAppleEventDescriptor` ile `WaitForReply | NeverInteract` göndermek doğru şarkıyı başlattı, ancak Spotify yine öne geldi. `NSWorkspaceOpenConfiguration.activates = NO` ile URL açmak ve `in context` parametresi de bu istemcide aktivasyonu engellemedi. Bu deneyler üretim kodunda alternatif/fallback olarak bırakılmadı. [Spotify Community’de aynı komutun istemciyi istemeden aktive ettiğine ilişkin bir kullanıcı hata bildirimi](https://community.spotify.com/t5/Desktop-Mac/Bug-report-AppleScript-amp-quot-play-track-amp-quot-command/m-p/6938676) bulunuyor; bu kayıt bütün sürümler için resmi garanti veya çözüm değildir.

[Apple AESendMode belgesi](https://developer.apple.com/documentation/coreservices/aesendmode) olay göndericisinin etkileşim ve uygulama geçişi bayraklarını açıklar. Bu bayrakların kullanılması, Spotify’ın kendi aktivasyon çağrısını dışarıdan yasaklayan bir mekanizma değildir. [NSRunningApplication](https://developer.apple.com/documentation/appkit/nsrunningapplication?language=objc) uygulamayı yeniden aktive etmek için public API sunar; değişken özellikleri ana run loop ilerledikçe güncellenir.

## Uygulanan masaüstü çözümü

`native/spotify.m` yalnızca çalışan Spotify PID’sine üç saniye zaman sınırlı `spfy/PCtx` olayı gönderir. URI veri parametresidir; shell, URL açıcı, tarayıcı veya uygulama başlatma kullanılmaz. Apple Event yanıtındaki hata kodu da kontrol edilir. Spotify kapalıysa otomatik açılmaz; izin/zaman aşımı hataları Rust’a aktarılır.

Komutun başında kısa ömürlü `DeskodySpotifyFocusGuard` mevcut ön uygulamayı kaydeder. Spotify’ın aktivasyon bildirimi gelirse, o uygulama hâlâ ön plandaysa önceki uygulamayı geri aktive eder. Bazı Spotify sürümleri aynı komutta iki aktivasyon ürettiği için en fazla üç geri dönüşe izin verilir; gözlemci 1,25 saniye sonra mutlaka kaldırılır. Sürekli pencere izleyicisi veya aktif polling yoktur.

Kullanıcı yeni bir fare tıklaması yaparsa, yeni Command kısayolu algılanırsa veya üçüncü bir uygulamaya geçerse koruma bırakılır. Önceki uygulama kapanmış/gizlenmişse geri açılmaz. Spotify zaten ön plandaysa koruma kurulmaz. Bütün pencereleri öne getiren `ActivateAllWindows` kullanılmaz. Deskody’nin ana penceresini açan bir çağrı eklenmez. Kullanıcı kuralları, kaynak seçimi ve tarayıcı eşleştirmesi değiştirilmez.

Bu çözüm **odak geri kazanımıdır**; Spotify’ın hiç aktive olmayacağı veya bütün Mac/monitör/Space düzenlerinde görünür bir geçiş olmayacağı iddiası değildir. Test makinesinde Space korunmuştur; kısa görsel geçiş yine mümkündür. Premium, Developer hesabı, Spotify Web veya yeni tarayıcı eklentisi gerektirmez. Spotify hesabının içerik erişimi, reklam ve oynatma kısıtları kendi istemcisine aittir.

## Doğrulama

- React/Vitest ve Rust aynı geçerli/geçersiz bağlantı örneklerini kullanır. Kullanıcının şarkı/liste URL’leri dahildir. Rust ayrıca kalıcı ayar roundtrip’i ve doğru müzik kaynağına yönlendirmeyi sınar.
- Web API payload testi şarkı, bağlam ve devam-et isteklerini ayırır; gerçek OAuth oturum testi değildir.
- Playwright kullanıcının şarkı URL’sini arayüzden kaydeder, sayfayı yeniden açar ve kaydı doğrular. Mevcut YouTube Music ve tray testleri de geçer.
- `python3 scripts/test-native-spotify.py`: süre, tekrar sayısı, üçüncü uygulama seçimi, yeni tıklama, kapanmış/gizlenmiş uygulama ve gözlemci temizliği. Bu testte geri aktive edilecek uygulama kontrollü fixture’dır; kullanıcı pencerelerini değiştirmez.
- `python3 scripts/test-native-spotify.py --live spotify:track:4LhgwcTWwJQc6DFTkLXVEc`: **gerçek Spotify masaüstü** üzerinde paylaşılan şarkı, gerçek Apple Event, normal ve başka sürecin tam ekran penceresi. Hesaba giriş/Automation izni gerekir. Test parçayı değiştirir ve başlangıçta duraklatılmışsa yeniden duraklatır; tüm eski kuyruk/çalma konumunu geri yükleme iddiası yoktur.
- 2026-09-09 canlı test: her iki senaryoda komut kodu 0, doğru track ID ve playing=true; başlangıçtaki pencere/Space/ön uygulama korundu. Gözlenen Spotify aktivasyonundan bir sonraki uygulama aktivasyon bildirimine en uzun aralık normalde 3,5 ms, tam ekranda 3,7 ms idi. Bunlar bildirim zamanlarıdır; ekran karelerinin veya animasyonun süresini ölçmez.
