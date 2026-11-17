// Runs in MAIN world: use YouTube Music's own SPA router. Never unload a page,
// click an external link, suppress beforeunload, or activate a tab/window.
(() => {
  const dispatched = new Map();
  const identities = new WeakMap();
  let nextIdentity = 0;
  let loadEpoch = 0;
  for (const type of ["loadstart", "emptied"])
    document.addEventListener(
      type,
      (event) => {
        if (event.target === media()) loadEpoch++;
      },
      true,
    );
  const player = () => document.querySelector("#movie_player");
  function media() {
    const candidates = [...document.querySelectorAll("video, audio")].filter(
      (e) => e.closest("#movie_player") || e.closest("ytmusic-player"),
    );
    const score = (e) =>
      (e.closest("#movie_player")
        ? 100
        : e.closest("ytmusic-player")
          ? 50
          : 0) +
      (e.classList.contains("html5-main-video") ? 25 : 0) +
      (e.readyState >= 2 ? 10 : 0) +
      (!e.paused && !e.ended ? 5 : 0);
    return candidates.sort((a, b) => score(b) - score(a))[0];
  }
  function read(method) {
    try {
      return player()?.[method]?.();
    } catch {
      return undefined;
    }
  }
  function transportButton(action) {
    const selector = action === "next" ? ".next-button" : ".previous-button";
    const button = document.querySelector(`ytmusic-player-bar ${selector}`);
    return button &&
      !button.disabled &&
      !button.hasAttribute("disabled") &&
      button.getAttribute("aria-disabled") !== "true"
      ? button
      : null;
  }
  const positiveDuration = (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 604800
      ? value
      : null;
  function snapshot() {
    const element = media();
    if (element && !identities.has(element))
      identities.set(element, ++nextIdentity);
    // Read identity once. YTM's response, Media Session and raw media element can
    // belong to different tracks/timelines while loading, inserting ads or switching.
    const data = read("getVideoData");
    const response = read("getPlayerResponse");
    const details = response?.videoDetails;
    const videoId = data?.video_id || details?.videoId;
    const coherent = !(
      data?.video_id &&
      details?.videoId &&
      data.video_id !== details.videoId
    );
    const declared =
      coherent && details?.videoId === videoId
        ? positiveDuration(Number(details?.lengthSeconds))
        : null;
    const native = player();
    const usesPlayerTimeline =
      typeof native?.getDuration === "function" &&
      typeof native?.getCurrentTime === "function";
    const measuredDuration = usesPlayerTimeline
      ? read("getDuration")
      : element?.duration;
    const measuredTime = usesPlayerTimeline
      ? read("getCurrentTime")
      : element?.currentTime;
    const measured = positiveDuration(measuredDuration);
    const live =
      (data?.isLive === true || details?.isLiveContent === true) && !declared;
    const agrees =
      !declared || (measured !== null && Math.abs(measured - declared) <= 2);
    // Never borrow the old media duration while the new content API is still loading.
    // A trusted content length can still label the track, but no position/seek is
    // exposed until identity, duration and position describe the same content.
    const duration =
      coherent && !live
        ? agrees && measured !== null
          ? measured
          : declared
        : null;
    const validTime =
      coherent &&
      !live &&
      agrees &&
      measured !== null &&
      typeof measuredTime === "number" &&
      Number.isFinite(measuredTime) &&
      measuredTime >= 0 &&
      measuredTime <= duration + 0.5;
    const time = validTime ? Math.min(duration, measuredTime) : null;
    const progress = document.querySelector("ytmusic-player-bar #progress-bar");
    const barDuration = positiveDuration(Number(progress?.max));
    const barTime = Number(progress?.value);
    // The visible YTM total is separately rounded. Use it only when its clock and
    // length agree with this loaded content; never reuse the previous song's bar.
    const displayDuration =
      validTime &&
      barDuration !== null &&
      progress?.value != null &&
      Number.isFinite(barTime) &&
      Math.abs(barTime - time) <= 2 &&
      Math.abs(barDuration - duration) <= 3 &&
      (!declared || Math.abs(barDuration - declared) <= 2)
        ? barDuration
        : null;
    const ad = native?.classList.contains("ad-showing") || false;
    const canSeek =
      !ad &&
      validTime &&
      !!videoId &&
      (usesPlayerTimeline
        ? typeof native.seekTo === "function"
        : !!element?.seekable?.length);
    const metadata = navigator.mediaSession?.metadata;
    const images =
      (coherent ? details?.thumbnail?.thumbnails : null) ||
      metadata?.artwork ||
      [];
    const artwork =
      images.find((i) => /(?:256|300|512)/.test(i.sizes || "")) ||
      images.at(-1);
    const volume = read("getVolume");
    const playerState = read("getPlayerState");
    return {
      videoId: typeof videoId === "string" ? videoId : null,
      track: String(
        data?.title ||
          (coherent ? details?.title : "") ||
          metadata?.title ||
          "",
      ).slice(0, 1000),
      artist: String(
        data?.author ||
          (coherent ? details?.author : "") ||
          metadata?.artist ||
          "",
      ).slice(0, 1000),
      artwork: artwork?.src || artwork?.url || null,
      duration,
      displayDuration,
      time,
      sampledAt: Date.now() / 1000,
      canSeek,
      timelineSource: validTime
        ? usesPlayerTimeline
          ? "player"
          : "media"
        : null,
      canNext: !ad && !!transportButton("next"),
      canPrevious: !ad && !!transportButton("previous"),
      mediaKey: element ? identities.get(element) : null,
      loadEpoch,
      playing:
        playerState === 1
          ? true
          : [0, 2, 5].includes(playerState)
            ? false
            : element
              ? !element.paused && !element.ended
              : null,
      ready: element?.readyState ?? 0,
      volume: Number.isFinite(volume)
        ? volume / 100
        : (element?.volume ?? null),
      muted: read("isMuted") === true || element?.muted === true,
      playerState: playerState ?? null,
    };
  }
  function control(request) {
    const element = media();
    const native = player();
    if (!element) throw new Error("YouTube Music oynatıcısı hazır değil");
    if (request.action === "next" || request.action === "previous") {
      const button = transportButton(request.action);
      if (!button || player()?.classList.contains("ad-showing"))
        throw new Error("Oynatıcı bu medya kontrolünü desteklemiyor");
      button.click(); // In-page transport button; does not focus or navigate the browser window.
    } else if (request.action === "seek") {
      const state = snapshot();
      if (state.videoId !== request.trackId)
        throw new Error("Parça değişti; tekrar deneyin");
      if (
        !state.canSeek ||
        !Number.isFinite(request.position) ||
        request.position < 0 ||
        request.position >= state.duration
      )
        throw new Error("Bu parçada konum değiştirme desteklenmiyor");
      if (state.timelineSource === "player") {
        // The content timeline may differ from HTMLMediaElement.currentTime (ads,
        // stream offsets, stale media). Read and seek through the same player API.
        native.seekTo(request.position, true);
      } else {
        let seekable = false;
        for (let i = 0; i < element.seekable.length; i++)
          if (
            request.position >= element.seekable.start(i) &&
            request.position <= element.seekable.end(i)
          )
            seekable = true;
        if (!seekable)
          throw new Error("Bu parçada konum değiştirme desteklenmiyor");
        element.currentTime = request.position;
      }
    } else if (request.action === "volume" || request.action === "restore") {
      if (Number.isFinite(request.volume)) {
        const volume = Math.max(0, Math.min(1, request.volume));
        native?.setVolume?.(volume * 100);
        element.volume = volume;
      }
      if (typeof request.muted === "boolean") {
        if (request.muted) native?.mute?.();
        else native?.unMute?.();
        element.muted = request.muted;
      }
    } else if (request.action === "pause") {
      native?.pauseVideo?.();
      element.pause();
    } else if (request.action === "play") {
      native?.playVideo?.();
      // The promise can remain pending while buffering. A later snapshot confirms playback.
      element.play().catch((error) => {
        playbackError = error.name;
      });
    }
  }
  let playbackError = null;
  document.addEventListener("music-optimizer:page-request", (event) => {
    if (typeof event.detail !== "string" || event.detail.length > 4096) return;
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (typeof request.id !== "string" || request.id.length > 80) return;
    const reply = (data) =>
      document.dispatchEvent(
        new CustomEvent("music-optimizer:page-reply", {
          detail: JSON.stringify({ ...data, id: request.id }),
        }),
      );
    try {
      const app = document.querySelector("ytmusic-app");
      if (request.action === "state") {
        reply({ ...snapshot(), playbackError });
        return;
      }
      if (
        [
          "play",
          "pause",
          "volume",
          "restore",
          "next",
          "previous",
          "seek",
        ].includes(request.action)
      ) {
        if (request.action === "play") playbackError = null;
        control(request);
        reply({ ok: true, ...snapshot() });
        return;
      }
      if (request.action !== "navigate" || !app)
        throw new Error(
          "YouTube Music sayfa içi yönlendirmesi hazır değil; sayfayı yenileyin.",
        );
      const url = new URL(request.url);
      const v = url.searchParams.get("v");
      const list = url.searchParams.get("list");
      if (
        url.origin !== "https://music.youtube.com" ||
        url.username ||
        url.password ||
        !["/watch", "/playlist"].includes(url.pathname) ||
        (url.pathname === "/watch" && !/^[A-Za-z0-9_-]{11}$/.test(v || "")) ||
        (url.pathname === "/playlist" && !list) ||
        (list && !/^[A-Za-z0-9_-]{2,256}$/.test(list))
      )
        throw new Error("Geçersiz müzik hedefi");
      if (
        typeof request.operation !== "string" ||
        request.operation.length > 80
      )
        throw new Error("Geçersiz müzik komutu");
      const key = `${request.operation}:${url.href}`;
      if (!dispatched.has(key)) {
        const watch = { videoId: v };
        if (list) watch.playlistId = list;
        if (url.searchParams.has("index"))
          watch.index = Number(url.searchParams.get("index"));
        if (url.searchParams.has("params"))
          watch.params = url.searchParams.get("params");
        if (url.searchParams.get("start_radio") === "1")
          watch.startRadio = true;
        const endpoint = {
          commandMetadata: {
            webCommandMetadata: { url: url.pathname + url.search },
          },
          ...(url.pathname === "/watch"
            ? { watchEndpoint: watch }
            : { browseEndpoint: { browseId: `VL${list}` } }),
        };
        dispatched.set(key, snapshot());
        if (dispatched.size > 16)
          dispatched.delete(dispatched.keys().next().value);
        app.dispatchEvent(
          new CustomEvent("yt-navigate", {
            detail: { endpoint },
            bubbles: true,
            composed: true,
          }),
        );
      }
      reply({ accepted: true, before: dispatched.get(key) });
    } catch (error) {
      reply({ error: String(error.message || error) });
    }
  });
})();
