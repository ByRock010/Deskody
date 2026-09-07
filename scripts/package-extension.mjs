import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = [
  "background.js",
  "media-target.js",
  "heartbeat.js",
  "music.js",
  "music-page.js",
  "options.html",
  "options.css",
  "options.js",
];
const manifest = JSON.parse(
  await readFile("browser-extension/manifest.json", "utf8"),
);
for (const browser of ["chromium", "firefox"]) {
  const destination = resolve("dist-extensions", browser);
  await mkdir(destination, { recursive: true });
  await Promise.all(
    files.map((file) =>
      copyFile(resolve("browser-extension", file), resolve(destination, file)),
    ),
  );
  const config = structuredClone(manifest);
  if (browser === "firefox") {
    config.background = { scripts: ["background.js"], type: "module" };
    config.browser_specific_settings = {
      gecko: { id: "bridge@musicoptimizer.dev", strict_min_version: "128.0" },
    };
  }
  await writeFile(
    resolve(destination, "manifest.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
  console.log(`${browser}: ${destination}`);
}
