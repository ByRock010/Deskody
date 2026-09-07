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
    const candidates = [...document.querySelectorAll("video, audio")];
    const score = (e) =>
      (e.closest("#movie_player")
        ? 100
        : e.closest("ytmusic-player")
          ? 50
          : 0) +
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
  function snapshot() {
    const element = media();
    if (element && !identities.has(element))
      identities.set(element, ++nextIdentity);
    const videoId =
      read("getVideoData")?.video_id ||
      read("getPlayerResponse")?.videoDetails?.videoId;
    const volume = read("getVolume");
    return {
      videoId: typeof videoId === "string" ? videoId : null,
      mediaKey: element ? identities.get(element) : null,
      loadEpoch,
      playing: element ? !element.paused && !element.ended : null,
      ready: element?.readyState ?? 0,
      time: element?.currentTime ?? 0,
      volume: Number.isFinite(volume)
        ? volume / 100
        : (element?.volume ?? null),
      muted: read("isMuted") === true || element?.muted === true,
      playerState: read("getPlayerState") ?? null,
    };
  }
  function control(request) {
    const element = media();
    const native = player();
    if (!element) throw new Error("YouTube Music oynatıcısı hazır değil");
    if (request.action === "volume" || request.action === "restore") {
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
      if (["play", "pause", "volume", "restore"].includes(request.action)) {
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
