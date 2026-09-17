import { useSyncExternalStore } from "react";
import messages from "../locales/en.json" with { type: "json" };
import type { Language, ActivityEntry } from "./types";

let language: Language = "en";
const listeners = new Set<() => void>();
const catalogue: Record<string, string> = messages;
const reverse = new Map(Object.entries(catalogue).map(([tr, en]) => [en, tr]));
const placeholder = /\{([^{}]*)\}/g;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(catalogue)
  .flatMap(([tr, en]) => {
    if (!tr.includes("{")) return [];
    return (["en", "tr"] as const).map((locale) => {
      const source = locale === "en" ? tr : en;
      const target = locale === "en" ? en : tr;
      const names = [...source.matchAll(placeholder)].map(
        (m, index) => m[1] || String(index),
      );
      return {
        locale,
        source,
        target,
        names,
        pattern: new RegExp(
          "^" +
            source
              .split(placeholder)
              .map((part, i) => (i % 2 ? "([\\s\\S]*?)" : escape(part)))
              .join("") +
            "$",
        ),
      };
    });
  })
  .sort((a, b) => b.source.length - a.source.length);

export function setLanguage(next: Language | undefined) {
  const value = next === "tr" ? "tr" : "en";
  if (typeof document !== "undefined") document.documentElement.lang = value;
  if (language === value) return;
  language = value;
  listeners.forEach((listener) => listener());
}
export function useLanguage(): Language {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => language,
    () => "en",
  );
}
export function translate(
  text: string | null | undefined,
  locale: Language,
  depth = 0,
): string {
  if (!text) return "";
  if (locale === "en" && catalogue[text]) return catalogue[text];
  if (locale === "tr") {
    if (catalogue[text]) return text;
    if (reverse.has(text)) return reverse.get(text)!;
  }
  if (depth < 4) {
    if (text.startsWith("Error: "))
      return translate(text.slice(7), locale, depth + 1);
    for (const item of patterns) {
      if (item.locale !== locale) continue;
      const match = item.pattern.exec(text);
      if (!match) continue;
      let index = 0;
      return item.target.replace(placeholder, (_, name: string) => {
        const key = name || String(index++);
        const value = match[item.names.indexOf(key) + 1] || "";
        return ["e", "error"].includes(key)
          ? translate(value, locale, depth + 1)
          : value;
      });
    }
  }
  return text;
}
export function t(
  text: string | null | undefined,
  ...values: (string | number)[]
): string {
  let index = 0;
  return translate(text, language).replace(/\{\}/g, () =>
    String(values[index++] ?? "{}"),
  );
}

// Runtime action records contain user-authored rule names. Translate only their
// fixed action suffix; never feed the application/rule/player names to a catalogue.
export function activityMessage(
  entry: string | ActivityEntry | undefined,
): string {
  if (!entry) return "";
  if (typeof entry !== "string" && entry.playback) {
    const p = entry.playback;
    const reason = p.ruleName ? p.reason : t(p.reason);
    return `${p.app} · ${reason} → ${p.player}: ${t(p.action)}`;
  }
  const message = typeof entry === "string" ? entry : entry.message;
  if (!message.includes(" → ")) return t(message);
  for (const action of [
    "Duraklat",
    "Çal",
    "Elle duraklatıldı; otomasyon bekliyor",
  ]) {
    const suffix = `: ${action}`;
    if (message.endsWith(suffix))
      return message.slice(0, -suffix.length) + `: ${t(action)}`;
  }
  return message;
}
