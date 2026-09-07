import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Settings,
  Snapshot,
  Permissions,
  InstalledApplication,
} from "./types";
import { defaultSettings } from "./settings";

export const desktop = isTauri();
const previewKey = "deskody-preview-v1";
const legacyPreviewKey = "music-optimizer-preview-v1";
function preview(): Snapshot {
  let settings = defaultSettings();
  try {
    const stored =
      localStorage.getItem(previewKey) ??
      localStorage.getItem(legacyPreviewKey);
    if (stored) settings = JSON.parse(stored);
  } catch {
    /* discard invalid preview state */
  }
  return {
    settings,
    status: {
      enabled: false,
      context: {
        app: "",
        appId: "",
        title: "",
        url: null,
        document: null,
        isBrowser: false,
        otherAudio: null,
        source: "",
      },
      player: null,
      decision: "Masaüstü uygulamasında kullanılabilir",
      activeRule: null,
      error: null,
      manualOverride: false,
      bridgeConnected: false,
      activity: [],
    },
    permissions: {
      accessibility: false,
      automation:
        "İzinleri yönetmek ve müziği kontrol etmek için masaüstü uygulamasını açın.",
      platform: "Web önizlemesi",
      capabilities: [],
    },
    players: [],
  };
}
export const api = {
  quickChange: (
    change:
      | { kind: "enabled"; enabled: boolean }
      | { kind: "rule"; id: string; enabled: boolean },
  ): Promise<Settings> => invoke("quick_change", { change }),
  openMain: (): Promise<void> => invoke("open_main"),
  closePanel: (): Promise<void> => invoke("close_panel"),
  quit: (): Promise<void> => invoke("quit_app"),
  applications: (): Promise<InstalledApplication[]> =>
    desktop
      ? invoke("list_applications")
      : Promise.reject(
          new Error(
            "Bilgisayarındaki uygulamaları görmek için masaüstü uygulamasını aç.",
          ),
        ),
  snapshot: (): Promise<Snapshot> =>
    desktop ? invoke("get_snapshot") : Promise.resolve(preview()),
  save: async (settings: Settings): Promise<Settings> => {
    if (desktop) return invoke("save_settings", { settings });
    localStorage.setItem(previewKey, JSON.stringify(settings));
    return settings;
  },
  permission: (kind: string): Promise<Permissions> =>
    invoke("request_permission", { kind }),
  media: (action: string): Promise<void> => invoke("media_action", { action }),
  refresh: (): Promise<void> =>
    desktop ? invoke("refresh_status") : Promise.resolve(),
  token: (): Promise<string> => invoke("get_pairing_token"),
  spotify: (disconnect = false): Promise<void> =>
    invoke("spotify_connect", { disconnect }),
  subscribe: (callback: (s: Snapshot) => void) =>
    desktop
      ? listen<Snapshot>("deskody://status", (event) => callback(event.payload))
      : Promise.resolve(() => {}),
};
