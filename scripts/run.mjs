import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
const env = { ...process.env };
const paths = [join(homedir(), ".cargo", "bin")];
const toolchains = join(homedir(), ".rustup", "toolchains");
if (existsSync(toolchains)) {
  for (const name of readdirSync(toolchains).filter((n) =>
    n.startsWith("stable-"),
  ))
    paths.push(join(toolchains, name, "bin"));
}
env.PATH = [...paths, env.PATH].join(delimiter);
// A project-local dependency cache is optional; normal machines use their Cargo home.
if (!env.CARGO_HOME && existsSync(resolve(".tools/cargo/registry")))
  env.CARGO_HOME = resolve(".tools/cargo");
if (
  process.platform === "darwin" &&
  !env.DEVELOPER_DIR &&
  existsSync("/Library/Developer/CommandLineTools/usr/bin/clang")
)
  env.DEVELOPER_DIR = "/Library/Developer/CommandLineTools";
// Invoke the JS entry point with the current Node executable. Going through
// tauri.cmd + shell on Windows double-quotes Node and breaks installer builds.
const binary = command === "tauri" ? process.execPath : command;
const childArgs =
  command === "tauri"
    ? [resolve("node_modules/@tauri-apps/cli/tauri.js"), ...args]
    : args;
const child = spawn(binary, childArgs, {
  stdio: "inherit",
  env,
  shell: false,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
