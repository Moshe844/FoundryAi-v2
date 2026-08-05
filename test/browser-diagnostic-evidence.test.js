import assert from "node:assert/strict";
import test from "node:test";

import { parseBrowserResult } from "../src/domain/runtime-preview.js";

test("browser observations retain deterministic scalar diagnostics", () => {
  const parsed = parseBrowserResult(
    `FOUNDRY_BROWSER_RESULT:${JSON.stringify({
      captureProbeErrors: [],
      checks: { "obligation-visual": true },
      diagnostics: {
        "obligation-visual": {
          paletteMatches: true,
          heroFontSize: 76.8,
          backgroundColor: "rgb(17, 17, 17)",
          optionalMeasurement: null,
        },
      },
      consoleErrors: [],
      pageErrors: [],
    })}`,
  );

  assert.deepEqual(parsed.diagnostics["obligation-visual"], {
    backgroundColor: "rgb(17, 17, 17)",
    heroFontSize: 76.8,
    optionalMeasurement: null,
    paletteMatches: true,
  });
});

test("browser observations reject structured diagnostic values", () => {
  for (const invalid of [[], {}]) {
    assert.throws(
      () =>
        parseBrowserResult(
          `FOUNDRY_BROWSER_RESULT:${JSON.stringify({
            captureProbeErrors: [],
            checks: { "obligation-visual": true },
            diagnostics: { "obligation-visual": { invalid } },
            consoleErrors: [],
            pageErrors: [],
          })}`,
        ),
      /malformed checks or errors/u,
    );
  }
});
