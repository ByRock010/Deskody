# Windows test paketi

Paket `Deskody-<version>-Windows-x64-test.zip` adıyla `dist-releases/` altında üretilir. Kurulum EXE'si, Chrome/Edge için paketlenmemiş Deskody Bridge klasörü, Türkçe kurulum rehberi, test sonuç formu, build bilgisi ve SHA-256 listesi içerir. Kullanıcı profilleri ve eşleştirme anahtarları eklenmez.

## Windows veya GitHub Actions üzerinde

```sh
npm ci
npm run check
npm run bundle -- --bundles nsis
python scripts/package-windows-test.py
```

`.github/workflows/build.yml` Windows job'u kurulumdan sonra aynı ZIP'i üretir ve artifact olarak yükler. `scripts/run.mjs`, Tauri'nin JavaScript giriş noktasını `process.execPath` üzerinden başlatır; önceki `.cmd` + shell yolunun Windows'ta oluşturduğu `"node" is not recognized` hatası giderildi.

Başka dizindeki bir x64 kurulum dosyası için:

```sh
python scripts/package-windows-test.py --installer path/to/Deskody_0.1.11_x64-setup.exe
```

## Mac'te çapraz derleme

[Tauri'nin dağıtım belgesi](https://v2.tauri.app/distribute/windows-installer/) Windows/MSVC üzerinde derlemeyi tercih eder; Mac'te NSIS ile çapraz paketleme de mümkündür. Bu test paketi MinGW/GNU hedefiyle üretildiğinde build bilgisinde `x86_64-pc-windows-gnu` açıkça kaydedilir. GNU hedefinde WebView2Loader.dll gibi ek DLL'ler kurulum içeriğinde ayrıca doğrulanmalıdır. Çapraz derleme, Windows masaüstü çalışma testi yerine geçmez.

```sh
brew install mingw-w64 nsis
rustup target add x86_64-pc-windows-gnu
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc \
AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar \
npm run bundle -- --target x86_64-pc-windows-gnu --bundles nsis
python3 scripts/package-windows-test.py \
  --installer src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/Deskody_0.1.11_x64-setup.exe \
  --target x86_64-pc-windows-gnu
```

Geliştiricinin mevcut Mac'inde Rust hedefi proje içindeki `.tools/cross` sysroot'unda bulunuyorsa ayrıca `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="--sysroot $PWD/.tools/cross"` gerekir; standart rustup kurulumu bunu gerektirmez.

Arkadaşınıza yalnızca son ZIP'i iletin; ZIP içindeki `ONCE-BENI-OKU.txt` uygulama ve eklenti kurulumunu anlatır. Windows Spotify URI başlatma sınırı ve test kapsamı bu rehberde belirtilir. Test sonucu `TEST-SONUCLARI.txt` ile geri iletilebilir.
