# Spotify masaüstü — arka planda oynatma (0.1.11)

## Sorun ve araştırma

Spotify’ın `Spotify.sdef` sözlüğündeki AppleScript `play track` komutu `spfy/PCtx` olayına karşılık gelir. JXA, doğrudan Apple Event (`WaitForReply | NeverInteract`), `in context` ve `NSWorkspaceOpenConfiguration.activates = NO` ile URL açma denemelerinde bu istemci kendisini yine aktive etti. [Spotify Community’de aynı davranışın kullanıcı bildirimi](https://community.spotify.com/t5/Desktop-Mac/Bug-report-AppleScript-amp-quot-play-track-amp-quot-command/m-p/6938676) bulunuyor; bütün sürümler için resmi garanti değildir. [Apple AESendMode belgesi](https://developer.apple.com/documentation/coreservices/aesendmode) gönderici bayraklarını tanımlar; bunlar alıcı uygulamanın kendi aktivasyon çağrılarını yasaklamaz.

0.1.10, Spotify aktive olduktan sonra eski uygulamayı geri aktive ediyordu. Bu, kullanıcının beklediği arka plan davranışını sağlamadı. 0.1.11 bu yolu ve odak gözlemcisini tamamen kaldırır.

## Yeni yol: Spotify’ın paketlediği yerel kontrol aracı

Kurulu Spotify 1.2.99.317 paketinin `Contents/MacOS/spotify_cli` dosyası incelendi. Birincil kaynak doğrudan bu çalıştırılabilir dosyanın `--help`, `play --help`, `devices transfer --help`, `status --format json` ve `version` çıktılarıdır. Aynı adlı üçüncü taraf Python/Rust araçları kullanılmaz, bir araç indirilmez ve Spotify paketine müdahale edilmez.

- `native/spotify.m`, `com.spotify.client` kimliğiyle **çalışan** uygulamanın bundle URL’sinden CLI yolunu bulur. `/Applications` sabit varsayımı veya `$PATH` araması yoktur. Spotify kapalıysa uygulamayı başlatmaz.
- `spotify_desktop.rs`, doğrulanmış canonical Spotify URI’siyle çalışır. Komutlar shell olmadan argv üzerinden yürütülür; her biri dört saniye ve sınırlı stdout/stderr bütçesine sahiptir. Zaman aşımında alt süreç sonlandırılır ve beklenir.
- `devices list --format json` içindeki `is_self` bu Mac’in Spotify örneğini belirler. `is_local` tek başına yeterli değildir: ağdaki başka bir cihazı seçmemeliyiz. Eksik, belirsiz veya geçersiz yerel kimlikte oynatma yapılmaz.
- Başka Connect cihazı aktifse `devices transfer ID` gönderilir; yeni cihaz listesinde yerel oturumun aktif olduğu doğrulanmadan `play URI` çalışmaz. Spotify CLI 1.2.99’da `play URI --device ID` yalnızca aktarım yapıp URI’yi göz ardı ettiğinden bu iki adım açıkça ayrılır. Harici bir uygulama bu adımlar arasında Connect hedefini değiştirirse Spotify oturumunun eşzamanlı davranışı hâlâ Spotify tarafından yönetilir.
- Başarılı `play URI --format json` çıktısı bu sürümde boş, exit code 0’dır. Komut hataları ve beklenmeyen yanıtlar sessiz başarı sayılmaz. Hata durumunda PCtx, URL açma, tarayıcı veya uygulama aktivasyonu **fallback’i yoktur**.
- Duraklatma/devam etme ve uygulama ses seviyesi mevcut JXA komutlarıyla çalışır; bunlar yeni içerik başlatan `play track` değildir. Ses geçişi ve YouTube Music akışı korunur.

Premium, Spotify Developer uygulaması, Client ID, Deskody için OAuth veya tarayıcı eklentisi gerekmez. Açık Spotify masaüstü uygulamasındaki oturum kullanılır. CLI’nin bulunmadığı eski/alternatif Spotify dağıtımlarında kullanıcıya güncelleme gerektiği söylenir. Bu, Spotify’ın kararlı ve sürümler arası garanti edilmiş bir üçüncü taraf SDK sözleşmesi değildir; paket içeriği veya çıktı şeması değişirse adaptörün güncellenmesi gerekebilir. Hesabın reklam, bölge ve içerik kısıtları geçerlidir.

Bu değişiklik macOS adaptöründedir. Windows GSMTC ve Linux MPRIS yolları değiştirilmez; Windows’ta URI başlatmanın mevcut Web API gereksinimi bu Mac düzeltmesiyle kalkmış değildir.

## Şarkı bağlantıları

React ve Rust doğrulayıcıları Spotify `track`, `playlist`, `album` HTTPS bağlantılarını ve karşılık gelen `spotify:` URI’larını kabul eder. `si` gibi paylaşım parametreleri temizlenir. Sahte alan adı, kimlik bilgileri, fazladan yol segmenti ve desteklenmeyen türler reddedilir. Ortak fixture iki dili aynı örneklerle sınar; mevcut ayar alanı ve kullanıcı kuralları korunur.

İsteğe bağlı Web API’de şarkı hedefi `{"uris":["spotify:track:..."]}`, albüm/liste hedefi `{"context_uri":"spotify:..."}` kullanır. [Spotify Start/Resume Playback sözleşmesi](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback) bu ayrı adaptörü tanımlar; Web API’nin Premium gereksinimi yerel CLI yolu için bir gereksinim değildir.

## Tekrarlanabilir doğrulama

- `npm run test:rust`: URI doğrulama, kural motoru ve medya geçişleri; CLI için yerel cihaz seçimi, aktarımın doğrulanması, başarısız komutta durma, geçersiz hedef, beklenmeyen yanıt ve uzak cihaza yanlışlıkla komut göndermeme testleri.
- `python3 scripts/test-native-spotify.py`: native bundle yolu ve buffer sahipliği kontrolü; oynatma yapmaz.
- `python3 scripts/test-native-spotify.py --live spotify:track:4LhgwcTWwJQc6DFTkLXVEc --seed spotify:playlist:37i9dQZF1EIWSf6WayhJZ9`: **üretim Rust fonksiyonunu** çağıran örnek program, önce farklı içerik başlatan seed, gerçek Spotify ve geçici normal/tam ekran uygulama pencereleri. Spotify aktivasyon bildirimi veya polling’de Spotify ön planda görülürse test başarısızdır; eski testi geçiren “odağı geri getir” davranışı artık kabul edilmez. Host ayrıca pencerenin/Space’in/ön uygulamanın korunmasını kontrol eder. Test sırasında kullanıcı tıklaması/üçüncü uygulama aktivasyonu da başarısızlık sayılır.

Canlı test oturum açılmış Spotify ve mevcut Automation izni gerektirir (parça/durum doğrulaması için). Parçayı değiştirir; başlangıçta duraklatılmışsa tekrar duraklatır. Eski kuyruğu/şarkıyı/konumu geri yüklemez. Kuralların testle eşzamanlı komut göndermemesi için Deskody canlı test sırasında kapalı olmalıdır. Bütün Spotify/macOS/çoklu ekran sürümleri için mutlak garanti yerine, test edilen sürüm ve sonuçlar [VALIDATION.md](VALIDATION.md) içinde kaydedilir.
