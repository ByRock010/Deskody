import { youtubeMusicUrl } from "./media-target.js";
const api = globalThis.chrome;
let busy = false;
let acknowledged = null;
let commandError = null;
let cachedToken = "";
let lastMusicTab = null;
let executing = null;
// A suspended/restarted worker must not navigate twice for one command ID.
const sessionReady = api.storage.session
  .get(["lastAck", "lastCommandError", "pendingOpen"])
  .then(async (state) => {
    acknowledged = state.lastAck || null;
    commandError = state.lastCommandError || null;
    if (state.pendingOpen) {
      const pending = state.pendingOpen;
      acknowledged = pending.id;
      await api.tabs
        .sendMessage(pending.tabId, {
          type: "command",
          command: { action: "cancel", id: pending.id },
        })
        .catch(() => {});
      // Recover the volume snapshot after a worker restart. Never force a timeout pause.
      if (pending.original)
        await api.tabs
          .sendMessage(pending.tabId, {
            type: "command",
            command: { action: "restore", ...pending.original },
          })
          .catch(() => {});
      // Migration only: release a tab mute left by extension 0.1.3.
      if (typeof pending.wasMuted === "boolean")
        await api.tabs
          .update(pending.tabId, { muted: pending.wasMuted })
          .catch(() => {});
      commandError =
        "Eklenti yeniden başlatıldı; müzik bağlantısını tekrar deneyin.";
      await api.storage.session.set({
        lastAck: acknowledged,
        lastCommandError: commandError,
      });
      await api.storage.session.remove("pendingOpen");
    }
  });

function startOpen(music, command, musicState) {
  executing = { id: command.id, tabId: music?.id, cancelling: false };
  void (async () => {
    let failure = null;
    try {
      if (!music) throw new Error("YouTube Music sekmesi bulunamadı");
      if (command.url)
        command = { ...command, url: youtubeMusicUrl(command.url) };
      await api.storage.session.set({
        pendingOpen: {
          id: command.id,
          tabId: music.id,
          original: { volume: musicState.volume, muted: musicState.muted },
        },
      });
      const result = await api.tabs.sendMessage(music.id, {
        type: "command",
        command,
      });
      if (!result?.ok)
        throw new Error(result?.error || "Oynatıcı komutu onaylamadı");
    } catch (error) {
      failure = String(error.message || error).slice(0, 1000);
    } finally {
      if (executing?.id === command.id) {
        acknowledged = command.id;
        commandError = failure;
        // Persist cleanup before allowing a new transaction to use the recovery slot.
        await api.storage.session.set({
          lastAck: acknowledged,
          lastCommandError: commandError,
        });
        await api.storage.session.remove("pendingOpen");
        executing = null;
        setTimeout(report, 30);
      }
    }
  })();
}

api.storage.local.get("token").then(({ token }) => {
  cachedToken = token || "";
});
api.storage.onChanged.addListener((changes) => {
  if (changes.token) {
    cachedToken = changes.token.newValue || "";
    void report();
  }
});

async function report() {
  if (busy || !cachedToken) return;
  busy = true;
  try {
    await sessionReady;
    const tabs = await api.tabs.query({});
    const window = await api.windows.getLastFocused();
    // Never send incognito context. No history, query strings or page content leave the browser.
    const active = tabs.find(
      (t) => t.windowId === window.id && t.active && !t.incognito,
    );
    const musicTabs = tabs.filter(
      (t) => !t.incognito && t.url?.startsWith("https://music.youtube.com/"),
    );
    const music =
      musicTabs.find((t) => t.id === lastMusicTab) ||
      musicTabs.find((t) => t.audible) ||
      musicTabs[0];
    if (music) lastMusicTab = music.id;
    let musicState = {};
    if (music) {
      try {
        musicState = await api.tabs.sendMessage(music.id, { type: "state" });
      } catch {
        /* page may still be loading */
      }
    }
    let url = null;
    if (window.focused && active?.url) {
      const parsed = new URL(active.url);
      if (["http:", "https:", "file:"].includes(parsed.protocol)) {
        parsed.search = "";
        parsed.hash = "";
        parsed.username = "";
        parsed.password = "";
        url = parsed.href;
      }
    }
    const response = await fetch("http://127.0.0.1:43827/context", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cachedToken}`,
      },
      signal: AbortSignal.timeout(2000),
      body: JSON.stringify({
        url,
        title: active && window.focused ? active.title || "" : "",
        focused: !!window.focused && !!active,
        audible: tabs.some(
          (t) =>
            !t.incognito &&
            t.audible &&
            !t.mutedInfo?.muted &&
            t.id !== music?.id,
        ),
        musicPlaying: musicState.playing ?? null,
        musicPresent: !!music,
        musicCanOpen: musicState.canOpen === true,
        musicTransition: musicState.canTransition === true,
        musicVolume: musicState.volume ?? null,
        musicTitle: musicState.title || "",
        acknowledged,
        commandError,
      }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Eşleştirme anahtarını ve masaüstü köprüsünü kontrol edin."
          : `HTTP ${response.status}`,
      );
    const command = await response.json();
    if (executing && command?.id !== executing.id) {
      if (!executing.cancelling) {
        executing.cancelling = true;
        void api.tabs
          .sendMessage(executing.tabId, {
            type: "command",
            command: { action: "cancel", id: executing.id },
          })
          .catch(() => {});
      }
    } else if (command && command.id !== acknowledged && !executing) {
      if (command.action === "open" || command.action === "transition") {
        startOpen(music, command, musicState);
      } else {
        commandError = null;
        try {
          if (!music) throw new Error("YouTube Music sekmesi bulunamadı");
          const result = await api.tabs.sendMessage(music.id, {
            type: "command",
            command,
          });
          if (!result?.ok)
            throw new Error(result?.error || "Oynatıcı komutu onaylamadı");
        } catch (error) {
          commandError = String(error.message || error).slice(0, 1000);
        }
        acknowledged = command.id;
        await api.storage.session.set({
          lastAck: acknowledged,
          lastCommandError: commandError,
        });
        setTimeout(report, 30);
      }
    }
    await api.storage.session.set({
      connection: "Bağlı",
      lastSeen: Date.now(),
    });
  } catch (error) {
    await api.storage.session.set({
      connection: String(error.message || error),
    });
  } finally {
    busy = false;
  }
}

api.tabs.onActivated.addListener(() => void report());
api.tabs.onUpdated.addListener((_id, change) => {
  if (
    "url" in change ||
    "audible" in change ||
    "status" in change ||
    "title" in change
  )
    void report();
});
api.tabs.onRemoved.addListener(() => void report());
api.windows.onFocusChanged.addListener(() => void report());
api.alarms.create("heartbeat", { periodInMinutes: 0.5 });
api.alarms.onAlarm.addListener(() => void report());
api.runtime.onMessage.addListener((message) => {
  if (message.type === "heartbeat") void report();
});
api.action.onClicked.addListener(() => api.runtime.openOptionsPage());
// MV3 workers may suspend; the music content script and alarm wake the worker.
setInterval(report, 1500);
void report();
