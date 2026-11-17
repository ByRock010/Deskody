let richMediaSupported = false;
import { youtubeMusicUrl } from "./media-target.js";
const api = globalThis.chrome;
let busy = false;
let reportPending = false;
let fastCommandsSupported = false;
let listening = false;
let handling = null;
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
        void report();
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

function musicTab(tabs) {
  const candidates = tabs.filter(
    (t) => !t.incognito && t.url?.startsWith("https://music.youtube.com/"),
  );
  const tab =
    candidates.find((t) => t.id === lastMusicTab) ||
    candidates.find((t) => t.audible) ||
    candidates[0];
  if (tab) lastMusicTab = tab.id;
  return tab;
}

async function handleCommand(command, music, musicState) {
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
    return;
  }
  if (!command || command.id === acknowledged || handling || executing) return;
  handling = command.id; // Claim before any await: report and command channel can race.
  try {
    if (!music) music = musicTab(await api.tabs.query({}));
    if (
      !musicState &&
      music &&
      (command.action === "open" || command.action === "transition")
    ) {
      try {
        musicState = await api.tabs.sendMessage(music.id, { type: "state" });
      } catch {
        musicState = {};
      }
    }
    if (command.action === "open" || command.action === "transition") {
      startOpen(music, command, musicState || {});
      return;
    }
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
  } finally {
    handling = null;
    // Publish fresh post-command metadata and acknowledgement together, immediately.
    void report();
  }
}

async function listenForCommands() {
  if (listening || !fastCommandsSupported || !cachedToken) return;
  listening = true;
  try {
    while (fastCommandsSupported && cachedToken) {
      try {
        const response = await fetch("http://127.0.0.1:43827/commands", {
          headers: {
            Authorization: `Bearer ${cachedToken}`,
            "x-deskody-after": executing?.id || handling || acknowledged || "",
          },
          signal: AbortSignal.timeout(22000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const command = await response.json();
        // A long-poll timeout isn't cancellation. POST /context remains authoritative
        // for cancellation and legacy compatibility.
        if (command) {
          await handleCommand(command);
          if (handling || (executing && command.id !== executing.id))
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  } finally {
    listening = false;
  }
}

async function report() {
  if (!cachedToken) return;
  if (busy) {
    reportPending = true;
    return;
  }
  busy = true;
  try {
    await sessionReady;
    // Bind the acknowledgement to the state-read generation. A fast command can
    // finish while tabs.sendMessage is awaiting an older snapshot; that snapshot
    // must never acknowledge the newer command. Its completion queues a fresh report.
    const reportAck = acknowledged;
    const reportError = commandError;
    const tabs = await api.tabs.query({});
    const window = await api.windows.getLastFocused();
    // Never send incognito context. No history, query strings or page content leave the browser.
    const active = tabs.find(
      (t) => t.windowId === window.id && t.active && !t.incognito,
    );
    const music = musicTab(tabs);
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
        ...(richMediaSupported ? { music: musicState.media || null } : {}),
        acknowledged: reportAck,
        commandError: reportError,
      }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Eşleştirme anahtarını ve masaüstü köprüsünü kontrol edin."
          : `HTTP ${response.status}`,
      );
    richMediaSupported =
      response.headers.get("x-deskody-media-version") === "1";
    const command = await response.json();
    fastCommandsSupported =
      response.headers.get("x-deskody-command-version") === "1";
    void listenForCommands();
    await handleCommand(command, music, musicState);
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
    if (reportPending) {
      reportPending = false;
      queueMicrotask(() => void report());
    }
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
