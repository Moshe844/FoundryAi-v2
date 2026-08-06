import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ExecutionValidationError } from "../domain/errors.js";
import { WorkUnitStatus } from "../domain/execution.js";

const SENSITIVE_ENVIRONMENT_NAME =
  /(?:PASSWORD|PASSWD|SECRET|TOKEN|AUTHORIZATION|API_?KEY|COOKIE|PRIVATE_?KEY)/iu;
const ALLOWED_INPUT_ENVIRONMENT_NAMES = new Set([
  "FOUNDRY_TEST_VALUE",
  "FOUNDRY_PREVIEW_URL",
  "FOUNDRY_RUNTIME_ACCESS_VALUE",
  "NEXT_TELEMETRY_DISABLED",
]);

export function resolveControlledExecutable(declaredExecutable) {
  if (declaredExecutable === "node") {
    return process.execPath;
  }
  if (declaredExecutable === "npm") {
    return process.platform === "win32" ? process.execPath : "npm";
  }
  throw new ExecutionValidationError(
    `Declared executable "${declaredExecutable}" has no controlled resolver.`,
  );
}

export function controlledProcedureArguments(procedure) {
  if (procedure.executable === "npm" && process.platform === "win32") {
    const npmCli =
      typeof process.env.npm_execpath === "string"
        ? process.env.npm_execpath
        : resolve(
            dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
          );
    if (!existsSync(npmCli)) {
      throw new ExecutionValidationError(
        "The controlled npm CLI entrypoint is unavailable.",
      );
    }
    return [npmCli, ...procedure.arguments];
  }
  if (
    procedure.executable === "npm" &&
    typeof process.env.npm_execpath === "string"
  ) {
    return [process.env.npm_execpath, ...procedure.arguments];
  }
  return [...procedure.arguments];
}

export function createSafeCommandEnvironment(input = {}) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new ExecutionValidationError(
      "Command environment must be a plain object.",
    );
  }
  const baseNames =
    process.platform === "win32"
      ? [
          "APPDATA",
          "ComSpec",
          "LOCALAPPDATA",
          "PATH",
          "PATHEXT",
          "SystemRoot",
          "TEMP",
          "TMP",
          "USERPROFILE",
          "WINDIR",
        ]
      : ["HOME", "LANG", "PATH", "TMPDIR"];
  const environment = {};
  for (const name of baseNames) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  for (const [name, value] of Object.entries(input)) {
    if (
      !ALLOWED_INPUT_ENVIRONMENT_NAMES.has(name) ||
      SENSITIVE_ENVIRONMENT_NAME.test(name)
    ) {
      throw new ExecutionValidationError(
        `Environment variable "${name}" is not allowlisted.`,
      );
    }
    if (typeof value !== "string") {
      throw new ExecutionValidationError(
        `Environment variable "${name}" must have a string value.`,
      );
    }
    environment[name] = value;
  }
  return {
    environment,
    names: Object.keys(environment).sort(),
    sensitiveValues: Object.values(input),
  };
}

export function terminateProcessTree(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync(
        "taskkill.exe",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
          windowsHide: true,
          timeout: 5_000,
        },
      );
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

// taskkill /T returns once it has signalled the tree, not once the tree is
// gone. A worker that is still exiting keeps its file handles, so anything that
// renames or deletes the working directory next must wait for the processes
// themselves to disappear rather than for the signal to be delivered.
export async function awaitProcessTreeExit(
  pid,
  { timeoutMs = 10_000, pollIntervalMs = 100 } = {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!processTreeAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function processTreeAlive(pid) {
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const listed = execFileSync(
      "tasklist.exe",
      ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
      { encoding: "utf8", windowsHide: true, timeout: 5_000 },
    );
    return listed.includes(`"${pid}"`);
  } catch {
    // Unable to ask; treat as gone rather than blocking the pipeline on an
    // inspection failure. The retrying rename below is the real safeguard.
    return false;
  }
}

function appendBounded(state, chunk, outputLimitBytes) {
  const bytes = Buffer.from(chunk);
  const remaining = Math.max(0, outputLimitBytes - state.size);
  if (remaining > 0) {
    state.chunks.push(bytes.subarray(0, remaining));
    state.size += Math.min(remaining, bytes.length);
  }
  return bytes.length > remaining;
}

export async function runControlledCommand({
  procedure,
  workingDirectory,
  environment,
  timeoutMs = 30_000,
  outputLimitBytes = 16_384,
  cancellationSignal = null,
  clock,
}) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 600_000
  ) {
    throw new ExecutionValidationError(
      "Command timeoutMs must be an integer from 10 through 600000.",
    );
  }
  if (
    !Number.isSafeInteger(outputLimitBytes) ||
    outputLimitBytes < 1 ||
    outputLimitBytes > 1_048_576
  ) {
    throw new ExecutionValidationError(
      "Command outputLimitBytes must be an integer from 1 through 1048576.",
    );
  }
  if (
    cancellationSignal !== null &&
    (typeof cancellationSignal !== "object" ||
      typeof cancellationSignal.aborted !== "boolean" ||
      typeof cancellationSignal.addEventListener !== "function")
  ) {
    throw new ExecutionValidationError(
      "cancellationSignal must be null or an AbortSignal.",
    );
  }
  const resolvedExecutable = resolveControlledExecutable(
    procedure.executable,
  );
  const resolvedArguments = controlledProcedureArguments(procedure);
  const filtered = createSafeCommandEnvironment(environment);
  const startTimestamp = clock();
  if (cancellationSignal?.aborted) {
    return {
      declaredExecutable: procedure.executable,
      resolvedExecutable,
      arguments: [...resolvedArguments],
      workingDirectory,
      environmentVariableNames: filtered.names,
      sensitiveValues: filtered.sensitiveValues,
      startTimestamp,
      endTimestamp: clock(),
      exitCode: -1,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: true,
      processId: null,
      outputLimitExceeded: false,
      status: WorkUnitStatus.CANCELLED,
    };
  }

  return new Promise((resolve) => {
    const stdout = { chunks: [], size: 0 };
    const stderr = { chunks: [], size: 0 };
    let timedOut = false;
    let cancelled = false;
    let outputLimitExceeded = false;
    let terminationReason = null;
    let spawnError = null;
    let finished = false;
    const child = spawn(resolvedExecutable, resolvedArguments, {
      cwd: workingDirectory,
      env: filtered.environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const processId = child.pid ?? null;

    function terminate() {
      terminateProcessTree(child);
    }

    child.stdout.on("data", (chunk) => {
      if (appendBounded(stdout, chunk, outputLimitBytes)) {
        if (terminationReason === null) {
          outputLimitExceeded = true;
          terminationReason = "output-limit";
          terminate();
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      if (appendBounded(stderr, chunk, outputLimitBytes)) {
        if (terminationReason === null) {
          outputLimitExceeded = true;
          terminationReason = "output-limit";
          terminate();
        }
      }
    });
    child.on("error", (error) => {
      spawnError = error;
    });

    const timeout = setTimeout(() => {
      if (terminationReason === null) {
        timedOut = true;
        terminationReason = "timeout";
        terminate();
      }
    }, timeoutMs);
    const onAbort = () => {
      if (terminationReason === null) {
        cancelled = true;
        terminationReason = "cancelled";
        terminate();
      }
    };
    cancellationSignal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      cancellationSignal?.removeEventListener("abort", onAbort);
      const exitCode = Number.isSafeInteger(code) ? code : -1;
      let status = WorkUnitStatus.SUCCEEDED;
      if (terminationReason === "cancelled") {
        status = WorkUnitStatus.CANCELLED;
      } else if (terminationReason === "output-limit") {
        status = WorkUnitStatus.OUTPUT_LIMIT_EXCEEDED;
      } else if (terminationReason === "timeout") {
        status = WorkUnitStatus.TIMED_OUT;
      } else if (spawnError !== null || exitCode !== 0) {
        status = WorkUnitStatus.FAILED;
      }
      resolve({
        declaredExecutable: procedure.executable,
        resolvedExecutable,
        arguments: [...resolvedArguments],
        workingDirectory,
        environmentVariableNames: filtered.names,
        sensitiveValues: filtered.sensitiveValues,
        startTimestamp,
        endTimestamp: clock(),
        exitCode,
        stdout: Buffer.concat(stdout.chunks).toString("utf8"),
        stderr:
          Buffer.concat(stderr.chunks).toString("utf8") +
          (spawnError === null ? "" : spawnError.message),
        timedOut,
        cancelled,
        processId,
        outputLimitExceeded,
        status,
      });
    });
  });
}
