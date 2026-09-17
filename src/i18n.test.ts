import { afterEach, expect, it } from "vitest";
import { activityMessage, setLanguage, t, translate } from "./i18n";
import { defaultSettings, mergeQuickChanges } from "./settings";

afterEach(() => setLanguage("en"));

it("defaults to English and switches both exact and interpolated messages", () => {
  expect(defaultSettings().language).toBe("en");
  expect(t("Ayarlar")).toBe("Settings");
  expect(t("{} kuralı", "Ayarlar")).toBe("Ayarlar rule");
  setLanguage("tr");
  expect(t("Settings")).toBe("Ayarlar");
  expect(t("{} kuralı", "Ayarlar")).toBe("Ayarlar kuralı");
});

it("translates backend errors including nested causes without translating user data", () => {
  expect(
    translate("Spotify arka plan komutu başarısız: Oynatıcı yok", "en"),
  ).toBe("Spotify background command failed: No player");
  expect(translate("Spotify background command failed: No player", "tr")).toBe(
    "Spotify arka plan komutu başarısız: Oynatıcı yok",
  );
  expect(activityMessage("Code · Ayarlar → Spotify: Çal")).toBe(
    "Code · Ayarlar → Spotify: Play",
  );
  expect(translate("Özel çalışma listem", "en")).toBe("Özel çalışma listem");
  const playback = {
    app: "Code",
    reason: "Otomasyon kapalı",
    ruleName: false,
    player: "Spotify",
    action: "Duraklat",
  };
  const entry = { time: 0, level: "info", message: "", playback };
  expect(activityMessage(entry)).toBe(
    "Code · Automation is off → Spotify: Pause",
  );
  expect(
    activityMessage({ ...entry, playback: { ...playback, ruleName: true } }),
  ).toBe("Code · Otomasyon kapalı → Spotify: Pause");
  setLanguage("tr");
  expect(activityMessage(entry)).toBe(
    "Code · Otomasyon kapalı → Spotify: Duraklat",
  );
});

it("merges committed language while preserving unrelated unsaved settings", () => {
  const previous = defaultSettings();
  const draft = { ...structuredClone(previous), fadeMs: 2300 };
  draft.rules[0].name = "Kaydedilmemiş kural";
  const next = { ...structuredClone(previous), language: "tr" as const };
  const merged = mergeQuickChanges(draft, previous, next);
  expect(merged.language).toBe("tr");
  expect(merged.fadeMs).toBe(2300);
  expect(merged.rules[0].name).toBe("Kaydedilmemiş kural");
  expect(next.fadeMs).toBe(previous.fadeMs);
});
