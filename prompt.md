**[GÖREV VE ROL]**
Sen, çapraz platform (cross-platform) sistem programlama, Rust ve React tabanlı masaüstü uygulama mimarileri (Tauri) konusunda uzmanlaşmış kıdemli bir yazılım mimarısın. Amacımız; kullanıcının aktif olarak kullandığı uygulamaya veya tarayıcı sekmesine duyarlı, arka plandaki müziği ve odak modunu otonom yöneten, macOS öncelikli ancak Windows ve Linux'ta da kusursuz çalışan, yüklenebilir bağımsız bir menü çubuğu (system tray) uygulaması geliştirmek.

**[KULLANICI BAĞLAMI]**
Bilgisayar Mühendisliği son sınıf öğrencisiyim ve profesyonel olarak full-stack yazılım geliştirme süreçlerinde yer alıyorum. Temel programlama kavramlarını, React hook'larının nasıl çalıştığını veya Rust'ın sahiplik (ownership) modelini açıklamakla vakit kaybetme. Doğrudan mimari kararları, uç durum (edge-case) çözümlerini ve üretime hazır (production-ready) kod bloklarını sun.

**[TEKNOLOJİ YIĞINI]**
*   **Çekirdek/Backend:** Tauri v2, Rust
*   **Frontend:** React, TypeScript, Tailwind CSS
*   **İşletim Sistemi Entegrasyonları (OS-Specific Adapters):**
    *   *macOS (Birinci Öncelik):* `osascript` (AppleScript/JXA), Accessibility API, `CGEvent`, MPRemoteCommandCenter.
    *   *Windows:* Win32 API (`GetForegroundWindow`, `UIAutomation`), `Windows.Media.Control`.
    *   *Linux:* X11/Wayland API, MPRIS (D-Bus).

**[MİMARİ VE ÇEKİRDEK GEREKSİNİMLER]**
1.  **Çoklu Platform Sensör ve Modül Katmanı (Rust):**
    *   Uygulama arka planda minimum RAM ve CPU tüketerek aktif pencereyi dinlemelidir.
    *   Rust tarafında koşullu derleme (`#[cfg(target_os = "...")]`) kullanılarak modüler bir `trait` (interface) yapısı kurulmalıdır. Her işletim sistemi, aktif pencereyi (tarayıcı ise aktif sekmeyi ve URL'yi/Dosya adını) bulmak için kendi yerel API kütüphanesini çağıran bir adaptöre sahip olmalıdır.
2.  **Kural Motoru (Rule Engine):**
    *   Öncelik hiyerarşisine dayalı dinamik bir yapı kurulmalıdır.
    *   *Kesici Kurallar (En Yüksek Öncelik):* URL'de `youtube.com/watch` veya `netflix.com` varsa ya da sistemde başka bir medya sesi aktifse müziği durdur (pause).
    *   *Bağlam Kuralları:* Aktif uygulama VS Code, Terminal veya Xcode ise kullanıcının belirlediği "Kodlama" müziklerini başlat. Açılan dosya bir PDF ise "Ders Çalışma" listesini başlat.
3.  **Medya Kontrolcüsü:**
    *   **Spotify:** macOS için AppleScript, diğer işletim sistemleri için yerel API'ler veya Spotify Web API entegrasyonu üzerinden yönetilecek.
    *   **YouTube Music (PWA) / Diğer:** İşletim sisteminin native medya tuşlarını (Play/Pause) simüle eden Rust tabanlı, işletim sistemine özel sanal tuş çağrıları kullanılacak.
    *   **Geçişler:** Ani ses patlamalarını önlemek için müzik değiştirilirken veya durdurulurken ses seviyesi manipülasyonu ile yumuşak geçişler (fade-in / fade-out) sağlanmalıdır.
4.  **Frontend Arayüzü ve Sistem İzinleri:**
    *   Uygulama menü çubuğunda (system tray) çalışacak.
    *   Kullanıcıların kendi kurallarını eşleştirebileceği şık, minimalist bir React arayüzü olacak.
    *   Her işletim sistemine özel (macOS Accessibility, Windows Admin vb.) gizlilik izinlerini doğru şekilde tetikleyen ve yöneten bir güvenlik akışı kurulacak.

**[ÇIKTI BEKLENTİSİ]**
Bu projenin tamamını uçtan uca (macOS için .app/.dmg, Windows için .exe, Linux için .deb/.AppImage formatlarında derlenebilecek şekilde) hayata geçirmek için gereken tüm mimariyi, dizin yapısını ve çekirdek kod bileşenlerini oluştur. Projeyi hangi fazlara böleceğine ve hangi sırayla inşa edeceğimize sen karar ver. Sadece mimariyi planlamakla kalma; Rust tarafındaki OS soyutlama (trait) yapısını, koşullu derleme bloklarını ve React ile Rust'ın Tauri üzerinden haberleştiği IPC (Inter-Process Communication) bridge yapılarını eksiksiz, kopyala-yapıştır yapılabilecek kalitede sun.