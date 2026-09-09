import { readFileSync } from "node:fs";
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
import { test, expect } from "@playwright/test";

test("create, persist and delete a context rule through the interface", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Web önizlemesi ·")).toBeVisible();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Yeni kural", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kural adı").fill("Araştırma");
  await dialog.getByLabel("Şu bağlamda").selectOption("domain");
  await dialog.getByLabel("Eşleşme", { exact: true }).fill("example.com");
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await expect(
    page.getByRole("button", { name: "Araştırma düzenle" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Araştırma düzenle" }).click();
  await dialog.getByRole("button", { name: "Sil", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await expect(
    page.getByRole("button", { name: "Araştırma düzenle" }),
  ).toHaveCount(0);
});

test("playlist remains editable with another source and persists on Apply", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByRole("button", { name: "Diğer oynatıcılar" }).click();
  await page
    .getByLabel("Kontrol edilecek oynatıcı")
    .selectOption("browser:music.youtube.com");
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Ders çalışma düzenle" }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Müzik bağlantısı", { exact: false });
  await expect(input).toBeEditable();
  await input.fill(
    "https://open.spotify.com/playlist/1234567890123456789012?si=test",
  );
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Değişiklikleri kaydet" }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Ders çalışma düzenle" }).click();
  await expect(input).toHaveValue(
    "https://open.spotify.com/playlist/1234567890123456789012?si=test",
  );
  await expect(
    dialog.getByText("YouTube Music şarkı, liste, radyo", { exact: false }),
  ).toBeVisible();
});

test("failed save keeps the edited rule open for retry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Yeni bir bağlam ekle" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kural adı").fill("Kaybolmamalı");
  await dialog.getByText("Listede olmayan bir uygulama ekle").click();
  await dialog.getByLabel("Uygulama adı veya kimliği").fill("Code");
  await dialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Disk dolu");
    };
  });
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Kural adı")).toHaveValue("Kaybolmamalı");
  await expect(dialog.getByRole("alert")).toContainText("kaydedilemedi");
});

test("Spotify shared track link saves and survives reopening the rule", async ({
  page,
}) => {
  const link =
    "https://open.spotify.com/track/4LhgwcTWwJQc6DFTkLXVEc?si=074c6afa0721455b";
  await page.goto("/");
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Ders çalışma düzenle" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Müzik bağlantısı", { exact: false }).fill(link);
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Ders çalışma düzenle" }).click();
  await expect(
    dialog.getByLabel("Müzik bağlantısı", { exact: false }),
  ).toHaveValue(link);
});

test("escape closes modal and preview never pretends to control the OS", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("switch", { name: "Otomasyonu etkinleştir" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Yeni bir bağlam ekle" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await expect(page.getByRole("button", { name: "İzin ver" })).toBeDisabled();
});

test("responsive dashboard has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Odağın burada." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});

test("desktop dashboard renders without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Odağın burada." }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Deskody");
  await expect(page.locator(".brand")).toHaveText("Deskody");
  await expect(page.locator(".version")).toHaveText(`v${version}`);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("the user's YouTube Music watch-plus-playlist link is accepted and persisted", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Ders çalışma düzenle" }).click();
  const dialog = page.getByRole("dialog");
  const url =
    "https://music.youtube.com/watch?v=LkoXilp7FPY&list=PLDRwTTP8arJ9NSwCujKB7dYA_2fVCNnDg";
  await dialog.getByLabel("Müzik bağlantısı", { exact: false }).fill(url);
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await page.getByRole("button", { name: "Ders çalışma düzenle" }).click();
  await expect(
    dialog.getByLabel("Müzik bağlantısı", { exact: false }),
  ).toHaveValue(url);
});

test("search and select multiple installed apps, persist, edit and retain missing apps", async ({
  page,
}) => {
  await page.goto("/");
  // A fixture at the IPC boundary; the web preview never claims to scan installed apps.
  await page.evaluate(async () => {
    const path = "/src/bridge.ts";
    const { api } = await import(path);
    api.applications = async () => [
      { id: "com.microsoft.VSCode", name: "Visual Studio Code", aliases: [] },
      { id: "com.apple.Preview", name: "Preview", aliases: [] },
      { id: "com.microsoft.Word", name: "Microsoft Word", aliases: [] },
    ];
  });
  await page.getByRole("button", { name: "Yeni bir bağlam ekle" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kural adı").fill("Ortak çalışma");
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog.getByRole("alert")).toContainText("uygulama seçin");
  const search = dialog.getByRole("searchbox", { name: "Uygulamalarda ara" });
  await search.fill("code");
  await dialog.getByRole("checkbox", { name: "Visual Studio Code" }).check();
  await search.fill("preview");
  await dialog.getByRole("checkbox", { name: "Preview", exact: true }).check();
  await expect(dialog.getByText("2 seçili", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Visual Studio Code seçimini kaldır" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Müzik bağlantısı", { exact: false })
    .fill("https://music.youtube.com/watch?v=LkoXilp7FPY");
  await page.screenshot({
    path: "test-results/app-picker.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Kurallarım" }).click();
  await expect(
    page.getByText("Visual Studio Code, Preview", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ortak çalışma düzenle" }).click();
  // Discovery unavailable after reload: selected IDs and labels still survive.
  await expect(dialog.getByText("2 seçili", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Preview seçimini kaldır", exact: true })
    .click();
  await expect(dialog.getByText("1 seçili", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Kuralı uygula" }).click();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("deskody-preview-v1")!).rules.find(
      (r: { name: string }) => r.name === "Ortak çalışma",
    ),
  );
  expect(stored.matcher.value.map((a: { id: string }) => a.id)).toEqual([
    "com.microsoft.VSCode",
  ]);
  expect(stored.action.playlist).toContain("LkoXilp7FPY");
});
