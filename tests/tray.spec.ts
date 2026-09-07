import { test, expect, type Page } from "@playwright/test";
import { defaultSettings } from "../src/settings";
import type { Snapshot } from "../src/types";

async function panel(page: Page, count = 4) {
  const settings = defaultSettings();
  settings.enabled = true;
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
    preview.getByRole("switch", { name: "Akış kontrolü", exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Deskody’yi aç" }),
  ).toBeDisabled();
  await preview.close();
});
