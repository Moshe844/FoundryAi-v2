export interface PrototypeViewport {
  readonly name: "mobile" | "tablet" | "desktop" | string;
  readonly width: number;
  readonly height: number;
}

export interface PrototypeBrowserObservation {
  readonly route: string;
  readonly viewport: PrototypeViewport;
  readonly measurement: Readonly<Record<string, unknown>> | null;
  readonly browserErrors: readonly string[];
  readonly externalRequests: readonly string[];
  readonly screenshotName: string;
}

export function resolveCertifiedPrototypeBrowser(): string | null;
export function createChromePrototypeBrowserVerifier(input?: {
  executablePath?: string | null;
  timeoutMs?: number;
  viewports?: readonly PrototypeViewport[];
}): {
  readonly executablePath: string;
  readonly viewports: readonly PrototypeViewport[];
  verify(input: { previewUrl: string; expectedRoutes: readonly string[] }): Promise<{
    results: readonly PrototypeBrowserObservation[];
    screenshots: Readonly<Record<string, Buffer>>;
  }>;
};
