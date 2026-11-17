import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./music-page.js", import.meta.url),
  "utf8",
);
function fixture() {
  const state = {
    id: "aaaaaaaaaaa",
    responseId: "aaaaaaaaaaa",
    duration: 158,
    declared: 158,
    time: 153,
    rawDuration: 238,
    rawTime: 32,
    paused: true,
    ad: false,
    ready: 4,
    barDuration: null,
    barTime: null,
  };
  const seeks = [];
  const element = {
    get duration() {
      return state.rawDuration;
    },
    get currentTime() {
      return state.rawTime;
    },
    set currentTime(value) {
      state.rawTime = value;
    },
    get paused() {
      return state.paused;
    },
    ended: false,
    get readyState() {
      return state.ready;
    },
    volume: 0.6,
    muted: false,
    classList: { contains: (v) => v === "html5-main-video" },
    closest: (selector) => (selector === "#movie_player" ? player : null),
    seekable: { length: 1, start: () => 0, end: () => state.rawDuration },
    pause: () => {
      state.paused = true;
    },
    play: async () => {
      state.paused = false;
    },
  };
  const player = {
    classList: { contains: () => state.ad },
    getVideoData: () => ({
      video_id: state.id,
      title: state.id,
      author: "artist",
    }),
    getPlayerResponse: () => ({
      videoDetails: {
        videoId: state.responseId,
        lengthSeconds: String(state.declared),
      },
    }),
    getDuration: () => state.duration,
    getCurrentTime: () => state.time,
    seekTo: (position) => {
      seeks.push(position);
      state.time = position;
    },
    getPlayerState: () => (state.paused ? 2 : 1),
  };
  const listeners = new Map();
  const document = {
    querySelector: (selector) =>
      selector === "#movie_player"
        ? player
        : selector === "ytmusic-app"
          ? {}
          : selector === "ytmusic-player-bar #progress-bar"
            ? { max: state.barDuration, value: state.barTime }
            : null,
    querySelectorAll: () => [element],
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent: (event) => {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
  };
  class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  runInNewContext(source, {
    document,
    CustomEvent,
    navigator: {
      mediaSession: { metadata: { title: "stale media session title" } },
    },
    URL,
  });
  let result;
  document.addEventListener("music-optimizer:page-reply", (event) => {
    result = JSON.parse(event.detail);
  });
  function call(action = "state", extra = {}) {
    result = null;
    document.dispatchEvent(
      new CustomEvent("music-optimizer:page-request", {
        detail: JSON.stringify({ id: "fixture", action, ...extra }),
      }),
    );
    return result;
  }
  return { state, player, element, call, seeks };
}

describe("YouTube Music content and media timelines", () => {
  it("keeps a 2:38 song on its content timeline when the underlying media says 3:58", () => {
    const { call } = fixture();
    const sample = call();
    expect(sample.duration).toBe(158);
    expect(sample.time).toBe(153);
    expect(sample.track).toBe("aaaaaaaaaaa");
  });
  it("seeks 2:34 in content seconds without seeking the unrelated raw timeline", () => {
    const { call, state, seeks, element } = fixture();
    const result = call("seek", { trackId: "aaaaaaaaaaa", position: 154 });
    expect(result.error).toBeUndefined();
    expect(seeks).toEqual([154]);
    expect(state.rawTime).toBe(32);
    expect(element.paused).toBe(true);
    expect(element.volume).toBe(0.6);
    expect(element.muted).toBe(false);
  });
  it("does not let a transient 3:58 player duration replace the 2:38 content length", () => {
    const { state, call } = fixture();
    state.duration = 238;
    const mixed = call();
    expect(mixed.duration).toBe(158);
    expect(mixed.time).toBeNull();
    expect(mixed.canSeek).toBe(false);
    state.duration = 158;
    state.time = 155;
    expect(call()).toMatchObject({ duration: 158, time: 155, canSeek: true });
  });
  it("does not carry the finished song's timeline into the next song", () => {
    const { state, call } = fixture();
    for (const time of [153, 154, 155]) {
      state.time = time;
      expect(call()).toMatchObject({ duration: 158, time });
    }
    state.id = state.responseId = "bbbbbbbbbbb";
    state.declared = 238;
    // The response changed first; both the player clock and raw media still describe A.
    expect(call()).toMatchObject({ duration: 238, time: null, canSeek: false });
    state.duration = 0;
    expect(call()).toMatchObject({ duration: 238, time: null, canSeek: false });
    state.duration = 238;
    state.time = 0.2;
    state.rawDuration = 158;
    state.rawTime = 157;
    expect(call()).toMatchObject({
      videoId: "bbbbbbbbbbb",
      track: "bbbbbbbbbbb",
      duration: 238,
      time: 0.2,
      canSeek: true,
    });
    state.time = 2;
    expect(call()).toMatchObject({ duration: 238, time: 2 });
    expect(
      call("seek", { trackId: "aaaaaaaaaaa", position: 154 }).error,
    ).toContain("Parça değişti");
  });
  it("suppresses timelines when loaded identity and response identity disagree", () => {
    const { state, call } = fixture();
    state.responseId = "bbbbbbbbbbb";
    expect(call()).toMatchObject({
      duration: null,
      time: null,
      canSeek: false,
    });
  });
  it("rejects positions inside the raw stream but beyond the actual song", () => {
    const { call, seeks, state } = fixture();
    expect(
      call("seek", { trackId: "aaaaaaaaaaa", position: 218 }).error,
    ).toContain("desteklenmiyor");
    expect(seeks).toEqual([]);
    expect(state.rawTime).toBe(32);
  });
  it("keeps the scoped media fallback when the player timeline API is absent", () => {
    const { state, player, call, seeks } = fixture();
    delete player.getDuration;
    delete player.getCurrentTime;
    state.rawDuration = 158;
    state.rawTime = 153;
    expect(call()).toMatchObject({
      duration: 158,
      time: 153,
      timelineSource: "media",
      canSeek: true,
    });
    expect(
      call("seek", { trackId: "aaaaaaaaaaa", position: 154 }).error,
    ).toBeUndefined();
    expect(state.rawTime).toBe(154);
    expect(seeks).toEqual([]);
  });
  it("rejects invalid/live or out-of-range clocks without borrowing raw stream time", () => {
    const { state, call } = fixture();
    for (const value of [0, NaN, Infinity, -1]) {
      state.duration = value;
      expect(call()).toMatchObject({
        duration: 158,
        time: null,
        canSeek: false,
      });
    }
    state.duration = 158;
    state.time = 250;
    expect(call()).toMatchObject({ duration: 158, time: null, canSeek: false });
    state.declared = 0;
    state.duration = Infinity;
    expect(call()).toMatchObject({
      duration: null,
      time: null,
      canSeek: false,
    });
  });
  it("still observes progress when a loading player temporarily has no video metadata", () => {
    const { player, call } = fixture();
    player.getVideoData = () => undefined;
    player.getPlayerResponse = () => null;
    expect(call()).toMatchObject({
      videoId: null,
      duration: 158,
      time: 153,
      canSeek: false,
    });
  });
  it("carries the actual YTM total separately from the exact seek duration", () => {
    const { state, call } = fixture();
    state.duration = 240.15;
    state.declared = 240;
    state.time = state.barTime = 153;
    state.barDuration = 240;
    expect(call()).toMatchObject({
      duration: 240.15,
      displayDuration: 240,
      time: 153,
    });
    state.id = state.responseId = "bbbbbbbbbbb";
    state.duration = 158.25;
    state.declared = 158;
    state.time = 0;
    // The visible bar still belongs to the old 4-minute song: never inherit it.
    expect(call()).toMatchObject({
      duration: 158.25,
      displayDuration: null,
      time: 0,
    });
    state.barDuration = 159;
    state.barTime = 0;
    expect(call()).toMatchObject({
      duration: 158.25,
      displayDuration: 159,
      time: 0,
    });
  });
});
