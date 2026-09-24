# Deskody — agent guide

Read this file before changing the project. It applies to the whole repository.
Keep it concise and accurate so a new session can work without previous chat history.

## Start here

1. Read `git status --short`; preserve existing user changes.
2. Read this guide, then the relevant source files and tests from the map below.
3. Check [README.md](README.md) for current product behavior and setup. Read deeper docs only for the area being changed.
4. Implement the requested scope, run relevant checks, and update affected documentation before finishing.

Treat implementation and current tests as the source of truth. Older sections in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/VALIDATION.md](docs/VALIDATION.md)
include historical behavior and test results; they are not proof of the current build.
[prompt.md](prompt.md) is the original brief, not a description of everything implemented.
If documentation conflicts with code, investigate and correct it rather than copying the discrepancy.

## Product and stack

- **Deskody**: local-first music automation based on the active app, document or browser tab. The extension is **Deskody Bridge**.
- macOS is the primary platform; Windows and Linux have separate native adapters. Do not assume macOS fixes apply to them.
- Tauri v2, Rust, React, TypeScript, Vite, Tailwind/CSS; Node.js 22+ and Rust 1.91+.
- A background worker owns automation. Closing the main window hides it; quitting shuts down the worker. Existing installations normally start in the tray.
- Main UI: English by default, Turkish selectable and persisted. README defaults to English with a Turkish link.
- Prefer Turkish when communicating with this project's owner, unless requested otherwise. Keep code identifiers and this contributor guide in English.

## Source map

| Area | Entry points and responsibilities |
| --- | --- |
| React entry | [src/main.tsx](src/main.tsx): main app or `?panel=tray` |
| Main interface | [src/App.tsx](src/App.tsx): overview, rule editor, settings, activity |
| Application picker | [src/ApplicationPicker.tsx](src/ApplicationPicker.tsx); native discovery in [src-tauri/src/applications.rs](src-tauri/src/applications.rs) |
| Windows/Linux quick panel | [src/TrayPanel.tsx](src/TrayPanel.tsx), [src/tray.css](src/tray.css) |
| Main styling/assets | [src/style.css](src/style.css), [assets/icon.svg](assets/icon.svg), `src-tauri/icons/` |
| Frontend IPC/types | [src/bridge.ts](src/bridge.ts), [src/types.ts](src/types.ts) |
| Rule forms/import/defaults | [src/settings.ts](src/settings.ts); backend equivalents in model/config below |
| Localization | [locales/en.json](locales/en.json), [src/i18n.ts](src/i18n.ts), [src-tauri/src/i18n.rs](src-tauri/src/i18n.rs) |
| Desktop lifecycle/IPC/tray | [src-tauri/src/desktop.rs](src-tauri/src/desktop.rs) |
| Native macOS menu | [src-tauri/native/menu.m](src-tauri/native/menu.m), [src-tauri/native/menu.h](src-tauri/native/menu.h) |
| Runtime coordination | [src-tauri/src/runtime.rs](src-tauri/src/runtime.rs): `Service`, serial command queue, snapshots, cancellation, quick changes |
| Shared Rust contracts | [src-tauri/src/model.rs](src-tauri/src/model.rs): `Settings`, `Rule`, `Matcher`, `Action`, `Status`, `Language` |
| Rule decisions | [src-tauri/src/engine.rs](src-tauri/src/engine.rs): pure evaluation, priorities, `Gate` debounce |
| Media transitions | [src-tauri/src/media.rs](src-tauri/src/media.rs): controller ownership, manual override, fades/restoration |
| Config/validation | [src-tauri/src/config.rs](src-tauri/src/config.rs): atomic storage and music target validation |
| OS abstraction | [src-tauri/src/platform/mod.rs](src-tauri/src/platform/mod.rs): `Platform` trait, target selection via `cfg` |
| OS implementations | [macos.rs](src-tauri/src/platform/macos.rs), [windows.rs](src-tauri/src/platform/windows.rs), [linux.rs](src-tauri/src/platform/linux.rs) |
| macOS FFI/processes | [src-tauri/native/macos.m](src-tauri/native/macos.m), [src-tauri/src/process.rs](src-tauri/src/process.rs), [src-tauri/build.rs](src-tauri/build.rs) |
| Spotify macOS content playback | [src-tauri/src/spotify_desktop.rs](src-tauri/src/spotify_desktop.rs), [src-tauri/native/spotify.m](src-tauri/native/spotify.m) |
| Optional Spotify Web API | [src-tauri/src/spotify.rs](src-tauri/src/spotify.rs): OAuth/PKCE, devices, credential storage |
| Browser bridge | [src-tauri/src/browser.rs](src-tauri/src/browser.rs): authenticated loopback service and remote media adapter |
| Extension | [browser-extension/background.js](browser-extension/background.js): MV3 coordination; [music.js](browser-extension/music.js): isolated content bridge; [music-page.js](browser-extension/music-page.js): YTM page adapter |
| Extension targets/options | [media-target.js](browser-extension/media-target.js): URL validation; [options.js](browser-extension/options.js) and [options.html](browser-extension/options.html): pairing UI; [manifest.json](browser-extension/manifest.json): permissions/version |
| Tauri security/bundles | [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json), [src-tauri/capabilities/main.json](src-tauri/capabilities/main.json), [Info.plist](src-tauri/Info.plist), [Entitlements.plist](src-tauri/Entitlements.plist) |
| Build/release helpers | [scripts/run.mjs](scripts/run.mjs), [scripts/package-extension.mjs](scripts/package-extension.mjs), [scripts/package-windows-test.py](scripts/package-windows-test.py) |
| CI | [.github/workflows/build.yml](.github/workflows/build.yml): native macOS/Windows/Linux checks and installer artifacts; does not publish releases |

`src-tauri/native/panel.m` and its test helper describe an earlier macOS NSPanel approach.
The current production macOS quick controls use **NSStatusItem → NSMenu**, not that panel or a React webview.

## Data flow and contracts to preserve

`React → bridge.ts invoke → desktop.rs → Service command queue → runtime worker → engine/media → Platform or browser bridge`.
The worker publishes `Snapshot { settings, status, permissions, players }` through `deskody://status`.
The native macOS menu invokes the same service and receives a private JSON snapshot with translations.

- Keep Rust serde contracts, TypeScript types, IPC callers and fixtures aligned. Register new commands in `desktop.rs`; do not grant broad shell/filesystem capabilities to the frontend.
- The serial worker owns native handles and media decisions. Avoid blocking OS/network work in React or on the AppKit main thread; AppKit UI work belongs on the main thread.
- Quick changes operate on **current committed settings**, not an old full snapshot. Publish committed state before acknowledging a successful save. Preserve unrelated dirty forms in the main window.
- Settings writes are validated and atomic. Do not silently replace corrupt configs or erase users' rules to fix a migration.
- `Settings.language` is `en | tr`; absent legacy fields default to `en`. Language changes use `QuickChange::Language`, preserving cancellation generation, playback ownership and gate state.
- Turkish source strings are catalogue keys in `locales/en.json`; English values are shared by React and native presentation. Add both language paths for new UI/errors. Do not translate rule names, app identifiers/names, URLs or track metadata. Use structured playback activity for translating system reasons/actions separately from user data.

## Behavior that must not regress

- Automatic music changes and quick controls must not activate Spotify, YouTube Music or Deskody, or move the user to another Space. Only an explicit open-main action should bring up the main window.
- macOS quick controls use system appearance, SF Symbols and native switches, including fullscreen Spaces. Changing React tray styles alone does not change this menu. Tauri's `~2.11` constraint relates to its native tray access; review that integration before upgrading.
- Control only the selected player. Never substitute an ambiguous global play/pause toggle for an autonomous pause. Disabling automation leaves current music playing.
- Other-media/video interruptions and user pause rules precede play rules. Exclude YouTube Music's own playback from self-interruption. Higher priority wins within an action category; rule ID breaks ties.
- Multiple applications in one rule use OR matching. Switching between those apps or resuming the same playlist after an interruption must not restart unchanged content.
- Respect manual pause until context changes or the user resumes automation. Restore player volume on transition error/cancellation; never manipulate system master volume as a fade fallback.
- macOS Spotify content starts through the running Spotify app's bundled `spotify_cli`; pause/resume/volume use JXA. No Premium, extension or Web API is required for this local route. Do not reintroduce AppleScript `play track`, URL-opening or focus-stealing fallback behavior. See [docs/SPOTIFY.md](docs/SPOTIFY.md).
- Windows GSMTC controls the existing Spotify session but cannot select tracks/playlists: that feature currently requires Web API. Linux depends on MPRIS capabilities. Do not claim macOS parity without implementation and platform evidence.
- YouTube Music uses the paired extension and in-page SPA navigation. Do not restore `tabs.update({url})`, full-page navigation or window/tab activation: they caused the leave-app prompt and focus loss.
- YTM success requires actual playback progress, not just a matching URL or `play()` call. Preserve bounded acknowledgement, cancellation and volume/mute recovery. Do not automatically pause already-playing music merely because an acknowledgement timed out.
- Unsupported OS/permission/player capabilities must remain explicit. Generic GNOME/KDE Wayland app detection is not implemented; Sway/Hyprland and X11 have adapters.

## Configuration, privacy and compatibility

- Preserve the legacy bundle/config identity **`dev.musicoptimizer.desktop`**, keyring service, Firefox extension identity and internal page events. Branding is Deskody; renaming these storage/OS identities can lose permissions, pairing or settings.
- `DESKODY_CONFIG_DIR` overrides the app config directory; legacy `MUSIC_OPTIMIZER_CONFIG_DIR` is the fallback. Use an isolated directory for tests. OAuth credentials remain in the OS credential store independently of this override.
- Browser bridge: `127.0.0.1:43827`, paired Bearer authentication, Host/Origin validation, bounded requests and expiring context. Spotify OAuth callback: `http://127.0.0.1:43828/callback`.
- Never commit or print real pairing keys, OAuth tokens, account responses or personal settings. Browser context URL sanitization is separate from explicit user-provided playback targets.
- `npm run dev` is a UI preview: no real OS/media control. Its settings live in `deskody-preview-v1` localStorage, with legacy key compatibility; they are not desktop settings.
- `.tools/`, `node_modules/`, `dist/`, `dist-extensions/`, `dist-releases/`, `src-tauri/target/` and test outputs are ignored/generated. Do not depend on a developer's `.tools/` contents being present in a clean clone.

## Commands and verification

Run from the repository root. `scripts/run.mjs` locates Rust, optionally uses the project Cargo cache and configures macOS Command Line Tools. Prefer it when `cargo` is not on PATH.

```sh
npm ci
npm run desktop                         # Real Tauri app
npm run dev                             # Browser-only preview, port 1420
npm run check                           # TypeScript/Vite + Vitest
npm run test:rust                       # Core Rust tests, no desktop feature
node scripts/run.mjs cargo fmt --manifest-path src-tauri/Cargo.toml --check
node scripts/run.mjs cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npx playwright install chromium
npm run test:e2e
npm run extension:build
```

Use `CARGO_NET_OFFLINE=true` only when dependencies are already cached. If browser binaries are in `.tools/playwright`, set `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright"` consistently for installation and testing. The extension test needs full Chromium, not only the headless shell.

| Changed area | Relevant checks |
| --- | --- |
| UI/rule editor/application picker | `npm run check`; `tests/app.spec.ts` |
| Localization/persistence | `src/i18n.test.ts`, `tests/language.spec.ts`; Rust config/runtime tests |
| Quick controls/IPC | `tests/tray.spec.ts`; Rust runtime tests; on macOS `python3 scripts/test-native-menu.py` |
| Rules/fades/URL validation | `npm run test:rust`; shared corpora in `tests/fixtures/`; frontend validation tests |
| Browser extension/YTM | `npm run extension:build`; `tests/extension.spec.ts`; real account/PWA acceptance when applicable |
| macOS Spotify | Rust Spotify tests; `python3 scripts/test-native-spotify.py` |
| OS adapters/build config | Full desktop Clippy/build for affected OS; cross-checks are useful but do not prove runtime behavior |

Playwright starts Vite automatically. A focused run is `npm run test:e2e -- tests/language.spec.ts`.
Native menu tests need a logged-in macOS GUI session and briefly create fullscreen fixtures.
The Spotify test's optional `--live` mode changes real playback; use it only within the user's authorized scope and report its limits.
For documentation-only changes, check referenced paths/commands and `git diff --check`; do not rebuild or reinstall the app unnecessarily.

## Packaging and versions

```sh
npm run bundle -- --bundles app,dmg       # macOS
npm run bundle -- --bundles nsis          # Windows
npm run bundle -- --bundles deb,appimage  # Linux
python3 scripts/package-windows-test.py  # Built x64 installer + clean extension ZIP
```

- Default output: `src-tauri/target/release/bundle/`; explicit Rust targets add a target-name directory. Tester ZIPs go to `dist-releases/`.
- macOS unattended builds can use `CI=true` to skip the DMG Finder-layout script.
- See [docs/WINDOWS-BUILD.md](docs/WINDOWS-BUILD.md) for native Windows and macOS MinGW cross-build instructions. Pass `--installer` explicitly if multiple versions exist, and `--target` when not MSVC. Local `.tools/cross` sysroots are machine-specific, not a project prerequisite.
- Read the current app version from `package.json`. When releasing, keep it aligned with the root package entries in `package-lock.json`, the Deskody package in `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. UI version labels derive from `package.json`.
- Extension version is independent in `browser-extension/manifest.json`. Change it when shipping extension changes; regenerate extension output instead of editing generated manifests.
- Local macOS bundles are ad-hoc signed, not Developer ID notarized. Building a DMG does not prove that another Mac will accept it. Likewise, successful cross-compilation is not a Windows install/runtime test.
- When an installation update is part of the task, preserve user settings/pairing, back up the previous app and verify the installed version. Do not assume an ignored installer helper exists on another machine.

## Keep this guide current — required maintenance

Before finishing an implementation, review whether it changes this guide. Update it in the **same change** when files move, IPC/schema changes, commands/dependencies change, architecture or platform support changes, or a regression establishes a new invariant. No need to edit it for an unrelated cosmetic change.

- Replace obsolete statements in place; keep one concise description of the current design. Put detailed rationale in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), Spotify research in [docs/SPOTIFY.md](docs/SPOTIFY.md), and dated test evidence/limitations in [docs/VALIDATION.md](docs/VALIDATION.md).
- Update [README.md](README.md) and [README.tr.md](README.tr.md) together when user-facing instructions or behavior change; preserve their language-switch links.
- Avoid duplicating volatile version numbers, test counts, artifact hashes or machine paths here; link to their authoritative files instead. Historical test evidence must remain dated and must not be presented as a new test run.
- If genuinely unfinished work must be handed off, record a short, explicit note with affected files, evidence, blocker and next action; remove it once resolved. Never store credentials or private user data in handoff notes.
- Keep [CLAUDE.md](CLAUDE.md) as a pointer to this file rather than maintaining a second, drifting copy of the guide.

This is a repository instruction maintained during work, not a background synchronization service. Future agents must verify it against the current checkout and update it when their work changes these facts.
