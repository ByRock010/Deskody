import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it.each(["seek", "next"])(
  "never attaches a %s acknowledgement to a state read started before it",
  async (action) => {
    const source = readFileSync(
      new URL("./background.js", import.meta.url),
      "utf8",
    ).replace('import { youtubeMusicUrl } from "./media-target.js";', "");
    const event = () => ({ addListener() {} });
    const tab = {
      id: 1,
      url: "https://music.youtube.com/",
      active: true,
      windowId: 1,
    };
    const bodies = [];
    let position = 30;
    let trackId = "track-a";
    let duration = 158;
    let releaseState;
    let first = false;
    const api = {
      storage: {
        local: { get: async () => ({ token: "fixture" }) },
        session: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
        onChanged: event(),
      },
      tabs: {
        query: async () => [tab],
        sendMessage: async (_id, message) => {
          if (message.type === "command") {
            position =
              message.command.action === "seek" ? message.command.position : 0;
            if (message.command.action === "next") {
              trackId = "track-b";
              duration = 238;
            }
            return { ok: true };
          }
          const sample = {
            playing: false,
            media: { trackId, duration, position },
          };
          if (first) {
            first = false;
            await new Promise((resolve) => {
              releaseState = resolve;
            });
          }
          return sample;
        },
        onActivated: event(),
        onUpdated: event(),
        onRemoved: event(),
      },
      windows: {
        getLastFocused: async () => ({ id: 1, focused: true }),
        onFocusChanged: event(),
      },
      alarms: { create() {}, onAlarm: event() },
      runtime: { onMessage: event(), openOptionsPage() {} },
      action: { onClicked: event() },
    };
    const context = {
      chrome: api,
      URL,
      AbortSignal,
      queueMicrotask,
      setTimeout,
      setInterval() {},
      fetch: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return {
          ok: true,
          headers: {
            get: (name) => (name === "x-deskody-media-version" ? "1" : null),
          },
          json: async () => null,
        };
      },
      youtubeMusicUrl: (value) => value,
    };
    runInNewContext(source, context);
    await vi.waitFor(() => expect(typeof context.report).toBe("function"));
    await context.report(); // Negotiate rich media before the overlapping state read.
    bodies.length = 0;
    first = true;
    const reporting = context.report();
    await vi.waitFor(() => expect(releaseState).toBeTypeOf("function"));
    await context.handleCommand(
      { id: "command-new", action, position: 154 },
      tab,
      {},
    );
    releaseState();
    await reporting;
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2));
    expect(bodies[0].musicPlaying).toBe(false);
    expect(bodies[0].acknowledged).toBeNull();
    expect(bodies.at(-1).acknowledged).toBe("command-new");
    expect(bodies[0].music.position).toBe(30);
    expect(bodies[0].music.duration).toBe(158);
    expect(bodies.at(-1).music.position).toBe(action === "seek" ? 154 : 0);
    expect(bodies.at(-1).music.duration).toBe(action === "seek" ? 158 : 238);
    expect(bodies.at(-1).music.trackId).toBe(
      action === "seek" ? "track-a" : "track-b",
    );
  },
);
