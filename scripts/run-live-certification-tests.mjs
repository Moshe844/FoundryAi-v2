import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [
    "--test",
    "--test-concurrency=1",
    "test/milestone-8.test.js",
    "test/milestone-9.test.js",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FOUNDRY_RUN_LIVE_CERTIFICATION: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal !== null) {
    console.error(`Live certification terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
