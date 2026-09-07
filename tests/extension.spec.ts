import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("paired extension reports sanitized URLs to the loopback bridge", async () => {
  test.setTimeout(150000);
  const bodies: {
    url: string | null;
    authorization: string;
    host: string;
    acknowledged?: string;
    musicPlaying?: boolean;
    commandError?: string;
    musicTransition?: boolean;
    musicVolume?: number;
  }[] = [];
  let command: {
    id: string;
    action: string;
    volume: number | null;
    url?: string;
    fadeMs?: number;
    pause?: boolean;
  } | null = null;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        bodies.push({
          ...JSON.parse(body),
          authorization: request.headers.authorization,
          host: request.headers.host,
        });
      } catch {
        /* ignore non-JSON probes */
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(command));
    });
  });
  await new Promise<void>((ok, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ok);
  });
  const port = (server.address() as AddressInfo).port;
  const profile = await mkdtemp(join(tmpdir(), "music-optimizer-extension-"));
  // Isolate the fixture endpoint so a running desktop app keeps its real bridge.
  const extension = join(profile, "extension");
  await cp(resolve("browser-extension"), extension, { recursive: true });
  for (const file of ["background.js", "manifest.json"]) {
    const path = join(extension, file);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replaceAll(
        "127.0.0.1:43827",
        `127.0.0.1:${port}`,
      ),
    );
  }
  const context = await chromium.launchPersistentContext(
    join(profile, "user-data"),
    {
      channel: "chromium",
      headless: true,
      // Playwright mutes headless Chromium by default, hiding audible-output regressions.
      ignoreDefaultArgs: ["--mute-audio"],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).hostname;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.getByLabel("Eşleştirme anahtarı").fill("a".repeat(64));
    await page.getByRole("button", { name: "Bağlantıyı kaydet" }).click();
    await page.goto("http://127.0.0.1:1420/?private=secret#sensitive");
    await expect
      .poll(() => bodies.some((b) => b.url === "http://127.0.0.1:1420/"), {
        timeout: 15000,
      })
      .toBe(true);
    expect(bodies.every((b) => !b.url?.includes("secret"))).toBe(true);
    expect(
      bodies.every(
        (b) =>
          b.authorization === `Bearer ${"a".repeat(64)}` &&
          b.host === `127.0.0.1:${port}`,
      ),
    ).toBe(true);
    // Exercise actual media APIs on a local, intercepted page matching the YTM content script.
    const wav = Buffer.alloc(44 + 8000 * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    // Non-silent audio is essential: a zero-filled WAV cannot catch a muted output path.
    for (let sample = 0; sample < 8000; sample++)
      wav.writeInt16LE(
        Math.round(Math.sin((2 * Math.PI * 440 * sample) / 8000) * 8000),
        44 + sample * 2,
      );
    let navigations = 0;
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.dismiss();
    });
    await page.route("https://music.youtube.com/**", (route) => {
      if (route.request().isNavigationRequest()) navigations++;
      return route.fulfill({
        contentType: "text/html",
        body: `<title>Test music</title><ytmusic-app><div id="links"></div></ytmusic-app><video id="empty-preview"></video><div id="movie_player"><audio loop src="data:audio/wav;base64,${wav.toString("base64")}"></audio></div><button onclick="document.querySelector('audio').play()">Start</button>
        <script>
          window.documentIdentity = crypto.randomUUID();
          window.beforeUnloadCount = 0;
          window.routeCalls = 0;
          window.currentVideoId = 'aaaaaaaaaaa';
          window.metadataMode = 'response';
          window.normalizeUrl = true;
          window.replaceMedia = false;
          window.autoplayRoute = false;
          window.lastEndpoint = null;
          window.addEventListener('beforeunload', (event) => { window.beforeUnloadCount++; event.preventDefault(); event.returnValue = ''; });
          document.querySelector('#movie_player').getVideoData = () => { throw new Error('Not available in this player version'); };
          document.querySelector('#movie_player').getPlayerResponse = () => window.metadataMode === 'response' ? ({videoDetails: {videoId: window.currentVideoId}}) : null;
          document.querySelector('#movie_player').getVolume = () => document.querySelector('audio').volume * 100;
          document.querySelector('#movie_player').setVolume = (v) => { document.querySelector('audio').volume = v / 100; };
          document.querySelector('#movie_player').isMuted = () => document.querySelector('audio').muted;
          document.querySelector('#movie_player').mute = () => { document.querySelector('audio').muted = true; };
          document.querySelector('#movie_player').unMute = () => { document.querySelector('audio').muted = false; };
          document.querySelector('ytmusic-app').addEventListener('yt-navigate', (event) => {
            window.routeCalls++;
            const endpoint = event.detail.endpoint;
            window.lastEndpoint = endpoint;
            const target = new URL(endpoint.commandMetadata.webCommandMetadata.url, location.href);
            let audio = document.querySelector('audio');
            audio.pause();
            if (window.replaceMedia) {
              const replacement = audio.cloneNode(true);
              audio.replaceWith(replacement);
              audio = replacement;
            }
            const address = new URL(target);
            if (window.normalizeUrl && target.pathname === '/watch') address.searchParams.delete('list');
            history.pushState({}, '', address);
            if (window.metadataMode === 'load') audio.load();
            if (window.autoplayRoute) audio.play();
            window.currentVideoId = null;
            document.querySelector('#links').replaceChildren();
            if (target.pathname === '/playlist' && target.searchParams.get('list') !== 'PLblocked') {
              const link = document.createElement('a');
              link.href = '/watch?v=LkoXilp7FPY&list=' + target.searchParams.get('list');
              link.textContent = 'First song';
              document.querySelector('#links').append(link);
            }
            setTimeout(() => { window.currentVideoId = endpoint.watchEndpoint?.videoId || null; }, 150);
          });
        </script>`,
      });
    });
    await page.goto("https://music.youtube.com/");
    await page.getByRole("button", { name: "Start" }).click();
    await expect
      .poll(() => bodies.some((b) => b.musicPlaying === true))
      .toBe(true);
    command = { id: "pause-test", action: "pause", volume: null };
    await expect
      .poll(() =>
        bodies.some((b) => b.acknowledged === "pause-test" && !b.commandError),
      )
      .toBe(true);
    expect(
      await page
        .locator("audio")
        .evaluate((element: HTMLAudioElement) => element.paused),
    ).toBe(true);
    command = { id: "volume-test", action: "volume", volume: 0.2 };
    await expect
      .poll(() =>
        bodies.some((b) => b.acknowledged === "volume-test" && !b.commandError),
      )
      .toBe(true);
    expect(
      await page
        .locator("audio")
        .evaluate((element: HTMLAudioElement) => element.volume),
    ).toBeCloseTo(0.2);
    command = { id: "play-test", action: "play", volume: null };
    await expect
      .poll(() =>
        bodies.some((b) => b.acknowledged === "play-test" && !b.commandError),
      )
      .toBe(true);
    expect(
      await page
        .locator("audio")
        .evaluate((element: HTMLAudioElement) => element.paused),
    ).toBe(false);

    const documentIdentity = await page.evaluate(
      () =>
        (window as unknown as { documentIdentity: string }).documentIdentity,
    );
    const initialNavigations = navigations;
    const focusPage = await context.newPage();
    await focusPage.goto("http://127.0.0.1:1420/");
    await focusPage.bringToFront();
    for (const [index, target] of [
      "https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg",
      "https://music.youtube.com/playlist?list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg",
      "https://music.youtube.com/watch?v=LkoXilp7FPY&list=RDAMVMLkoXilp7FPY&start_radio=1",
      "https://music.youtube.com/watch?v=LkoXilp7FPY&list=RDCLAK5uy_mix-example",
      "https://music.youtube.com/watch?v=LkoXilp7FPY",
    ].entries()) {
      command = {
        id: `open-${index}`,
        action: "transition",
        url: target,
        volume: 0.2,
        fadeMs: 600,
        pause: false,
      };
      await expect
        .poll(() => bodies.find((b) => b.acknowledged === `open-${index}`), {
          timeout: 18000,
        })
        .toBeTruthy();
      const ack = bodies.find((b) => b.acknowledged === `open-${index}`);
      expect(ack?.commandError).toBeFalsy();
      await expect
        .poll(() =>
          page.locator("audio").evaluate((e: HTMLAudioElement) => !e.paused),
        )
        .toBe(true);
      const opened = new URL(page.url());
      expect(opened.searchParams.get("v")).toBe("LkoXilp7FPY");
      // The real player may canonicalize away list IDs. Check the dispatched endpoint,
      // not equality between the requested URL and the address bar.
      expect(opened.searchParams.has("list")).toBe(false);
      const endpoint = await page.evaluate(
        () =>
          (
            window as unknown as {
              lastEndpoint: {
                watchEndpoint: { playlistId?: string; startRadio?: boolean };
              };
            }
          ).lastEndpoint,
      );
      expect(endpoint.watchEndpoint.playlistId ?? null).toBe(
        new URL(target).searchParams.get("list"),
      );
      expect(endpoint.watchEndpoint.startRadio ?? false).toBe(
        new URL(target).searchParams.get("start_radio") === "1",
      );
      const count = navigations;
      const routeCalls = await page.evaluate(
        () => (window as unknown as { routeCalls: number }).routeCalls,
      );
      expect(count).toBe(initialNavigations);
      expect(dialogs).toEqual([]);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { documentIdentity: string })
              .documentIdentity,
        ),
      ).toBe(documentIdentity);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { beforeUnloadCount: number })
              .beforeUnloadCount,
        ),
      ).toBe(0);
      // Repeated delivery/heartbeats must not restart the queue.
      await expect
        .poll(
          () => bodies.filter((b) => b.acknowledged === `open-${index}`).length,
        )
        .toBeGreaterThan(1);
      expect(navigations).toBe(count);
      expect(
        await page.evaluate(
          () => (window as unknown as { routeCalls: number }).routeCalls,
        ),
      ).toBe(routeCalls);
      expect(await focusPage.evaluate(() => document.visibilityState)).toBe(
        "visible",
      );
      expect(
        await page.locator("audio").evaluate((e: HTMLAudioElement) => e.volume),
      ).toBeCloseTo(0.2);
    }
    expect(bodies.some((b) => b.musicTransition)).toBe(true);
    // Sustain playback beyond the old 13-second deadline; no delayed cleanup pause/mute.
    const sustainedStart = Date.now();
    await expect
      .poll(
        async () => {
          const state = await page
            .locator("audio")
            .evaluate((e: HTMLAudioElement) => ({
              playing: !e.paused,
              volume: e.volume,
              muted: e.muted,
            }));
          expect(state.playing).toBe(true);
          expect(state.volume).toBeCloseTo(0.2);
          expect(state.muted).toBe(false);
          return Date.now() - sustainedStart;
        },
        { timeout: 20000, intervals: [1000] },
      )
      .toBeGreaterThan(16000);

    const audibleTabs = await worker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(q: object): Promise<
                {
                  url?: string;
                  audible?: boolean;
                  mutedInfo?: { muted: boolean };
                }[]
              >;
            };
          };
        }
      ).chrome;
      return api.tabs.query({});
    });
    const audibleMusic = audibleTabs.find((t) =>
      t.url?.startsWith("https://music.youtube.com/"),
    );
    expect(audibleMusic?.audible).toBe(true);
    expect(audibleMusic?.mutedInfo?.muted).toBe(false);
    // No video metadata: require new media/load evidence plus advancing playback.
    await page.evaluate(() => {
      Object.assign(window, { metadataMode: "load", replaceMedia: true });
    });
    command = {
      id: "replaced-media",
      action: "transition",
      url: "https://music.youtube.com/watch?v=bbbbbbbbbbb",
      volume: 0.2,
      fadeMs: 600,
    };
    await expect
      .poll(() => bodies.find((b) => b.acknowledged === "replaced-media"), {
        timeout: 16000,
      })
      .toBeTruthy();
    expect(
      bodies.find((b) => b.acknowledged === "replaced-media")?.commandError,
    ).toBeFalsy();
    expect(
      await page.locator("audio").evaluate((e: HTMLAudioElement) => e.volume),
    ).toBeCloseTo(0.2);
    expect(
      await page
        .locator("#empty-preview")
        .evaluate((e: HTMLVideoElement) => e.paused),
    ).toBe(true);

    // Player already running but identity cannot be verified: timeout restores volume,
    // reports diagnostics and must NEVER send a cleanup pause.
    await page.evaluate(() => {
      Object.assign(window, {
        metadataMode: "absent",
        replaceMedia: false,
        autoplayRoute: true,
      });
    });
    command = {
      id: "unconfirmed-playing",
      action: "transition",
      url: "https://music.youtube.com/watch?v=ccccccccccc",
      volume: 0.2,
      fadeMs: 600,
    };
    await expect
      .poll(
        () => bodies.find((b) => b.acknowledged === "unconfirmed-playing"),
        { timeout: 16000 },
      )
      .toBeTruthy();
    expect(
      bodies.find((b) => b.acknowledged === "unconfirmed-playing")
        ?.commandError,
    ).toContain("parça kimliği");
    expect(
      await page.locator("audio").evaluate((e: HTMLAudioElement) => ({
        playing: !e.paused,
        volume: e.volume,
        muted: e.muted,
      })),
    ).toEqual({ playing: true, volume: 0.2, muted: false });
    await page.evaluate(() =>
      Object.assign(window, { metadataMode: "response", autoplayRoute: false }),
    );

    // Explicit interrupt restores user volume while leaving playback paused.
    command = {
      id: "fade-pause",
      action: "transition",
      volume: 0.2,
      fadeMs: 600,
      pause: true,
    };
    await expect
      .poll(() =>
        bodies.find((b) => b.acknowledged === "fade-pause" && !b.commandError),
      )
      .toBeTruthy();
    expect(
      await page.locator("audio").evaluate((e: HTMLAudioElement) => ({
        paused: e.paused,
        volume: e.volume,
      })),
    ).toEqual({ paused: true, volume: 0.2 });
    // Preserve a user's mute separately from their nonzero volume; never remember mute as zero.
    await page.locator("audio").evaluate((e: HTMLAudioElement) => {
      e.muted = true;
    });
    command = {
      id: "muted-resume",
      action: "transition",
      volume: 0,
      fadeMs: 600,
    };
    await expect
      .poll(() =>
        bodies.find(
          (b) => b.acknowledged === "muted-resume" && !b.commandError,
        ),
      )
      .toBeTruthy();
    expect(
      await page.locator("audio").evaluate((e: HTMLAudioElement) => ({
        paused: e.paused,
        volume: e.volume,
        muted: e.muted,
      })),
    ).toEqual({ paused: false, volume: 0.2, muted: true });
    await page.locator("audio").evaluate((e: HTMLAudioElement) => {
      e.muted = false;
    });
    const before = navigations;
    command = {
      id: "reject-url",
      action: "open",
      url: "https://music.youtube.com.evil.test/watch?v=LkoXilp7FPY",
      volume: null,
    };
    await expect
      .poll(
        () => bodies.find((b) => b.acknowledged === "reject-url")?.commandError,
      )
      .toBeTruthy();
    expect(navigations).toBe(before);
    command = {
      id: "cancel-open",
      action: "transition",
      fadeMs: 600,
      url: "https://music.youtube.com/playlist?list=PLblocked",
      volume: null,
    };
    await expect.poll(() => page.url()).toContain("PLblocked");
    command = null; // The Rust bridge clears the lease on cancellation.
    await expect
      .poll(
        () =>
          bodies.find((b) => b.acknowledged === "cancel-open")?.commandError,
      )
      .toBeTruthy();
    await expect
      .poll(() =>
        page.locator("audio").evaluate((e: HTMLAudioElement) => e.paused),
      )
      .toBe(true);
    expect(
      await page.locator("audio").evaluate((e: HTMLAudioElement) => e.volume),
    ).toBeCloseTo(0.2);
    const musicTabs = await worker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(
                query: object,
              ): Promise<{ url?: string; mutedInfo?: { muted: boolean } }[]>;
            };
          };
        }
      ).chrome;
      return api.tabs.query({});
    });
    expect(
      musicTabs.find((t) => t.url?.includes("PLblocked"))?.mutedInfo?.muted,
    ).toBe(false);
    // If the site's router disappears, fail visibly. Never fall back to hard navigation.
    await page.evaluate(() => document.querySelector("ytmusic-app")?.remove());
    command = {
      id: "missing-router",
      action: "open",
      url: "https://music.youtube.com/watch?v=LkoXilp7FPY",
      volume: null,
    };
    await expect
      .poll(
        () =>
          bodies.find((b) => b.acknowledged === "missing-router")?.commandError,
      )
      .toContain("yönlendirmesi");
    expect(navigations).toBe(initialNavigations);
    expect(dialogs).toEqual([]);
    expect(await focusPage.evaluate(() => document.visibilityState)).toBe(
      "visible",
    );
    // Positive control: this same document really does block hard reloads.
    // The listener dismisses the dialog so the fixture remains intact.
    await page.evaluate(() => setTimeout(() => location.reload(), 0));
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  } finally {
    await context.close();
    await new Promise<void>((ok) => server.close(() => ok()));
    await rm(profile, { recursive: true, force: true });
  }
});
