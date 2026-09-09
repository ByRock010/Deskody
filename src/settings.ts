import { youtubeMusicUrl } from "../browser-extension/media-target.js";
import type { Rule, Settings, InstalledApplication, Matcher } from "./types";

export function targetsSpotify(settings: Settings): boolean {
  const id = settings.targetPlayer.toLowerCase();
  return (
    settings.provider === "spotify" ||
    [
      "com.spotify.client",
      "spotify",
      "spotify.exe",
      "org.mpris.mediaplayer2.spotify",
    ].includes(id) ||
    id.startsWith("spotify:web:") ||
    id.startsWith("spotifyab.spotifymusic_") ||
    id.startsWith("org.mpris.mediaplayer2.spotify.")
  );
}

export function defaultSettings(): Settings {
  const rules: Rule[] = [
    ["Kodlama · VS Code", "Visual Studio Code"],
    ["Kodlama · Terminal", "Terminal"],
    ["Kodlama · Xcode", "Xcode"],
    ["Kodlama · Windows Terminal", "WindowsTerminal"],
    ["Kodlama · Linux", "code"],
  ].map(([name, value]) => ({
    id: crypto.randomUUID(),
    name,
    enabled: true,
    priority: 50,
    matcher: { kind: "app", value },
    action: { kind: "play", playlist: null },
  }));
  rules.push({
    id: crypto.randomUUID(),
    name: "Ders çalışma",
    enabled: true,
    priority: 60,
    matcher: { kind: "fileExtension", value: "pdf" },
    action: { kind: "play", playlist: null },
  });
  return {
    version: 1,
    enabled: false,
    provider: "spotify",
    spotifyWeb: false,
    spotifyClientId: "",
    targetPlayer: "",
    pollMs: 1500,
    settleMs: 2000,
    fadeMs: 600,
    pauseOnOtherAudio: true,
    browserBridge: false,
    rules,
  };
}

export function validateRule(rule: Rule): string | null {
  if (!rule.name.trim() || rule.name.length > 120)
    return "Kural adı 1–120 karakter olmalı.";
  if (rule.matcher.kind === "apps") {
    const apps = rule.matcher.value;
    if (!apps.length || apps.length > 64)
      return "Bir kural için 1–64 uygulama seçin.";
    if (
      apps.some((app) => !validApplication(app)) ||
      new Set(apps.map((app) => app.id.toLowerCase())).size !== apps.length
    )
      return "Uygulama seçimi geçersiz veya yineleniyor.";
  } else if (!validText(rule.matcher.value, 300))
    return "Geçerli bir eşleştirme değeri girin.";
  if (
    !Number.isInteger(rule.priority) ||
    rule.priority < 0 ||
    rule.priority > 999
  )
    return "Öncelik 0–999 arasında bir tam sayı olmalı.";
  if (rule.matcher.kind === "domain") {
    try {
      const u = new URL(`https://${rule.matcher.value}`);
      if (
        u.hostname !== rule.matcher.value ||
        u.pathname !== "/" ||
        u.search ||
        u.hash ||
        u.port ||
        u.username ||
        u.password
      )
        return "Yalnızca alan adı girin: ör. github.com";
    } catch {
      return "Geçerli bir alan adı girin.";
    }
  }
  if (rule.action.kind === "play" && rule.action.playlist) {
    const uri = rule.action.playlist.trim();
    try {
      if (new URL(uri).hostname === "music.youtube.com") {
        youtubeMusicUrl(uri);
        return null;
      }
    } catch (error) {
      if (uri.startsWith("https://music.youtube.com/"))
        return String(error instanceof Error ? error.message : error);
    }
    if (!/^spotify:(track|playlist|album):[a-zA-Z0-9]{22}$/.test(uri)) {
      try {
        const u = new URL(uri);
        if (
          u.protocol !== "https:" ||
          u.hostname !== "open.spotify.com" ||
          u.username ||
          u.password ||
          u.port ||
          !/^\/(track|playlist|album)\/[a-zA-Z0-9]{22}\/?$/.test(u.pathname)
        )
          return "Geçerli bir Spotify veya YouTube Music bağlantısı girin.";
      } catch {
        return "Geçerli bir Spotify veya YouTube Music bağlantısı girin.";
      }
    }
  }
  return null;
}

export function parseImport(text: string): Rule[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length > 100)
    throw new Error("Dosya en fazla 100 kural içeren bir JSON dizisi olmalı.");
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Geçersiz kural.");
    const r = value as Record<string, unknown>;
    const m = r.matcher as Record<string, unknown> | undefined;
    const a = r.action as Record<string, unknown> | undefined;
    if (
      typeof r.name !== "string" ||
      typeof r.enabled !== "boolean" ||
      typeof r.priority !== "number" ||
      !m ||
      !["app", "apps", "domain", "title", "fileExtension"].includes(
        String(m.kind),
      ) ||
      (m.kind === "apps"
        ? !Array.isArray(m.value) || !m.value.every(validApplication)
        : typeof m.value !== "string") ||
      !a ||
      !["play", "pause"].includes(String(a.kind)) ||
      (a.kind === "play" &&
        a.playlist !== null &&
        typeof a.playlist !== "string")
    )
      throw new Error("Kural dosyasının yapısı geçersiz.");
    const rule: Rule = {
      id: crypto.randomUUID(),
      name: r.name,
      enabled: r.enabled,
      priority: r.priority,
      matcher:
        m.kind === "apps"
          ? { kind: "apps", value: m.value as InstalledApplication[] }
          : {
              kind: m.kind as Exclude<Matcher["kind"], "apps">,
              value: m.value as string,
            },
      action:
        a.kind === "pause"
          ? { kind: "pause" }
          : { kind: "play", playlist: a.playlist as string | null },
    };
    const error = validateRule(rule);
    if (error) throw new Error(error);
    return rule;
  });
}

function validText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    new TextEncoder().encode(value).length <= max &&
    !/[\x00-\x1f\x7f-\x9f]/.test(value)
  );
}
export function validApplication(
  value: unknown,
): value is InstalledApplication {
  if (!value || typeof value !== "object") return false;
  const app = value as InstalledApplication;
  return (
    validText(app.id, 300) &&
    validText(app.name, 120) &&
    Array.isArray(app.aliases) &&
    app.aliases.length <= 4 &&
    app.aliases.every((v) => validText(v, 300))
  );
}
export function matcherLabel(matcher: Matcher): string {
  return matcher.kind === "apps"
    ? matcher.value.map((app) => app.name).join(", ")
    : matcher.value;
}

// Preserve unsaved editor fields while adopting quick switches changed in the
// other window. Compare with the last server snapshot, not the edited draft.
export function mergeQuickChanges(
  draft: Settings,
  previous: Settings,
  next: Settings,
): Settings {
  return {
    ...draft,
    enabled: previous.enabled !== next.enabled ? next.enabled : draft.enabled,
    rules: draft.rules.map((rule) => {
      const before = previous.rules.find((r) => r.id === rule.id);
      const after = next.rules.find((r) => r.id === rule.id);
      return before && after && before.enabled !== after.enabled
        ? { ...rule, enabled: after.enabled }
        : rule;
    }),
  };
}
