import { test, expect } from "@playwright/test";

test("fresh installation is English; language changes immediately and survives reopening", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your focus starts here." }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("App language").selectOption("tr");
  await expect(
    page.getByRole("button", { name: "Ayarlar", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Odağın burada." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByLabel("Uygulama dili").selectOption("en");
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your focus starts here." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/english-dashboard.png",
    fullPage: true,
  });
});

test("language saves independently from unfinished settings and failed persistence is visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const fade = page.locator('input[type="range"]').last();
  await fade.fill("2300");
  await page.getByLabel("App language").selectOption("tr");
  await expect(fade).toHaveValue("2300");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("deskody-preview-v1")!),
  );
  expect(saved.language).toBe("tr");
  expect(saved.fadeMs).toBe(600);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Disk full");
    };
  });
  await page.getByLabel("Uygulama dili").selectOption("en");
  await expect(page.getByRole("alert")).toContainText("Disk full");
  await expect(page.getByLabel("Uygulama dili")).toHaveValue("tr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("legacy settings without a language use English and preserve custom rule names", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "deskody-preview-v1",
      JSON.stringify({
        rules: [
          {
            id: "custom",
            name: "Ayarlar",
            enabled: true,
            priority: 50,
            matcher: { kind: "app", value: "Code" },
            action: { kind: "play", playlist: null },
          },
        ],
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^My rules/ }).click();
  await expect(
    page.getByRole("button", { name: "Edit Ayarlar" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("notch preference saves independently of draft playback settings and survives restart", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const notch = page.getByRole("switch", {
    name: "Deskody Notch",
    exact: true,
  });
  await expect(notch).toBeChecked();
  const fade = page.locator('input[type="range"]').last();
  await fade.fill("2200");
  await notch.click();
  await expect(notch).not.toBeChecked();
  await expect(fade).toHaveValue("2200");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("deskody-preview-v1")!),
  );
  expect(saved.notchEnabled).toBe(false);
  expect(saved.fadeMs).toBe(600);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(notch).not.toBeChecked();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Disk full");
    };
  });
  await notch.click();
  await expect(page.getByRole("alert")).toContainText("Disk full");
  await expect(notch).not.toBeChecked();
});

test("collapsed now-playing preference is independent, persists, and preserves dirty fields", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", {
    name: "Show now playing when collapsed",
    exact: true,
  });
  const notch = page.getByRole("switch", {
    name: "Deskody Notch",
    exact: true,
  });
  const fade = page.locator('input[type="range"]').last();
  await expect(toggle).toBeChecked();
  await fade.fill("2100");
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(notch).toBeChecked();
  await expect(fade).toHaveValue("2100");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("deskody-preview-v1")!),
  );
  expect(saved.notchNowPlaying).toBe(false);
  expect(saved.notchEnabled).toBe(true);
  expect(saved.fadeMs).toBe(600);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await notch.click();
  await expect(toggle).toBeDisabled();
  await notch.click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await page.getByLabel("App language").selectOption("tr");
  const translated = page.getByRole("switch", {
    name: "Kapalı notch’ta çalan müziği göster",
    exact: true,
  });
  await expect(translated).not.toBeChecked();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Disk full");
    };
  });
  await translated.click();
  await expect(page.getByRole("alert")).toContainText("Disk full");
  await expect(translated).not.toBeChecked();
});
