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
