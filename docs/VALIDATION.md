# Version preparation — 0.1.15 / 2026-11-18

- App metadata aligned to **0.1.15** in `package.json`, both root package-lock entries, the Deskody Cargo package/lock entry and `tauri.conf.json`. The UI derives its version from the package. Deskody Bridge remains independently versioned at **0.1.9**.
- This version includes the notch fullscreen/edge interaction work, faster paired YTM commands and coherent timeline/provider-label fixes documented below. The preceding local acceptance and installation entries intentionally retain their actual tested/installed 0.1.14 version.
- Rechecked after the version bump: `npm run check` (production frontend build and 27 Vitest), 57 core Rust tests, version consistency and `git diff --check` passed. The earlier 17 Playwright and native desktop/fullscreen acceptance results below apply to the same behavior before this metadata-only bump; they were not rerun for the version number alone.

---

# YouTube Music timeline corruption correction — 2026-11-18

- Reproduced two failures before fixing them: a 158-second content timeline was reported as the raw stream's 238 seconds, and an older asynchronous state read was sent with the acknowledgement of a newer seek/skip command. The prior UI-preview test did not cover these source/concurrency differences.
- `music-page.js` now reads content duration/current time together from the loaded player API and seeks through that same player's `seekTo`. Scoped media fallback is retained only when that API pair is absent. Inconsistent loaded/response identity or content length suppresses position/seek instead of reusing a previous stream's clock. Missing metadata still supports actual-progress verification. Raw stream lengths/offsets are not combined with content-time seek targets. Reports capture their acknowledgement/error generation before awaiting state; completion queues a separate fresh report.
- Live inspection also showed that YTM's visible total is not represented by one universal rounding rule. Added optional, validated `Player.displayDuration` for the current progress bar's total. Its clock must agree with the loaded content, and its length is bounded near the exact duration; previous-track bar values are discarded. It is only a label: `duration` remains precise and transport validation/ranges never use `displayDuration`. Legacy fields default normally, old nested-player readers ignore the optional field, native non-YTM adapters set no provider label.
- Regression coverage: 2:38 content vs 3:58 raw stream; seek at 2:34; mixed loading samples; the next track's own duration; stale track IDs; absent/invalid APIs and metadata; asynchronous old-state/new-ack races for seek and next; provider total 4:00 with exact duration 240.15; and rejection of seek positions beyond actual duration even when a longer label is displayed. The real Chromium extension fixture exercises mixed clocks and subsequent track metadata; React/native tests keep seek ranges precise.
- Final checks: production ARM64 app build; 27 Vitest (including extension JS tests via `vitest.config.ts`), 57 core Rust, 17 Playwright language/tray/extension scenarios; native notch and menu in current/external fullscreen Spaces; desktop Clippy, Rustfmt, extension packaging and `git diff --check` passed. New JS test sources are excluded from packaged extensions. Cross-platform native constructors were aligned; Windows/Linux runtime was not retested.
- Installed the final app at `/Applications/Deskody.app` (0.1.14), verified signature/new binary equality and one running instance; settings/pairing contents were unchanged. Previous app: `.tools/installed-backups/20261118-014155/Deskody.app`. Reloaded the Chromium extension as Deskody Bridge 0.1.9 and refreshed the YTM PWA. Live page inspection confirmed matching player/bridge time with `canSeek=true`; final native/YTM UI comparison showed the same 2:33 total. The exact 158/238-second corruption scenario was validated in controlled fixtures, not claimed as a captured real-account reproduction. No DMG rebuilt.

---

# Media responsiveness and Space continuity — 2026-11-18

- Added negotiated, authenticated `GET /commands` long-poll delivery (20-second maximum; existing Host/Origin/Bearer validation). Deskody Bridge 0.1.8 deduplicates simultaneous POST/long-poll delivery, publishes command acknowledgements with fresh media state immediately and coalesces overlapping report requests. Old combinations retain heartbeat delivery. The Chromium fixture delivers pause exclusively through the new channel (POST command delivery disabled) and verifies acknowledgement within one second; this is a fixture bound, not a live-account latency benchmark. Existing navigation/cancellation, volume/mute, audible output and duplicate-command checks passed.
- Interactive YTM validation reads only the paired player's metadata, avoiding unrelated native app discovery. Manual transport/play/pause publishes fresh selected-player state before acknowledgement, without waiting for a context scan. Rust covers command-channel authentication/wakeup/disable, targeted discovery isolation and the snapshot state visible immediately after seek completion.
- Notch scrubbing continuously previews elapsed time, freezes total duration during the gesture and dispatches one seek on release. Notch/main/tray retain a three-second bounded preview so older snapshots cannot pull the thumb back; fresh matching samples or track changes release it. Native tests cover near-end label stability and stale/fresh seek samples; Playwright covers a delayed paused seek at the end of a track and cancellation after track identity changes.
- Fullscreen opt-in retains the existing stationary notch surface and expansion state across Space-change notifications; desktop-only mode retains collapse/exclusion. Avoiding reordering and transient interaction teardown prevents Deskody-induced flicker. Native fixtures cover state retention/focus in the current and external fullscreen Spaces. Physical touchpad-swipe compositing across arbitrary monitor arrangements remains macOS/device acceptance, not an automated frame-by-frame guarantee.
- Production ARM64 app build, `npm run check` (14 Vitest), 56 core Rust tests, 15 Playwright language/tray/extension tests, native notch/menu tests, desktop Clippy, Rustfmt, extension packaging and `git diff --check` passed.
- Installed `/Applications/Deskody.app` (0.1.14), verified strict ad-hoc signature, new binary equality/difference from backup, one running instance and unchanged settings/pairing contents. Previous app: `.tools/installed-backups/20261118-010532/Deskody.app`. Reloaded the existing Chromium extension from `dist-extensions/chromium`, confirmed version 0.1.8, refreshed the YouTube Music PWA and observed live media metadata reaching the installed notch. No real-account transport timing benchmark was run. No DMG rebuilt; older macOS and Windows/Linux runtime remain outside this local acceptance.

---

# Notch fullscreen and top-edge interaction — 2026-11-18

- Added `notchFullscreen`, default false for new and legacy settings. English/Turkish settings save independently of unfinished form edits, survive restart and retain committed state on storage errors. Rust verifies legacy defaults, persistence and presentation changes without playback restart/cancellation.
- The panel reaches the physical screen top instead of being constrained below the menu bar. Hover includes the top edge, rejects adjacent-display coordinates above the host and revalidates current pointer/buttons before opening. Explicit collapse suppresses reopening until the pointer leaves. Six synthetic display sizes/origins (including negative and vertically stacked coordinates) cover edge calculations; these are geometry checks, not six physical monitor tests.
- Native notch fixture passed on desktop and in another process’s actual fullscreen Space: hidden by default with monitors/polling/decoration stopped, opt-in/off in place, retained media views when recreating the window, top-edge hover, controls, close grace, focus/Space preservation and teardown. WindowServer retains fullscreen eligibility on existing panels; preference changes therefore recreate only the NSPanel with `FullScreenNone` or `FullScreenAuxiliary`. No private Space APIs, screen capture or Accessibility permission is needed. Native menu tests also passed on desktop/fullscreen, sequentially after notch tests.
- The production link exposed Clang’s `___isPlatformVersionAtLeast` helper from `@available`; the native guard now uses the project’s existing `NSProcessInfo` pattern. The subsequent production app build and desktop Clippy passed.
- `npm run check`: production build + 14 Vitest passed. Core Rust: 54 passed. Playwright language/settings + tray/media: 13 passed. macOS desktop Clippy (`--all-targets -- -D warnings`), Rustfmt and `git diff --check` passed. Expanded native fixture screenshot inspected.
- Native tests use fixtures, do not alter real playback/settings and temporarily move/restore the pointer. Physical hot-plug, older macOS versions, Stage Manager and arbitrary multi-monitor arrangements still need device acceptance; see [NOTCH.md](NOTCH.md). Built the ARM64 production `.app` and installed `/Applications/Deskody.app` at the owner’s request; version remains 0.1.14. Strict ad-hoc signature verification passed, the installed binary matches the new build and differs from the backup, one running instance was verified, and settings/pairing file contents were unchanged. Previous app: `.tools/installed-backups/20261118-004356/Deskody.app`. Opened the installed Settings UI and verified the new Turkish fullscreen switch is present and off. No DMG was rebuilt.

---

# Notch refinements — same 0.1.14 / 2026-10-13

- Added `notchNowPlaying`, enabled by default for new/legacy settings. Settings saves it independently of the notch itself and unfinished form edits. Disabling it hides collapsed artwork/indicator, restores physical notch width and stops compact observation; hover controls remain available. Rust persistence/runtime tests and the English/Turkish Playwright flow passed, including restart, failed storage and retention while the parent notch is disabled.
- Expanded content height changed from 230 to 172 points (about 25% less), retaining the camera-safe header. Opening/closing now uses a non-overshooting damped morph and coordinated content/wing crossfades. Native fixture tests passed in the current Space and another process's fullscreen Space, including actual control hit testing, intermediate closing geometry and rapid reversal without a geometry jump. The harness now places the cursor outside the notch before startup/re-enabling to avoid incidental hover during lifecycle assertions.
- `npm run check`: TypeScript/Vite + 14 Vitest passed. Core Rust: 54 passed. Playwright language/settings + tray/media: 12 passed. macOS desktop Clippy (`--all-targets -- -D warnings`), Rustfmt and `git diff --check` passed. Screenshots of the smaller expanded host and plain collapsed notch were captured and visually inspected. Windows x64 GNU desktop `cargo check --offline` also passed; this is a compile check, not a Windows runtime test.
- This refinement preserves app version **0.1.14** at the owner's request. Extension unchanged. Native tests use fixture media/callbacks, without changing real playback or personal settings; physical sleep/hot-plug and older macOS versions retain the acceptance limits in [NOTCH.md](NOTCH.md).
- Rebuilt ARM64 app/DMG and installed `/Applications/Deskody.app`; strict ad-hoc signature, DMG checksum and one running instance verified. User settings/pairing files unchanged. Previous installation backed up under `.tools/installed-backups/20261013-001434/`. The DMG path remains `src-tauri/target/release/bundle/dmg/Deskody_0.1.14_aarch64.dmg`; its new SHA-256 is `d78a1d6c6b6a4a4a802f229c1e22962c666379dde14b763405cdc8c9ee2d30a8`. The initial-build checksum below is historical and no longer identifies the current DMG. Not notarized.

---

# Initial Deskody Notch build — 0.1.14 / 2026-10-13

- `python3 scripts/test-native-notch.py`: gerçek AppKit notch host'u normal Space ve başka sürecin tam ekran Space'inde geçti. Hover gecikmesi, ayrılma/geri dönme toleransı, gerçek NSView hit testing, kamera altı yerleşim, kapak, hedefli önceki/sonraki/seek payload'ları, duraklatılmış seek, hata sonrası committed durum, kapatma/yeniden açma, suspend/wake bildirimleri, Reduce Motion ve teardown doğrulandı. Ön uygulama/Space korunur. Test kendi fixture metadata'sını ve callback'ini kullanır; gerçek müzik çalmaz, kullanıcı ayarlarını değiştirmez; fareyi geçici taşıyıp geri koyar.
- `python3 scripts/test-native-menu.py`: normal ve ayrı tam ekran Space'te başarılı. Yeni notch menü tercihi ve checkmark'ı, mevcut akış/kural kontrolleri ve hedefli medya komutları sınandı.
- `npm run check`: TypeScript/Vite üretim derlemesi ve 14 Vitest başarılı. Rust çekirdek testleri: 54 başarılı. Sunum tercihlerinin oynatma/iptal/gate durumunu koruması, eski ayarlardaki varsayılan notch tercihi ve kalıcı kayıt doğrulandı. Ana uygulama/tray/dil Playwright dosyaları (20 test) geçti; notch tercihi ilgisiz kaydedilmemiş alanı korur ve depolama hatasında geri alınır.
- macOS desktop tüm target'lar Clippy `-D warnings`, Rustfmt ve `git diff --check` başarılı. Windows x64 GNU için varsayılan desktop feature ile `cargo check --offline` başarılı. Windows kurulum/runtime testi yapılmadı; notch yalnızca macOS'ta derlenir, diğer platformların paneli korunur.
- ARM64 `.app`/`.dmg` üretildi. Ad-hoc imzanın strict doğrulaması ve `hdiutil verify` başarılı. `/Applications/Deskody.app` 0.1.14 kuruldu, tek çalışan örnek ve ayar/eşleştirme dosyalarının içeriklerinin aynı kaldığı doğrulandı. Önceki uygulama `.tools/installed-backups/20261013-000203/` altında yedeklendi. Deskody Bridge değişmedi; yeniden yüklemek gerekmez.
- Görsel fixture ekran görüntüleri `/tmp/deskody-notch-compact.png` ve `/tmp/deskody-notch-expanded.png` incelendi. Fiziksel ekran takıp çıkarma, gerçek sistem uykusu, diğer notch uygulamalarıyla çakışma ve tüm macOS sürümleri ayrıca cihaz üzerinde test edilmedi. [Tasarım, araştırma ve test sınırları](NOTCH.md). Notarization uygulanmadı.

DMG: `src-tauri/target/release/bundle/dmg/Deskody_0.1.14_aarch64.dmg`

SHA-256: `ba7d70978464a7b867d09e85a83458dd39cda9b5cf3cc9d94e9a3404531a359f`

---

# Windows test paketi — 0.1.11 / 2026-09-11

- `dist-releases/Deskody-0.1.11-Windows-x64-test.zip` üretildi: 2.752.684 bayt. NSIS kurulum EXE'si, Deskody Bridge 0.1.6 Chromium klasörü, Türkçe kurulum ve test sonuç formu, build bilgisi ve SHA-256 listesi içerir. Toplam 14 dosya; kişisel ayar/eşleştirme dosyası yoktur.
- Uygulama Mac üzerinde `x86_64-pc-windows-gnu` hedefi, MinGW-w64 ve Tauri'nin production/custom-protocol derlemesiyle üretildi. NSIS 3.11 paketlemesi başarılı. Windows runtime testi yapılmadı; bu paket arkadaş kabul testi içindir. Güncel Windows 10/11 x64 Intel/AMD hedeflenir.
- Kurulum EXE'si 7-Zip ile açıldı. İçindeki `deskody.exe` ve `WebView2Loader.dll` derleme çıktılarıyla byte eşit ve her ikisinin PE machine alanı AMD64 olarak doğrulandı. Ana uygulama Windows GUI subsystem kullanır. Import listesinde WebView2Loader dışındaki bağımlılıklar Windows sistem/UCRT kitaplıklarıdır; ek MinGW runtime DLL gereksinimi görünmedi.
- NSIS script'inde WebView2Loader kurulumu ve WebView2 runtime yoksa Microsoft bootstrapper indirme yolu doğrulandı. Kurulum imzasızdır. Gerçek Windows üzerinde SmartScreen, WebView2 indirme/kurma, tray, medya/odak ve kaldırma davranışları henüz test edilmedi.
- ZIP CRC testi, tüm iç dosyaların SHA-256 karşılaştırması ve eklentinin kaynak paketle byte eşitliği başarılı. `scripts/run.mjs` CLI sürüm komutu, Node sözdizimi, Prettier ve `git diff --check` başarılı.
- Önceki GitHub Windows job'u (run 34445696267) Rust/Clippy kontrollerini geçmiş, `.cmd` üzerinden Tauri başlatırken `"node" is not recognized` hatasıyla paketlemede durmuştu. `scripts/run.mjs` şimdi JavaScript giriş noktasını mevcut Node ile shell olmadan başlatır. Windows workflow'una test ZIP'i üretme/artifact adımı eklendi; bu yerel değişiklikler GitHub'a push edilmedi ve yeni CI koşusu başlatılmadı.
- Windows Spotify URI başlatma bu sürümde Web API gerektirir. Mac Spotify CLI çözümü Windows'a aktarılmadı; paket rehberi bu sınırı açıkça belirtir.

ZIP SHA-256: `4ad12b3b78a9ecc9720d06eb08f5ec4db239f3de2dee831a49513f1c78475060`

Tekrar üretme: [WINDOWS-BUILD.md](WINDOWS-BUILD.md).

---

# Deskody doğrulama — 0.1.11 / 2026-09-10

- Spotify 1.2.99.317’nin kendi `spotify_cli` aracı kullanılarak gerçek masaüstü oynatma doğrulandı. AppleScript `play track`/PCtx ve odak geri alma koruması kaldırıldı. Premium, Developer hesabı veya Spotify Web kullanılmadı.
- `python3 scripts/test-native-spotify.py --live spotify:track:4LhgwcTWwJQc6DFTkLXVEc --seed spotify:playlist:37i9dQZF1EIWSf6WayhJZ9`: üretim Rust fonksiyonu ile önce farklı listeden içerik, ardından hedef şarkı. Hem normal hem gerçek tam ekran fixture’da başlangıç parçasının hedeften farklı olduğu doğrulandı; komut kodu 0, doğru track ID, playing=true, **Spotify activated=0**, özgün ön uygulama ve Space korundu. Fare/üçüncü uygulama aktivasyonu yoktu. Seed’siz iki senaryoda da önceki test geçti. Başlangıçtaki duraklatılmış durum testten sonra geri getirildi.
- 47 Rust testi başarılı; yedi yeni CLI testi yerel cihaz, transfer onayı, hata halinde durma, URI güvenliği ve beklenmeyen yanıt davranışını kapsıyor. `npm run check`: TypeScript/Vite üretim derlemesi ve 10 Vitest başarılı. macOS tüm target’lar Clippy `-D warnings`, Rustfmt, native resolver testi ve `git diff --check` başarılı.
- macOS ARM64 app/DMG üretildi. Ad-hoc imza strict doğrulaması ve `hdiutil verify` başarılı. `/Applications/Deskody.app` 0.1.11 kuruldu, tek çalışan örnek doğrulandı; kullanıcı ayarları ve tarayıcı eşleştirme dosyalarının hash’leri değişmedi. Önceki kurulum `.tools/installed-backups/20260910-093050/` altında.
- Yeni oynatma yolu macOS ile sınırlıdır; Windows/Linux çalışma zamanı ve yeni paketleri bu değişiklikte test edilmedi. Başka fiziksel Spotify Connect cihazına aktarım canlı test edilmedi; hedef seçimi ve başarısız aktarım Rust fixture’larıyla sınandı. Eklenti değiştirilmedi. Apple notarization uygulanmadı. Spotify’ın diğer/eski dağıtımlarında CLI bulunacağı veya aynı şemayı koruyacağı garanti edilmez; eksik araç güncelleme hatası üretir, pencereyi aktive eden fallback yoktur. [Araştırma ve uygulama ayrıntıları](SPOTIFY.md).

DMG: `src-tauri/target/release/bundle/dmg/Deskody_0.1.11_aarch64.dmg`

SHA-256: `24485a072c4261a3f8773e5c33559e9a17187f441916c7047749c1cc7eaf539c`

---

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
