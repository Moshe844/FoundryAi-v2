import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(webRoot, "../..");
const children = [
  spawn(
    process.execPath,
    [
      "--use-system-ca",
      resolve(webRoot, "local-api/server.mjs"),
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    },
  ),
  spawn(
    process.execPath,
    [resolve(webRoot, "node_modules/vinext/dist/cli.js"), "dev"],
    {
      cwd: webRoot,
      stdio: "inherit",
      windowsHide: true,
    },
  ),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code;
}

for (const child of children) {
  child.once("exit", (code) => {
    if (!stopping && code !== 0) stop(code ?? 1);
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
