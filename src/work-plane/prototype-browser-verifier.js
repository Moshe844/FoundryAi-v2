import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
  Object.freeze({ name: "tablet", width: 768, height: 1024 }),
  Object.freeze({ name: "desktop", width: 1280, height: 900 }),
]);

function fail(message) {
  throw new TypeError(`Prototype browser verifier: ${message}`);
}

function chromeCandidates() {
  return [
    process.env.FOUNDRY_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
}

export function resolveCertifiedPrototypeBrowser() {
  return chromeCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

function cdpProcess({ executablePath, timeoutMs }) {
  const profile = mkdtempSync(join(tmpdir(), "foundry-prototype-browser-"));
  const child = spawn(executablePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-extensions",
    "--disable-features=MediaRouter,OptimizationHints,Translate",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-proxy-server",
    "--password-store=basic",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
  const input = child.stdio[3];
  const output = child.stdio[4];
  if (input === null || output === null) fail("Chrome debugging pipes were not created.");
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  let stderr = "";
  const pending = new Map();
  const listeners = new Set();
  const deadline = setTimeout(() => child.kill(), timeoutMs);
  deadline.unref?.();

  function dispatch(message) {
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (request !== undefined) {
        pending.delete(message.id);
        if (message.error !== undefined) request.reject(new Error(message.error.message));
        else request.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of listeners) listener(message);
  }
  output.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const boundary = buffer.indexOf(0);
      if (boundary < 0) break;
      const raw = buffer.subarray(0, boundary).toString("utf8");
      buffer = buffer.subarray(boundary + 1);
      if (raw !== "") {
        try { dispatch(JSON.parse(raw)); } catch { /* Chrome may emit a partial diagnostic; stderr owns diagnostics. */ }
      }
    }
  });
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 16_384) stderr += chunk.toString("utf8").slice(0, 16_384 - stderr.length);
  });
  child.once("exit", (code) => {
    for (const request of pending.values()) {
      request.reject(new Error(`Chrome exited before verification completed (${code}): ${stderr.slice(-500)}`));
    }
    pending.clear();
  });

  function send(method, params = {}, sessionId = undefined) {
    const id = nextId++;
    const message = sessionId === undefined
      ? { id, method, params }
      : { id, method, params, sessionId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome command ${method} timed out.`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, {
        resolve(value) { clearTimeout(timer); resolve(value); },
        reject(error) { clearTimeout(timer); reject(error); },
      });
      input.write(`${JSON.stringify(message)}\0`);
    });
  }

  function waitFor(method, sessionId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`Chrome event ${method} timed out.`));
      }, timeoutMs);
      timer.unref?.();
      function listener(message) {
        if (message.method === method && message.sessionId === sessionId) {
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(message.params ?? {});
        }
      }
      listeners.add(listener);
    });
  }

  async function close() {
    clearTimeout(deadline);
    try { await send("Browser.close"); } catch { child.kill(); }
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 2_000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      }
    });
    rmSync(profile, { recursive: true, force: true });
  }

  return { send, waitFor, listeners, close };
}

const MEASURE_EXPRESSION = `(() => {
  const visible = (element) => { const style = getComputedStyle(element); const box = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
  const nodes = [...document.querySelectorAll('header,nav,main,section,article,aside,form,table,footer,[role="main"],[role="navigation"]')].filter(visible).slice(0, 80);
  const manifest = nodes.map((element, index) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return { index, tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), id: element.id || null, x: box.x, y: box.y, width: box.width, height: box.height, display: style.display, position: style.position, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, backgroundColor: style.backgroundColor, color: style.color }; });
  const focusable = document.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
  focusable?.focus();
  return {
    readyState: document.readyState,
    title: document.title,
    language: document.documentElement.lang,
    hasMain: Boolean(document.querySelector('main,[role="main"]')),
    headingCount: document.querySelectorAll('h1,h2,h3').length,
    semanticSurfaceCount: manifest.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    activeElement: document.activeElement?.tagName ?? null,
    focusableCount: document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])').length,
    missingImageAltCount: [...document.images].filter((image) => !image.hasAttribute('alt')).length,
    manifest,
  };
})()`;

export function createChromePrototypeBrowserVerifier({
  executablePath = resolveCertifiedPrototypeBrowser(),
  timeoutMs = 20_000,
  viewports = DEFAULT_VIEWPORTS,
} = {}) {
  if (typeof executablePath !== "string" || !existsSync(executablePath)) {
    fail("a certified Chrome or Edge executable is required.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    fail("timeoutMs must be between 1000 and 120000.");
  }

  async function verify({ previewUrl, expectedRoutes }) {
    const protocol = cdpProcess({ executablePath, timeoutMs });
    try {
      const { targetId } = await protocol.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await protocol.send("Target.attachToTarget", { targetId, flatten: true });
      await Promise.all([
        protocol.send("Page.enable", {}, sessionId),
        protocol.send("Runtime.enable", {}, sessionId),
        protocol.send("Log.enable", {}, sessionId),
        protocol.send("Network.enable", {}, sessionId),
      ]);
      const browserErrors = [];
      const externalRequests = [];
      const listener = (message) => {
        if (message.sessionId !== sessionId) return;
        if (message.method === "Runtime.exceptionThrown") {
          browserErrors.push(message.params?.exceptionDetails?.text ?? "Uncaught browser exception");
        }
        if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
          browserErrors.push(message.params.entry.text ?? "Browser log error");
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
          browserErrors.push("console.error");
        }
        if (message.method === "Network.requestWillBeSent") {
          try {
            const target = new URL(message.params.request.url);
            if (target.hostname !== "127.0.0.1" && target.protocol !== "data:") {
              externalRequests.push(target.href);
            }
          } catch { externalRequests.push(String(message.params?.request?.url ?? "invalid request")); }
        }
      };
      protocol.listeners.add(listener);
      const results = [];
      const screenshots = {};
      for (const route of expectedRoutes) {
        const routeUrl = new URL(route.replace(/^\/+/, ""), previewUrl).href;
        for (const viewport of viewports) {
          const errorsBefore = browserErrors.length;
          const requestsBefore = externalRequests.length;
          await protocol.send("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.name === "mobile",
          }, sessionId);
          const loaded = protocol.waitFor("Page.loadEventFired", sessionId);
          const navigation = await protocol.send("Page.navigate", { url: routeUrl }, sessionId);
          if (navigation.errorText) fail(`navigation failed: ${navigation.errorText}`);
          await loaded;
          await protocol.send("Runtime.evaluate", {
            expression: "new Promise((resolve) => setTimeout(resolve, 120))",
            awaitPromise: true,
            returnByValue: true,
          }, sessionId);
          const measured = await protocol.send("Runtime.evaluate", {
            expression: MEASURE_EXPRESSION,
            returnByValue: true,
          }, sessionId);
          if (measured.exceptionDetails !== undefined) fail("browser measurement threw an exception.");
          const screenshot = await protocol.send("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: false,
          }, sessionId);
          const routeName = route === "/" ? "root" : route.replace(/^\/+|\/+$/gu, "").replace(/[^A-Za-z0-9_-]+/gu, "-");
          const screenshotName = `${routeName}-${viewport.name}.png`;
          screenshots[screenshotName] = Buffer.from(screenshot.data, "base64");
          results.push({
            route,
            viewport: { ...viewport },
            measurement: measured.result?.value ?? null,
            browserErrors: browserErrors.slice(errorsBefore),
            externalRequests: externalRequests.slice(requestsBefore),
            screenshotName,
          });
        }
      }
      protocol.listeners.delete(listener);
      return Object.freeze({ results: Object.freeze(results), screenshots: Object.freeze(screenshots) });
    } finally {
      await protocol.close();
    }
  }

  return Object.freeze({ verify, executablePath, viewports });
}

