# Deskody

**English** | [Türkçe](README.tr.md)

Music that follows your focus. Deskody is a macOS-first menu bar app built with Tauri v2, Rust and React/TypeScript, with Windows and Linux adapters. It follows your active application, document or browser tab and applies your music rules. Closing the main window keeps Deskody running; **Quit** in the menu bar exits it.

## Language

Deskody starts in **English** by default, independently of the operating system language. Choose **Settings → Language → App language → Türkçe** to use Turkish. In Turkish, the same setting is **Ayarlar → Dil → Uygulama dili**.

Your choice is saved immediately and remembered across restarts. The main window and quick controls update together. Changing language does not interrupt music or save unrelated unfinished settings. User-created rule names, application names and track metadata stay as entered. Settings from older versions without a language preference default to English and retain existing rules.

The **English / Türkçe** links above switch between the two README files on GitHub.

## Development

Requirements: Node.js 22+, Rust 1.91+, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
npm ci
npm run desktop
```

Use `npm run dev` for a browser-only UI preview. The preview cannot control music; it stores draft settings in its own `localStorage`.

`scripts/run.mjs` finds the standard Rust installation on PATH. On macOS it uses the installed Command Line Tools, respecting an explicit `DEVELOPER_DIR`. It uses `.tools/cargo` when that project cache exists; fresh installations use the normal Cargo cache.

## Getting started

1. Open the Spotify desktop app, sign in and select a track, or set up YouTube Music using the browser extension below.
2. Open **Settings → System permissions** and grant macOS Accessibility access. Approve Automation requests for the selected player/browser. Refresh after changing permissions; macOS may require restarting Deskody.
3. In **My rules**, choose the applications or document/browser condition, action and optional music link. **Apply rule** saves immediately. Rule switches and deletion also save immediately; general settings and imported rules use **Save changes**.
4. Enable automation in **Overview** or the menu bar. It is off by default.

An empty music link resumes the selected player's current music. Starter rules cover PDF documents, VS Code, Terminal, Xcode and Windows Terminal. Match your own playlists to these rules or create new ones.

**Music link** accepts Spotify tracks, playlists and albums, plus YouTube Music songs, playlists, radio and mixes. Links are only used with their matching music source. Deskody controls the selected player; it does not silently switch to YouTube Music when Spotify is closed.

The rule status area shows the latest work application, its identifier, document/tab details, controlled player and last rule event. This diagnostic context stays in memory. VS Code aliases such as `Code`, `Code.exe` and `com.microsoft.VSCode` are recognized.

### Select multiple applications

In the rule editor, choose **Applications**, search the installed applications and select one or more checkboxes. A rule for **Visual Studio Code + Preview** uses the same music in both. Switching between selected applications does not restart an unchanged playlist. Pause rules and other-media interruptions keep their priority.

The application catalogue is read when opening or refreshing the picker, without launching applications or requesting additional Accessibility/Admin access:

- macOS: bundles in `/Applications`, `/System/Applications` and `~/Applications`.
- Windows: Start menu executable shortcuts and App Paths.
- Linux: XDG `.desktop` entries.

Portable programs outside standard locations and some Windows Store applications may be missing. Add the last detected application or enter an identifier manually. Rules support 1–64 selected applications; missing/uninstalled applications are not automatically removed from existing rules. Legacy single-application rules remain supported.

## Quick controls

On macOS, Deskody uses a native **NSStatusItem → NSMenu**. macOS supplies the background, glass/transparency, light/dark appearance, shadow, status icon highlight and fullscreen menu bar behavior. Controls use `NSSwitch`, SF Symbols, system fonts and semantic colors. The main app's green theme is not applied to this menu. macOS 26 uses its current native menu appearance; earlier versions use theirs.

Toggle automation or individual rules, play/pause, return to automation after manually pausing, inspect errors, refresh or quit without opening the main window. Turning automation off leaves current music playing. Rule changes made while it is off are saved for later. Long rule lists scroll inside the menu. **Open Deskody** opens the main app explicitly.

The macOS menu works in other Spaces and over fullscreen applications without activating Deskody. If the menu bar is hidden, move the pointer to the top of the screen. No webview is created for macOS quick controls. Windows and Linux use the React quick panel; Linux opens it from the tray menu's **Quick controls** item because tray click events are unavailable there. See [Tauri tray behavior](https://v2.tauri.app/learn/system-tray/).

The main window opens on first installation. With saved settings, later launches start in the menu bar. Reopening the app from Finder brings up the main window. Quick changes synchronize with the main window while preserving unrelated unsaved edits; opening Deskody does not replace the last external work context.

## Platform capabilities

| Capability | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Active application/window | NSWorkspace + AX | Win32 + UIAutomation | X11/EWMH, Sway, Hyprland |
| Browser URL | Safari/Chromium JXA or extension | UIAutomation or extension | Extension |
| Spotify play/pause | AppleScript/JXA | GSMTC | MPRIS |
| Start Spotify content | Spotify's bundled CLI or Web API | **Web API required** | MPRIS OpenUri when supported, or Web API |
| Other players | Apple Music; YouTube Music extension | Selected GSMTC session; YTM extension | Selected MPRIS session; YTM extension |
| Volume fades | Spotify/Apple Music player volume | Spotify WASAPI session | MPRIS Volume when supported |
| Other media detection | CoreAudio output processes on macOS 14.2+ | WASAPI peak meter + GSMTC | MPRIS playback state |
| Manual media key | CGEvent system media event | SendInput | X11 XTest; limited on Wayland |

The browser extension detects other audible tabs and YouTube Music playback on all platforms. A global media toggle is sent **only by an explicit user command**, never as an autonomous pause with an unknown target/state.

### Platform limits

- Generic Wayland does not expose all active windows/URLs. Sway and Hyprland adapters are provided; application rules are unavailable on GNOME/KDE Wayland. Foreground browser rules can use the extension. XWayland data is not treated as a complete view of Wayland windows.
- macOS 12–14.1 lacks general CoreAudio process detection. On 14.2+, `IsRunningOutput` may include silent open streams; it does not guarantee audible sound. Audio samples are not recorded.
- Linux does not meter raw non-MPRIS system audio. Windows WASAPI checks the default multimedia output; non-GSMTC audio on another device may be missed.
- When the YTM extension player is selected, native browser audio sessions are excluded to avoid interrupting itself. The extension detects other audible browser tabs. One paired browser profile is supported at a time; with multiple YTM tabs, the first selected/playing one is retained.
- Fade duration is a target, subject to AppleScript, D-Bus, browser and network latency. System master volume is never changed. Unsupported players receive direct play/pause.
- `MPRemoteCommandCenter` receives commands for your own application; it is not a general controller for other apps. See [Apple's documentation](https://developer.apple.com/documentation/mediaplayer/remote-command-center-events).
- Deskody does not require Windows administrator access. Windows may restrict UIAutomation access to elevated applications.
- “Focus” refers to music automation, not the OS notification/Do Not Disturb setting.

## Spotify desktop playback

On macOS, Spotify track, playlist and album links work without Premium, a Developer Client ID or an extension. Shared `?si=...` parameters are accepted. Spotify must already be running and signed in.

Deskody starts content using the running Spotify app's bundled `spotify_cli`. It identifies the local Spotify session, transfers playback to this Mac if another device is active, then starts the requested content. It does not use the older AppleScript `play track` command or focus-restoration workarounds. Pause, resume and volume still use AppleScript.

Spotify must be up to date and include this helper (verified client: 1.2.99.317). If unavailable, Deskody asks you to update Spotify instead of falling back to a method that activates its window. Spotify's account, advertising and content restrictions still apply. See [implementation research and test limits](docs/SPOTIFY.md).

### Optional Spotify Web API

Not needed for native macOS playback. On Windows, use it to start a specific track/playlist/album: GSMTC controls the existing session but cannot select content.

1. Create a Spotify Developer application and meet its account/application access requirements.
2. Register exactly `http://127.0.0.1:43828/callback` as the redirect URI.
3. Enable **Spotify Web API** in Settings, enter the Client ID and save. No client secret is used.
4. Connect your Spotify account and authorize in the system browser.
5. Select and save this computer's Spotify device. Play a track first if the device is missing.

The implementation uses PKCE S256, random OAuth state, a single two-minute loopback callback, HTTPS, token refresh and HTTP 429 `Retry-After`. Tokens are stored in macOS Keychain / Windows Credential Manager / Linux Secret Service, never in settings JSON or IPC. Linux needs an unlocked Secret Service such as GNOME Keyring/KWallet. Disconnecting removes local credentials; revoke account-side access separately in Spotify if needed.

Spotify's playback Web API requires Premium and application access. Real account/network testing requires authorization. References: [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [playback API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback), [redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

## Browser extension and YouTube Music

```sh
npm run extension:build
```

- Chrome/Edge/Brave: `chrome://extensions` → Developer mode → Load unpacked → `dist-extensions/chromium`.
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist-extensions/firefox/manifest.json`. Persistent distribution needs Mozilla signing.
- Enable and save **Browser bridge** in Deskody. Reveal the pairing key and copy it into the extension options.
- Refresh `music.youtube.com`, manually play once, then choose **Other players → YouTube Music · browser extension** in Deskody.

Paste a YouTube Music link into a rule, for example:

```text
https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg
https://music.youtube.com/watch?v=LkoXilp7FPY
https://music.youtube.com/playlist?list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg
https://music.youtube.com/watch?v=LkoXilp7FPY&start_radio=1
```

Playlist, mix and radio ordering is determined by YouTube Music. Deskody uses the existing tab/PWA and its in-page navigation without bringing it forward or triggering “Leave app?” by replacing the page. Volume transitions and playback verification use the media element's elapsed time. On failure, volume is restored; an acknowledgement timeout does not automatically pause an already playing track. Explicit cancellation stops a pending operation.

A content command waits up to 16 seconds for acknowledgement. New playback/settings/quit commands cancel a pending transition; changing only the display language does not. New context scanning resumes after the transition. If autoplay is blocked, manually play once and retry. YouTube Music DOM changes may require updating playlist-page extraction; direct `watch` links avoid that step.

After updating extension files, click **Reload** in the browser extension manager and refresh the YTM tab/PWA. Pairing is retained. You do not need to change the macOS language or Apple Events JavaScript settings.

### Bridge privacy

The extension uses `tabs`, `storage`, `alarms` and loopback access. A small HTTP(S) heartbeat script keeps MV3 connectivity alive without reading page content. `music.js` accesses media only on `music.youtube.com`. Incognito tabs, URL queries/fragments and browsing history are not sent as detected context. User-provided playback links are separate commands with only necessary parameters (`v`, `list`, `start_radio`, `index`, `params`). System audio is not recorded.

The bridge listens only on `127.0.0.1:43827`. Requests are limited to 16 KiB; Host, Origin and constant-time Bearer authentication are checked. Context expires after eight seconds. Web pages receive no CORS access. The pairing key has user-only file permissions, which are not a substitute for OS isolation against malicious processes running as the same user.

## Packaging

Build on each target operating system:

```sh
# macOS: .app and .dmg
npm run bundle -- --bundles app,dmg

# Windows: NSIS .exe
npm run bundle -- --bundles nsis

# Linux: .deb and .AppImage
npm run bundle -- --bundles deb,appimage
```

Outputs are in `src-tauri/target/release/bundle/`. `CI=true` skips the DMG Finder-layout script for unattended macOS builds. Linux AppImage builds can use `APPIMAGE_EXTRACT_AND_RUN=1`. `.github/workflows/build.yml` tests, lints and packages on three native runners, uploading artifacts without publishing a release. See also [Windows build instructions](docs/WINDOWS-BUILD.md).

For Intel/universal macOS distribution, install the Rust targets and run `npm run bundle -- --target universal-apple-darwin --bundles app,dmg`. Local builds are ad-hoc signed, without Developer ID or notarization. Set `bundle.macOS.signingIdentity` to your own Developer ID and configure signing/notarization credentials in CI secrets; do not commit keys. References: [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/).

## Architecture

```text
src/                         React UI and typed IPC client
  App.tsx                    Dashboard, rules, settings, activity
  TrayPanel.tsx              Windows/Linux quick controls
  i18n.ts                    Shared language store and presentation translation
  bridge.ts                  invoke + listen; isolated web preview
  settings.ts                Import and form validation
locales/en.json               Shared English catalogue (Turkish source keys)
src-tauri/src/
  model.rs                   IPC/data contracts, persisted language
  i18n.rs                    Native presentation translation
  platform/mod.rs            Platform trait and cfg selection
  platform/macos.rs          JXA player and browser adapter
  platform/windows.rs        Win32, UIAutomation, GSMTC, WASAPI
  platform/linux.rs          X11, compositor, MPRIS
  engine.rs                  Priority engine and monotonic debounce
  media.rs                   Playback ownership, manual override, fades
  runtime.rs                 Serial queue, snapshots, cancellation, retry delay
  config.rs                  Validation, atomic storage, playback URL validation
  browser.rs                 Paired loopback bridge and YTM adapter
  spotify.rs                 OAuth/PKCE, credential storage, Spotify Web API
  spotify_desktop.rs         macOS Spotify CLI playback and device selection
  desktop.rs                 Tauri commands, tray and window lifecycle
src-tauri/native/menu.m       Native macOS menu
src-tauri/native/macos.m      Cocoa/AX/CoreAudio FFI
browser-extension/           Extension sources
scripts/package-extension.mjs Chromium and Firefox packaging
tests/                       Playwright flows and native integration tests
docs/ARCHITECTURE.md          Architecture decisions and operational limits
```

## Verification

```sh
npm run check
npm run test:rust
npx playwright install chromium
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# macOS GUI session; uses temporary test windows, no user settings or music
python3 scripts/test-native-menu.py
```

Tests cover rule priority, deceptive domains, PDFs, debounce, volume restoration, manual pause, playlist resumption, PKCE, bridge authentication, rule editing/import, application selection, tray IPC, language persistence and switching without restarting playback. Native menu tests cover the current Space and another application's fullscreen Space.

Real accounts, macOS TCC permissions and physical Windows/Linux desktop sessions require acceptance testing on those systems. Cross-compilation does not verify runtime or installer behavior.

## Settings, privacy and compatibility

Settings use the OS application configuration directory under `dev.musicoptimizer.desktop`. `DESKODY_CONFIG_DIR` selects a separate directory for testing; legacy `MUSIC_OPTIMIZER_CONFIG_DIR` remains supported with lower precedence. OAuth credentials are stored separately in the OS credential store.

Writes use a temporary file, fsync and atomic replacement. Corrupt or unknown-version settings are not silently deleted: automation starts disabled with an error, and saving replaces the file. Up to 100 rules are accepted. Only the latest 40 activity events are kept in memory; active window titles and sanitized URLs are not written to disk. With Spotify Web API disabled, Deskody has no feature that sends data to a cloud service.

The app is **Deskody**, the extension **Deskody Bridge**, the macOS bundle `Deskody.app` and executable `deskody`. The displayed version comes directly from `package.json`. Legacy bundle identifiers, configuration paths, Spotify keyring service, Firefox extension ID and internal bridge events are intentionally retained so existing permissions, settings and pairing survive updates.
