# Deskody Notch

macOS native hover media controls, implemented in `src-tauri/native/notch.m` and
`notch.h`. The regular NSStatusItem → NSMenu remains available. Windows/Linux do
not create a notch window; their existing quick panel is unchanged.

## Interaction and visual design

- A compact black silhouette joins the physical camera notch, with a small cover
  and decorative playback indicator at its sides. The indicator represents playing
  state, not measured sound levels; Deskody does not record audio.
  `Show now playing when collapsed` defaults on. Turning it off hides both wings,
  restores the physical notch width and stops compact polling/decoration animation;
  hover-to-open remains available.
- Hover at the physical top edge or over the collapsed silhouette for 140 ms to expand.
  Explicit collapse stays closed until the pointer leaves and returns. Leaving its
  retention area starts a 380 ms close grace;
  returning cancels it. File dragging does not activate the collapsed notch. Seeking
  holds the panel open until mouse tracking completes. Seeking previews elapsed time
  continuously with a fixed total duration, then sends one command on release and
  retains its position until a fresh sample arrives (bounded to three seconds).
  The captured provider `displayDuration` labels the total when available; the precise
  `duration` still bounds the seek position. A provider label never extends the range.
- Expanded controls include artwork, title/artist/provider, timeline, previous/play/
  next, flow toggle, current rule and return-to-automation when manually paused.
  Explicit open-main and collapse actions sit outside the camera area.
- Original black silhouette, monochrome SF Symbols, restrained ambient shading,
  system typography and an interruptible, critically damped Core Animation path
  morph without overshoot (620 ms open / 520 ms close). Content and decorative wings
  crossfade in sequence, continuing from presentation values when interrupted.
  Expanded content adds 172 points below the camera header (210 for an error),
  reduced from the initial 230-point layout. Reduce Motion
  removes morph/decorative animation. Media errors have a bounded two-line row.
- `Settings → Deskody Notch` or the native menu's `Show notch` saves the preference
  immediately. Turning it off removes mouse monitors, the window and polling timers.

## AppKit integration

`NSPanel` is borderless/nonactivating and cannot become the key/main window.
It is never activated to handle media. Its collection behavior joins Spaces,
stays stationary and ignores window cycling. Fullscreen presentation is opt-in:
`notchFullscreen` defaults to false, including for legacy settings. AppKit collection
behavior uses `FullScreenNone` to opt out of other apps' fullscreen Spaces and
`FullScreenAuxiliary` when enabled. On macOS 13+ `CanJoinAllApplications` retains
Stage Manager support. Its deployment-version guard uses `NSProcessInfo` rather
than Clang `@available`, avoiding an availability-runtime symbol that the Rust
release linker does not supply. Changing fullscreen eligibility recreates only the NSPanel,
retaining the content views and shared service state: WindowServer retains the old
eligibility when merely changing an existing panel's collection behavior.
Space changes reconcile interaction/observation against
active-Space membership and recheck after the WindowServer transition settles. Sleep,
display sleep and session suspension stop observation; wake recomputes geometry
and restores the collapsed state. With fullscreen opt-in, Space changes retain the
same stationary panel and expansion state without reordering it; desktop-only mode
collapses controls and stops interaction outside desktop Spaces. WindowServer still
owns the compositing/animation of a physical Space swipe.

Public `NSScreen.safeAreaInsets` and `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`
measure the camera area in points. Choose a notched display when connected; otherwise
use the first screen and a virtual top-center silhouette. Screen-parameter changes
recompute placement, including clamshell/display reconnection. One notch host is
shown, rather than putting overlays on every monitor.

The window keeps a fixed canvas so Core Animation can morph its shape without
resizing a WindowServer surface every frame. Collapsed mode ignores all mouse events.
The panel overrides frame constraining to meet `screen.frame`'s physical top edge
rather than the menu bar's visible-frame boundary. Hover uses inclusive top-edge
coordinates and revalidates the actual pointer/button state before opening; a pointer
on an adjacent display above the host does not trigger it.
Global and local **mouse-only** NSEvent monitors detect hover without keyboard hooks
or additional Accessibility/Input Monitoring prompts. Expanded mode enables mouse
input only while the pointer lies in the visible shape; elsewhere it passes clicks
through. The decorative compact NSView always returns nil from `hitTest:`: this
allows crossfading above controls without intercepting their clicks. It is hidden
when the collapsed indicator preference is off. All local monitors return events intact.
The native menu provides the alternative keyboard-accessible route to media controls.

## Runtime ownership

The host receives coalesced snapshot delivery on the AppKit main thread. Its callback
uses the same `Service` serial queue as the main UI and native menu. Results return
only to the originating native surface, preventing a notch completion from clearing
an unrelated menu operation's busy state. Seek captures player/track identity and
uses existing fresh validation. Notch clicks never introduce native global toggles,
player URL opening or a separate playlist owner.

`Settings.notchEnabled` and `Settings.notchNowPlaying` default to true for new and
legacy settings; `Settings.notchFullscreen` defaults to false.
`QuickChange::Notch`, `QuickChange::NotchNowPlaying` and `QuickChange::NotchFullscreen` are
presentation-only: no cancellation generation, gate reset or ownership reset;
other unsaved main-window fields survive updates.

A visible compact indicator renews `ObserveCompact` every five seconds (12-second
lease); hiding it clears that lease in the worker and removes the native timer.
When automation is off, this polls media every three seconds so the compact cover
can follow playback. When automation is on, the faster configured poll is preserved.
Expanded controls renew the existing six-second fast lease and update position at
most one second apart. Only the expanded host runs a local progress timer; mouse
movement is event-driven. Artwork uses the existing bounded background cache. See
[MEDIA-CONTROLS.md](MEDIA-CONTROLS.md) for provider and artwork restrictions.

## Research and verification

Behavior inspiration: [Boring Notch](https://github.com/TheBoredTeam/boring.notch).
The implementation here is original AppKit code and reuses Deskody's existing media
engine. Relevant Apple APIs:

- [Nonactivating panel](https://developer.apple.com/documentation/appkit/nswindow/stylemask-swift.struct/nonactivatingpanel)
- [Screen safe area](https://developer.apple.com/documentation/appkit/nsscreen/safeareainsets)
- [Auxiliary camera-safe area](https://developer.apple.com/documentation/appkit/nsscreen/auxiliarytopleftarea-uglc)
- [Fullscreen and Stage Manager overlay participation](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)
- [Physical-edge window placement](https://developer.apple.com/documentation/appkit/nswindow/constrainframerect(_:to:))
- [Fullscreen auxiliary windows](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary)
- [Mouse event monitors and their scope](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/MonitoringEvents/MonitoringEvents.html)
- [Reduce Motion](https://developer.apple.com/documentation/appkit/nsworkspace/accessibilitydisplayshouldreducemotion)

Run `python3 scripts/test-native-notch.py` in a logged-in macOS GUI session. It uses
fixture metadata and controlled pointer positions in a real native host, temporarily
moving/restoring the cursor, then repeats
in another process's fullscreen Space. It checks default fullscreen exclusion,
opt-in/off without focus changes, top-edge hover at several synthetic display sizes
and origins, explicit-collapse suppression, hover/exit hysteresis, hit testing,
transport payloads, focus preservation, disabled capabilities, preference lifecycle,
suspension, Reduce Motion and teardown. It does not play music or change user settings.
The test briefly creates a fullscreen fixture. Physical display hot-plug, system sleep,
actual pointer-device latency and simultaneous third-party notch overlays still need
manual device acceptance. Do not run overlapping native GUI integration tests.
