import { test, expect, type Page } from "@playwright/test";
import { defaultSettings } from "../src/settings";
import type { Snapshot } from "../src/types";

async function panel(page: Page, count = 4) {
  const settings = defaultSettings();
  settings.enabled = true;
  settings.language = "tr";
  settings.rules = Array.from({ length: count }, (_, index) => ({
    ...settings.rules[index % settings.rules.length],
    id: `rule-${index}`,
    name: index === 0 ? "Kodlama" : `Kural ${index}`,
  }));
  const snapshot: Snapshot = {
    settings,
    status: {
      enabled: true,
      context: {
        app: "Visual Studio Code",
        appId: "com.microsoft.VSCode",
        title: "",
        url: null,
        document: null,
        isBrowser: false,
        otherAudio: false,
        source: "native",
      },
      player: {
        id: "browser:music.youtube.com",
        name: "YouTube Music",
        playing: true,
        volume: 0.5,
        track: "A Walk Through the Quiet City",
        artist: "Sunday Study Sessions",
        canPlay: true,
        canPause: true,
        canOpenUri: true,
        trackId: "track-a", duration: 180, position: 30, sampledAt: Date.now()/1000,
        canSeek: true, canNext: true, canPrevious: true,
        artwork: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDYsAAAAASUVORK5CYII=",
      },
      decision: "Kodlama",
      activeRule: "rule-0",
      error: null,
      manualOverride: false,
      bridgeConnected: true,
      activity: [],
    },
    permissions: {
      accessibility: true,
      automation: "",
      platform: "macOS",
      capabilities: [],
    },
    players: [],
  };
  await page.addInitScript((snapshot) => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Set<number>();
    let id = 0;
    const state = {
      snapshot,
      calls: [] as { cmd: string; args: any }[],
      fail: false,
    };
    const publish = () =>
      listeners.forEach((id) =>
        callbacks.get(id)?.({
          event: "deskody://status",
          id,
          payload: structuredClone(state.snapshot),
        }),
      );
    Object.assign(window, {
      isTauri: true,
      trayTest: { ...state, publish },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        transformCallback: (fn: (event: unknown) => void) => {
          callbacks.set(++id, fn);
          return id;
        },
        invoke: async (cmd: string, args: any) => {
          if (cmd === "plugin:event|listen") {
            listeners.add(args.handler);
            return args.handler;
          }
          if (cmd === "plugin:event|unlisten") {
            listeners.delete(args.eventId);
            return;
          }
          if (cmd === "get_snapshot") return structuredClone(state.snapshot);
          state.calls.push({ cmd, args });
          if (cmd === "quick_change") {
            if ((window as any).trayTest.fail)
              throw new Error("Ayarlar kaydedilemedi: disk dolu");
            const change = args.change;
            if (change.kind === "enabled")
              snapshot.settings.enabled = change.enabled;
            else
              snapshot.settings.rules.find(
                (rule) => rule.id === change.id,
              )!.enabled = change.enabled;
            publish();
            return structuredClone(snapshot.settings);
          }
          if (cmd === "media_transport") {
            if ((window as any).trayTest.fail) throw new Error("Oynatıcı medya komutunu reddetti");
            const action = args.request.action;
            if (action.kind === "seek") snapshot.status.player!.position = action.position;
            else snapshot.status.player!.trackId = "track-b";
            publish();
          }
          if (cmd === "media_action") {
            snapshot.status.manualOverride = args.action === "pause";
            snapshot.status.player!.playing = args.action !== "pause";
            publish();
          }
        },
      },
    });
  }, snapshot);
  await page.setViewportSize({ width: 380, height: 580 });
  await page.goto("/?panel=tray");
  await expect(
    page.getByRole("switch", { name: "Akış kontrolü", exact: true }),
  ).toBeChecked();
}

test("quick switches persist through IPC; pause and resume work without opening main", async ({
  page,
}) => {
  await panel(page);
  await expect(page.getByText("A Walk Through the Quiet City")).toBeVisible();
  await page.getByRole("switch", { name: "Kodlama kuralı" }).click();
  await expect(
    page.getByRole("switch", { name: "Kodlama kuralı" }),
  ).not.toBeChecked();
  await page
    .getByRole("switch", { name: "Akış kontrolü", exact: true })
    .click();
  await expect(page.getByText("Müziğin kontrolü sende")).toBeVisible();
  await page
    .getByRole("switch", { name: "Akış kontrolü", exact: true })
    .click();
  await page.getByRole("button", { name: "Müziği duraklat" }).click();
  await page
    .getByRole("button", { name: "Elle duraklatıldı · Otomasyona dön" })
    .click();
  const commands = await page.evaluate(() => (window as any).trayTest.calls);
  expect(
    commands
      .filter((c: any) => c.cmd === "quick_change")
      .map((c: any) => c.args.change),
  ).toEqual([
    { kind: "rule", id: "rule-0", enabled: false },
    { kind: "enabled", enabled: false },
    { kind: "enabled", enabled: true },
  ]);
  expect(commands.some((c: any) => c.cmd === "open_main")).toBe(false);
  await page.getByRole("button", { name: "Deskody’yi aç" }).click();
  expect(
    await page.evaluate(() => (window as any).trayTest.calls.at(-1).cmd),
  ).toBe("open_main");
});

test("failed quick save retains switch and renders actionable error; Escape dismisses", async ({
  page,
}) => {
  await panel(page);
  await page.evaluate(() => {
    (window as any).trayTest.fail = true;
  });
  await page.getByRole("switch", { name: "Kodlama kuralı" }).click();
  await expect(page.getByRole("alert")).toContainText("disk dolu");
  await expect(
    page.getByRole("switch", { name: "Kodlama kuralı" }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => (window as any).trayTest.calls.at(-1).cmd),
  ).toBe("close_panel");
});

test("many rules scroll inside panel; main app button stays available and snapshot changes sync", async ({
  page,
}) => {
  await panel(page, 100);
  await expect(
    page.getByRole("button", { name: "Deskody’yi aç" }),
  ).toBeInViewport();
  const last = page.getByRole("switch", { name: "Kural 99 kuralı" });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Deskody’yi aç" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).trayTest;
    state.snapshot.settings.rules[99].enabled = false;
    state.publish();
  });
  await expect(last).not.toBeChecked();
});

test("panel renders at actual window dimensions and preview controls stay disabled", async ({
  page,
}) => {
  await panel(page);
  await page.screenshot({ path: "test-results/tray-panel.png" });
  const preview = await page
    .context()
    .browser()!
    .newPage({ viewport: { width: 380, height: 580 } });
  await preview.goto("http://127.0.0.1:1420/?panel=tray");
  await expect(
    preview.getByRole("switch", { name: "Flow control", exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Open Deskody" }),
  ).toBeDisabled();
  await preview.close();
});

test("language change from the main window updates the open panel without changing rule names", async ({
  page,
}) => {
  await panel(page);
  await page.evaluate(() => {
    const state = (window as any).trayTest;
    state.snapshot.settings.language = "en";
    state.publish();
  });
  await expect(
    page.getByRole("switch", { name: "Flow control", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Kodlama rule" }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Open Deskody" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});


test("artwork, targeted previous/next and keyboard seeking work without opening another app", async ({page}) => {
  await panel(page);
  await expect(page.getByRole("img", {name: "Albüm kapağı"})).toBeVisible();
  await page.getByRole("button", {name: "Sonraki parça"}).click();
  await page.getByRole("button", {name: "Önceki parça"}).click();
  const seek = page.getByRole("slider", {name: "Oynatma konumu"});
  await seek.focus();
  await seek.press("ArrowRight");
  const calls = await page.evaluate(() => (window as any).trayTest.calls.filter((c:any) => c.cmd === "media_transport"));
  expect(calls.map((c:any)=>c.args.request.action.kind)).toEqual(["next","previous","seek"]);
  expect(calls.every((c:any)=>c.args.request.playerId === "browser:music.youtube.com")).toBe(true);
  expect(calls[2].args.request.action.trackId).toBe("track-b");
  expect(calls[2].args.request.action.position).toBeGreaterThan(30);
  await page.screenshot({ path: "test-results/media-tray.png" });
  await page.evaluate(() => {
    const state = (window as any).trayTest;
    state.snapshot.status.player.canSeek = false;
    state.snapshot.status.player.canNext = false;
    state.snapshot.status.player.duration = null;
    state.publish();
  });
  await expect(seek).toBeDisabled();
  await expect(page.getByRole("button", {name: "Sonraki parça"})).toBeDisabled();
  await page.evaluate(() => { (window as any).trayTest.fail = true; });
  await page.getByRole("button", {name: "Önceki parça"}).click();
  await expect(page.getByRole("alert")).toContainText("reddetti");
  expect(await page.evaluate(() => (window as any).trayTest.calls.some((c:any)=>c.cmd === "open_main"))).toBe(false);
});

test("main player cancels a seek when the track changes during the gesture", async ({page}) => {
  await panel(page);
  await page.setViewportSize({width: 1280, height: 860});
  await page.goto("/");
  await expect(page.getByRole("img", {name: "Albüm kapağı"})).toBeVisible();
  const seek = page.getByRole("slider", {name: "Oynatma konumu"});
  await expect(seek).toBeEnabled();
  const box = (await seek.boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    const state = (window as any).trayTest;
    state.snapshot.status.player.trackId = "new-track";
    state.snapshot.status.player.track = "New track during seek";
    state.snapshot.status.player.position = 0;
    state.publish();
  });
  await expect(page.getByText("New track during seek")).toBeVisible();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height / 2);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).trayTest.calls.filter((c:any) => c.cmd === "media_transport"))).toHaveLength(0);
  await page.getByRole("button", {name: "Müziği duraklat", exact: true}).click();
  await expect(page.getByRole("button", {name: "Müziği çal", exact: true})).toBeVisible();
  await seek.focus();
  await seek.press("ArrowRight");
  expect(await page.evaluate(() => (window as any).trayTest.calls.filter((c:any) => c.cmd === "media_transport")[0].args.request.action.trackId)).toBe("new-track");
  await expect(page.getByRole("button", {name: "Müziği çal", exact: true})).toBeVisible();
  await page.screenshot({path: "test-results/media-main.png"});
});
