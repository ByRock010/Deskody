(() => {
  const api = globalThis.chrome;
  // Only non-sensitive playback data crosses into the page's JS world.
  function pageCall(action, command = {}) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        document.removeEventListener("music-optimizer:page-reply", receive);
        reject(
          new Error(
            "Sayfa içi müzik köprüsü hazır değil. Eklentiyi ve YouTube Music sayfasını yenileyin.",
          ),
        );
      }, 1500);
      function receive(event) {
        if (typeof event.detail !== "string") return;
        let data;
        try {
          data = JSON.parse(event.detail);
        } catch {
          return;
        }
        if (data.id !== id) return;
        clearTimeout(timer);
        document.removeEventListener("music-optimizer:page-reply", receive);
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      }
      document.addEventListener("music-optimizer:page-reply", receive);
      document.dispatchEvent(
        new CustomEvent("music-optimizer:page-request", {
          detail: JSON.stringify({
            id,
            action,
            url: command.url,
            operation: command.id,
            volume: command.volume,
            muted: command.muted,
          }),
        }),
      );
    });
  }
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const operations = new Map();
  let active = null;

  async function transition(command, signal) {
    const initial = await pageCall("state");
    // Read locally before touching volume. Desktop samples can be stale or mid-fade.
    const original = { volume: initial.volume, muted: initial.muted };
    const duration = Math.max(0, Math.min(3000, command.fadeMs || 0)) / 2;
    const deadline = performance.now() + 11000;
    let state = initial;
    let phase = "hazırlık";
    const check = () => signal.throwIfAborted();
    async function fade(from, to) {
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      const start = performance.now();
      do {
        check();
        const progress = duration
          ? Math.min(1, (performance.now() - start) / duration)
          : 1;
        await pageCall("volume", { volume: from + (to - from) * progress });
        if (progress === 1) break;
        await delay(50);
      } while (true);
    }
    try {
      check();
      if (initial.playing) await fade(original.volume, 0);
      check();
      if (command.pause) {
        await pageCall("pause");
        return { ok: true };
      }
      let target = command.url ? new URL(command.url) : null;
      let before = initial;
      if (target) {
        phase = "yönlendirme";
        before = (await pageCall("navigate", command)).before;
      }
      // Restore sound while loading as well: missing metadata must never hold audio at zero.
      await fade(0, original.volume);
      await pageCall("restore", original);
      let progress = null;
      let playRequested = false;
      while (performance.now() < deadline) {
        check();
        state = await pageCall("state");
        if (target?.pathname === "/playlist") {
          phase = "liste parçası";
          const anchor = [...document.querySelectorAll("a[href]")].find((a) => {
            const url = new URL(a.href, location.href);
            return (
              url.origin === target.origin &&
              url.pathname === "/watch" &&
              url.searchParams.get("list") ===
                target.searchParams.get("list") &&
              /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get("v") || "")
            );
          });
          if (anchor) {
            target = new URL(anchor.href);
            before = (
              await pageCall("navigate", { ...command, url: target.href })
            ).before;
          }
        } else {
          phase = "parça kimliği";
          const desiredId = target?.searchParams.get("v");
          // YTM rewrites URLs/list IDs. Prefer actual loaded video data; URL alone proves nothing.
          const loaded =
            state.mediaKey !== before.mediaKey ||
            state.loadEpoch !== before.loadEpoch;
          const matches =
            !target ||
            (state.videoId
              ? state.videoId === desiredId
              : new URL(location.href).searchParams.get("v") === desiredId &&
                loaded);
          if (matches && state.ready >= 1) {
            phase = "oynatma";
            if (!playRequested) {
              await pageCall("restore", original); // Router may have replaced the media element.
              await pageCall("play");
              playRequested = true;
            }
            if (state.playbackError === "NotAllowedError" && !state.playing)
              throw new Error(
                "Tarayıcı otomatik oynatmayı engelledi. YouTube Music sayfasında bir kez Çal’a basıp tekrar dene.",
              );
            if (state.playing && state.ready >= 2) {
              if (
                progress &&
                progress.mediaKey === state.mediaKey &&
                state.time !== progress.time
              ) {
                return { ok: true };
              }
              progress = { time: state.time, mediaKey: state.mediaKey };
            } else progress = null;
          } else {
            playRequested = false;
            progress = null;
          }
        }
        await delay(200);
      }
      throw new Error(
        `YouTube Music oynatma doğrulanamadı (aşama: ${phase}, oynatıcı: ${state.playerState ?? "?"}, hazır: ${state.ready}, çalıyor: ${state.playing}, sessiz: ${state.muted}, ses: ${Math.round((state.volume ?? 0) * 100)}%). Sayfayı yenileyip tekrar dene.`,
      );
    } finally {
      // An observation timeout isn't a request to pause a track that may already be playing.
      // Explicit cancellation (new rule/user stop) is different and must stop the old operation.
      try {
        if (signal.aborted) await pageCall("pause");
      } finally {
        await pageCall("restore", original);
      }
    }
  }

  api.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === "state") {
      pageCall("state")
        .then((s) =>
          reply({
            canOpen: true,
            canTransition: true,
            playing: s.playing,
            volume: s.volume,
            muted: s.muted,
            title: document.title,
          }),
        )
        .catch(() => reply({ canOpen: false, canTransition: false }));
      return true;
    }
    if (message.type !== "command") return;
    (async () => {
      const command = message.command;
      if (command.action === "cancel") {
        if (active?.id === command.id) {
          active.controller.abort(new Error("Müzik geçişi iptal edildi"));
          await active.promise;
        }
        return { ok: true };
      }
      if (command.action === "open" || command.action === "transition") {
        if (operations.has(command.id)) return operations.get(command.id);
        if (active) throw new Error("Önceki müzik geçişi henüz tamamlanmadı");
        const controller = new AbortController();
        const promise = transition(command, controller.signal)
          .catch((error) => ({ error: String(error.message || error) }))
          .finally(() => {
            if (active?.id === command.id) active = null;
          });
        active = { id: command.id, controller, promise };
        operations.set(command.id, promise);
        if (operations.size > 16)
          operations.delete(operations.keys().next().value);
        return promise;
      }
      if (!["play", "pause", "volume", "restore"].includes(command.action))
        throw new Error("Geçersiz medya komutu");
      if (active) {
        active.controller.abort(
          new Error("Müzik geçişi yeni komutla iptal edildi"),
        );
        await active.promise;
      }
      return pageCall(command.action, command);
    })()
      .then(reply)
      .catch((error) => reply({ error: String(error.message || error) }));
    return true;
  });
  setInterval(() => {
    api.runtime.sendMessage({ type: "heartbeat" }).catch(() => {});
  }, 750);
})();
