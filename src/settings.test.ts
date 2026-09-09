import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  parseImport,
  targetsSpotify,
  validateRule,
  mergeQuickChanges,
} from "./settings";

describe("untrusted rule import", () => {
  it("adopts tray switches without losing unsaved settings or rule edits", () => {
    const previous = defaultSettings();
    const draft = structuredClone(previous);
    draft.fadeMs = 2300;
    draft.rules[0].name = "Unsaved name";
    const next = structuredClone(previous);
    next.enabled = !previous.enabled;
    next.rules[0].enabled = !previous.rules[0].enabled;
    const merged = mergeQuickChanges(draft, previous, next);
    expect(merged.enabled).toBe(next.enabled);
    expect(merged.rules[0].enabled).toBe(next.rules[0].enabled);
    expect(merged.rules[0].name).toBe("Unsaved name");
    expect(merged.fadeMs).toBe(2300);
    expect(mergeQuickChanges(merged, next, next)).toEqual(merged);
  });
  it("recognizes Spotify selected from the system player picker", () => {
    for (const targetPlayer of [
      "com.spotify.client",
      "Spotify.exe",
      "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify",
      "org.mpris.MediaPlayer2.spotify.instance1",
    ])
      expect(
        targetsSpotify({
          ...defaultSettings(),
          provider: "system",
          targetPlayer,
        }),
      ).toBe(true);
    expect(
      targetsSpotify({
        ...defaultSettings(),
        provider: "system",
        targetPlayer: "browser:music.youtube.com",
      }),
    ).toBe(false);
  });
  it("validates and assigns fresh IDs on import", () => {
    const rule = defaultSettings().rules[0];
    const imported = parseImport(JSON.stringify([rule, rule]));
    expect(imported[0].id).not.toBe(imported[1].id);
    expect(imported[0].matcher).toEqual(rule.matcher);
  });
  it("rejects malformed and oversized input", () => {
    for (const text of [
      "null",
      "{}",
      '[{"name":"Bad"}]',
      JSON.stringify(Array(101).fill({})),
    ])
      expect(() => parseImport(text)).toThrow();
  });
  it("rejects script-like Spotify URIs and deceptive domains", () => {
    const rule = defaultSettings().rules[0];
    expect(
      validateRule({
        ...rule,
        action: {
          kind: "play",
          playlist:
            "https://open.spotify.com.evil.test/playlist/1234567890123456789012",
        },
      }),
    ).toBeTruthy();
    expect(
      validateRule({
        ...rule,
        matcher: { kind: "domain", value: "github.com/path" },
      }),
    ).toBeTruthy();
    expect(
      validateRule({
        ...rule,
        action: {
          kind: "play",
          playlist: "spotify:playlist:1234567890123456789012",
        },
      }),
    ).toBeNull();
  });
});

import musicTargets from "../tests/fixtures/music-targets.json";
import spotifyTargets from "../tests/fixtures/spotify-targets.json";
describe("Spotify playback targets", () => {
  it("accepts shared track, playlist and album links and preserves imported rules", () => {
    for (const { input } of spotifyTargets.valid) {
      const rule = {
        ...defaultSettings().rules[0],
        action: { kind: "play" as const, playlist: input },
      };
      expect(validateRule(rule), input).toBeNull();
      expect(parseImport(JSON.stringify([rule]))[0].action).toEqual(
        rule.action,
      );
    }
  });
  it("rejects credentials, spoofed hosts and unsupported Spotify targets", () => {
    for (const input of spotifyTargets.invalid)
      expect(
        validateRule({
          ...defaultSettings().rules[0],
          action: { kind: "play", playlist: input },
        }),
        input,
      ).toBeTruthy();
  });
});
import { youtubeMusicUrl } from "../browser-extension/media-target.js";
describe("YouTube Music playback targets", () => {
  it("preserves song, playlist, radio and mix parameters and strips tracking", () => {
    for (const { input, output } of musicTargets.valid) {
      expect(youtubeMusicUrl(input)).toBe(output);
      expect(
        validateRule({
          ...defaultSettings().rules[0],
          action: { kind: "play", playlist: input },
        }),
      ).toBeNull();
    }
  });
  it("rejects spoofed hosts, credentials, duplicate IDs and malformed targets", () => {
    for (const input of musicTargets.invalid) {
      expect(() => youtubeMusicUrl(input)).toThrow();
      expect(
        validateRule({
          ...defaultSettings().rules[0],
          action: { kind: "play", playlist: input },
        }),
      ).toBeTruthy();
    }
  });
});

describe("multiple application rules", () => {
  it("imports named app IDs and rejects empty, duplicate or malformed selections", () => {
    const app = { id: "com.apple.Preview", name: "Preview", aliases: [] };
    const rule = {
      ...defaultSettings().rules[0],
      matcher: { kind: "apps" as const, value: [app] },
    };
    expect(validateRule(rule)).toBeNull();
    expect(parseImport(JSON.stringify([rule]))[0].matcher).toEqual(
      rule.matcher,
    );
    for (const value of [
      [],
      [app, app],
      Array(65).fill(app),
      [{ ...app, id: "bad\nvalue" }],
      [{ id: "com.apple.Preview" }],
      "Preview",
    ])
      expect(() =>
        parseImport(
          JSON.stringify([{ ...rule, matcher: { kind: "apps", value } }]),
        ),
      ).toThrow();
  });
});
