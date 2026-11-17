# Media controls

Deskody exposes artwork, track/artist, duration/position, previous/next and seeking in
both the main window and quick controls. macOS continues to use its native NSMenu;
Windows/Linux use the shared React `MediaControls` component.

## Contract and execution

`Player` includes `trackId`, `artwork`, `duration`, optional `displayDuration`, `position`, `sampledAt`, `canSeek`,
`canNext` and `canPrevious`. Time values are **seconds**; `sampledAt` is Unix time.
Missing legacy fields default to unavailable. Non-finite/unknown/zero durations do
not produce an interactive seek bar. UI estimates elapsed time between snapshots,
bounded to 15 seconds, and uses monospaced elapsed/total labels. Elapsed time is
floored. Total time prefers the provider's validated label; without one it rounds
up (e.g. 171.237 seconds → 2:52).
For YTM, optional `displayDuration` uses its visible progress bar's total only when
that bar's current time (within two seconds) and length agree with the loaded content.
A prior track's clock or a substantially different total is rejected. This avoids relying
on a single rounding rule: YTM can show 4:00 for an exact 240.15-second stream.
`displayDuration` is presentation-only, bounded to three seconds from actual duration,
and discarded when it could belong to another track. Old snapshots omit it; old
backends ignore the optional nested field.
The underlying duration and endpoint-safe seek limit remain exact fractional seconds;
formatting must never extend the seekable track.

`media_transport({ request: { playerId, action } })` enters the serial runtime queue.
Actions are `{kind:"next"}`, `{kind:"previous"}` and
`{kind:"seek",position,trackId}`. The worker reads fresh selected-player metadata,
validates identity/capabilities/range, then dispatches through `Platform::transport`.
Adapters recheck identity where possible immediately before seeking. Interactive
validation uses `Platform::selected_player`; the browser adapter reads its paired
sample without querying unrelated native players. Successful manual commands publish
fresh selected-player metadata before acknowledging the UI, without waiting for a
full application/context scan. Seek targets
stay below the exact endpoint to avoid Spotify advancing to the next track. UI drag
identity is captured at gesture start; a track change during a drag cancels its commit.
During dragging, elapsed/total labels stay bound to the captured track and duration.
The UI keeps a bounded seek preview until a fresh matching sample confirms it (or
three seconds pass), so old snapshots cannot pull the thumb back during a command.
The notch previews continuously and dispatches one seek on release. Track changes
cancel the gesture. The notch also discards its preview on an explicit error.
A new command cancels an in-flight automatic transition through the existing generation
mechanism. Transport does not clear playlist ownership or reset the rule gate.

Visible controls renew an `observe_media` lease every 2.5 seconds. It expires after
six seconds; during the lease, media polling is at most one second apart. Main/tray
webviews are checked for visibility by the backend. Native menu tracking renews the
same lease. Merely opening controls does not restart automation or playlists. The macOS notch
adds a slower compact observation lease; see [NOTCH.md](NOTCH.md).

## Adapters

| Route | Metadata/artwork | Transport |
| --- | --- | --- |
| macOS Spotify | JXA track ID, artist, artwork URL, duration (milliseconds → seconds), player position | JXA nextTrack/previousTrack/playerPosition; no activation or URL opening |
| Windows Spotify | GSMTC media properties, bounded thumbnail stream, timeline and capability flags | TrySkipNextAsync / TrySkipPreviousAsync / TryChangePlaybackPositionAsync; check returned bool |
| YouTube Music | Paired extension; loaded-player identity, content duration/current time, with guarded scoped-media fallback | Existing in-page previous/next buttons; content `seekTo` or matching scoped-media fallback |
| Linux MPRIS | Metadata, mpris:length, track object path, Position, capability flags | Next / Previous / SetPosition(track path, microseconds) |
| Optional Spotify Web API | Current playback item and actions.disallows | Explicit device ID on next/previous/seek; recheck device/item before seek |

Windows converts 100-nanosecond ticks and `LastUpdatedTime` to the common timeline;
MPRIS converts microseconds. GSMTC has no stable media item URI: identity uses the
available title/artist/album metadata, so two distinct items with identical metadata
cannot be distinguished perfectly. Unsupported provider operations remain disabled
or report an error. Spotify Free advertising/skip restrictions still apply; local
controls do not remove them. Windows native transport does not add the ability to
start a specific content link from a rule; that still needs Web API.

YTM duration/current time come from the loaded player's `getDuration`/`getCurrentTime`
pair, and seeking uses that same player's `seekTo(seconds, true)`. The raw stream's
`duration`/`currentTime` can use another timeline during loading/ads; never combine
content-time reads with raw-stream writes. Loaded video-data/response IDs must agree.
When response content length and measured duration disagree by more than two seconds,
only the known content length is exposed; position and seeking remain unavailable
until coherent. An existing but loading player API never falls back to old raw time.
When the API pair is absent, only media inside the YTM player is eligible; prefer its
main video and validate its timeline/seekable range. Missing metadata can still prove
playback progress, but cannot enable seeking without track identity.

YTM skips use player-bar buttons so the queue's repeat/shuffle/previous semantics stay
owned by YouTube Music. Seeking preserves pause/mute/volume. No new page navigation,
tab activation, native media-key toggle or master volume manipulation is introduced.
YTM uses internal page structures; service changes may require adapter updates.
A successful skip means its enabled native/page command was accepted, not that the
next stream has already buffered. Existing transition progress acknowledgements
remain unchanged.

## Artwork and extension compatibility

`artwork.rs` fetches only selected-player covers while controls or the compact macOS notch are observed. Network
work runs on a bounded background channel; the automation worker and AppKit thread do
not perform HTTP requests. HTTPS hosts are restricted to known artwork CDNs, redirects
are disabled, timeout is four seconds and the compressed body limit is 1 MiB. Eight
entries are retained in memory for five minutes. Only PNG/JPEG/WebP raster signatures
are forwarded as data URIs; local paths, arbitrary hosts and SVG are rejected. Windows
reads bounded local thumbnail streams and caches by media identity. Frontends receive
image data, not remote URLs, so CSP stays unchanged. Failed covers use a music icon.
No artwork cache is persisted to disk. Cover providers receive normal network metadata,
not Deskody rules or active-app/browser context.

Bridge 0.1.7 introduces optional `music` metadata and `position`/`trackId` command
fields. The backend advertises `x-deskody-media-version: 1`; the extension sends rich
metadata only after seeing that header, preserving compatibility with older backends
that reject unknown fields.
Bridge 0.1.8 also negotiates `x-deskody-command-version: 1` and keeps one authenticated
20-second `GET /commands` request waiting for the next command. The same Host/Origin/
Bearer checks apply. A command wakes the request immediately; command IDs deduplicate
it against legacy POST delivery. Acknowledgements and fresh media state are posted
immediately; reports requested while another is running are coalesced, not lost.
Each report captures its acknowledgement/error generation **before** awaiting media
state. A fast command completing during that read must be acknowledged only by the
next fresh report, never by the older in-flight sample.
Legacy heartbeats remain available for older app/extension combinations and reconnects.
This removes heartbeat scheduling delay, not YouTube Music's own buffering latency.
Older backends without the new header keep the previous polling route. Older extensions still support legacy play/pause, with
new capabilities disabled. Updating files alone does not replace scripts in an open
YTM tab: reload the extension and refresh that tab/PWA. Pairing does not change.

## API references

- [YouTube content time/duration and seek semantics](https://developers.google.com/youtube/iframe_api_reference#Playback_controls)
- [Windows playback position command](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession.trychangeplaybackpositionasync?view=winrt-26100)
- [Windows thumbnail property](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmediaproperties.thumbnail?view=winrt-26100)
- [MPRIS Player specification](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)
- [Spotify seek semantics](https://developer.spotify.com/documentation/web-api/reference/seek-to-position-in-currently-playing-track)
- [Spotify next-track command](https://developer.spotify.com/documentation/web-api/reference/skip-users-playback-to-next-track)
- macOS local scripting dictionary: `/Applications/Spotify.app/Contents/Resources/Spotify.sdef`.

Validation evidence and live-account/platform limitations belong in [VALIDATION.md](VALIDATION.md).
