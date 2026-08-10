/**
 * Visual Intelligence Scan — Electron main-process bridge.
 *
 * Design goals:
 *  - Front-most transparent overlay on EVERY display
 *  - Never opaque / never hides other apps (macOS "apps vanished" bug)
 *  - Content-protected so screencapture / desktopCapturer omit it
 *  - Lightweight: synthetic UI contours first paint; no desktopCapturer during start
 *    (desktopCapturer on macOS can hitch Screen Recording and blank frames)
 *  - Optional native macOS binary when present
 */
import { BrowserWindow, screen, systemPreferences } from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCAN_DURATION_MS = 1600;
const START_BUDGET_MS = 28;

const here = path.dirname(fileURLToPath(import.meta.url));

export class VisualScanManager {
  /**
   * @param {{ projectRoot?: string }} [options]
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || path.resolve(here, "..");
    this.quality = "high";
    this.active = false;
    this.overlayWindows = [];
    this.nativeChild = null;
    this.stopTimer = null;
  }

  isAvailable() {
    return true;
  }

  permissionState() {
    if (process.platform === "darwin") {
      const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      let screenCapture = false;
      try {
        screenCapture = systemPreferences.getMediaAccessStatus("screen") === "granted";
      } catch {
        screenCapture = true;
      }
      let mode = "minimalWave";
      if (accessibility) mode = "fullAX";
      else if (screenCapture) mode = "windowOnly";
      return {
        ok: true,
        platform: "darwin",
        accessibility,
        screenCapture,
        mode,
        nativeBinary: existsSync(this.#nativeBinaryPath()),
      };
    }
    return {
      ok: true,
      platform: process.platform,
      accessibility: false,
      screenCapture: true,
      mode: "electronFallback",
      nativeBinary: false,
    };
  }

  setQuality(quality = "high") {
    const normalized = String(quality || "high").toLowerCase();
    this.quality = ["low", "medium", "high"].includes(normalized) ? normalized : "high";
    return { ok: true, quality: this.quality };
  }

  getOverlayWindows() {
    return this.overlayWindows.filter((win) => win && !win.isDestroyed());
  }

  /**
   * Fire-and-forget scan. Returns within ~30ms; animation continues in background.
   * @param {{ displayId?: number, quality?: string, preferNative?: boolean }} [options]
   */
  async start(options = {}) {
    if (this.active) return { ok: true, alreadyRunning: true };
    this.active = true;
    const quality = options.quality || this.quality;
    const started = Date.now();
    const preferNative =
      options.preferNative !== false &&
      process.platform === "darwin" &&
      existsSync(this.#nativeBinaryPath());

    const run = async () => {
      try {
        if (preferNative) {
          try {
            await this.#startNative({ quality, displayId: options.displayId });
            return;
          } catch (error) {
            console.warn(
              "[visual-scan] native start failed; using Electron overlay:",
              error instanceof Error ? error.message : error,
            );
          }
        }
        await this.#startElectronOverlay({ displayId: options.displayId, quality });
      } catch (error) {
        this.active = false;
        console.warn("[visual-scan] start failed:", error instanceof Error ? error.message : error);
      }
    };

    void run();

    const elapsed = Date.now() - started;
    if (elapsed < START_BUDGET_MS) {
      await new Promise((resolve) => setTimeout(resolve, START_BUDGET_MS - elapsed));
    }

    return {
      ok: true,
      backend: preferNative ? "native" : "electron",
      startedMs: Date.now() - started,
    };
  }

  async stop() {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.nativeChild && !this.nativeChild.killed) {
      try {
        this.nativeChild.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      this.nativeChild = null;
    }
    for (const win of this.overlayWindows) {
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } catch {
        /* ignore */
      }
    }
    this.overlayWindows = [];
    this.active = false;
    return { ok: true };
  }

  #nativeBinaryPath() {
    const candidates = [
      path.join(this.projectRoot, "native", "visual-scan", ".build", "release", "visual-scan"),
      path.join(this.projectRoot, "native", "visual-scan", ".build", "debug", "visual-scan"),
      path.join(process.resourcesPath || "", "native", "visual-scan", "visual-scan"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
  }

  async #startNative({ quality, displayId }) {
    const scene = await this.#buildSceneFast({ displayId, quality });
    const binary = this.#nativeBinaryPath();
    const child = spawn(binary, ["start", "--quality", quality], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: false,
    });
    this.nativeChild = child;
    child.stdin.write(JSON.stringify(scene));
    child.stdin.end();

    const budget = Math.max(0, START_BUDGET_MS - 5);
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, budget)),
      new Promise((resolve) => child.once("spawn", resolve)),
    ]);

    child.on("exit", () => {
      if (this.nativeChild === child) this.nativeChild = null;
      this.active = false;
    });

    this.stopTimer = setTimeout(() => {
      void this.stop();
    }, SCAN_DURATION_MS + 400);
  }

  async #startElectronOverlay({ displayId, quality }) {
    const targets =
      displayId != null
        ? [this.#targetDisplay(displayId)]
        : screen.getAllDisplays();

    // Build one lightweight scene per display — never call desktopCapturer here.
    const scenes = await Promise.all(
      targets.map((display) => this.#buildSceneFast({ displayId: display.id, quality })),
    );

    const overlayPath = path.join(here, "visual-scan-overlay.html");

    for (const scene of scenes) {
      const sceneParam = encodeURIComponent(JSON.stringify(scene));
      const url = `${pathToFileURL(overlayPath).href}?scene=${sceneParam}`;
      const display = scene.display;

      /** @type {Electron.BrowserWindowConstructorOptions} */
      const opts = {
        x: Math.round(display.x),
        y: Math.round(display.y),
        width: Math.round(display.width),
        height: Math.round(display.height),
        frame: false,
        transparent: true,
        // Critical on macOS: without an explicit clear color the fullscreen
        // overlay paints opaque black and appears to "hide all apps".
        backgroundColor: "#00000000",
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        show: false,
        fullscreenable: false,
        thickFrame: false,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
          offscreen: false,
        },
      };
      // Non-activating panel on macOS — never steals focus / Spaces.
      if (process.platform === "darwin") {
        opts.type = "panel";
      }

      const win = new BrowserWindow(opts);

      try {
        win.setBackgroundColor("#00000000");
      } catch {
        /* ignore */
      }
      try {
        win.setOpacity(1);
      } catch {
        /* ignore */
      }
      win.setIgnoreMouseEvents(true, { forward: true });
      try {
        win.setAlwaysOnTop(true, "screen-saver", 1);
      } catch {
        try {
          win.setAlwaysOnTop(true, "pop-up-menu", 1);
        } catch {
          win.setAlwaysOnTop(true);
        }
      }
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch {
        /* ignore */
      }
      // Invisible to screencapture / Zoom / desktopCapturer — user still sees it.
      try {
        win.setContentProtection(true);
      } catch {
        /* Linux may no-op */
      }

      this.overlayWindows.push(win);

      const loadPromise = win.loadURL(url);
      await Promise.race([
        loadPromise.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 70)),
      ]);
      if (!win.isDestroyed()) {
        // showInactive: never activate / never hide other apps via focus steal.
        win.showInactive();
        try {
          win.setAlwaysOnTop(true, "screen-saver", 1);
          win.moveTop();
        } catch {
          /* ignore */
        }
      }

      win.on("closed", () => {
        this.overlayWindows = this.overlayWindows.filter((w) => w !== win);
        if (!this.overlayWindows.length && !this.nativeChild) this.active = false;
      });
    }

    this.stopTimer = setTimeout(() => {
      void this.stop();
    }, SCAN_DURATION_MS + 220);
  }

  /**
   * Fast scene: synthetic detailed UI regions (+ optional Linux xdotool).
   * Intentionally avoids desktopCapturer.getSources — that API on macOS can
   * hitch Screen Recording, flash permission UI, and contribute to "blank"
   * captures when paired with a fullscreen overlay.
   */
  async #buildSceneFast({ displayId, quality = "high" }) {
    const cap = quality === "low" ? 40 : quality === "medium" ? 64 : 88;
    const target = this.#targetDisplay(displayId);
    const reduceMotion = this.#prefersReducedMotion();
    let contours = [...this.#syntheticWindowLayout(target.bounds)];

    if (process.platform === "linux") {
      try {
        const linuxWindows = await Promise.race([
          this.#linuxWindowGeometry(),
          new Promise((resolve) => setTimeout(() => resolve([]), 120)),
        ]);
        for (const match of linuxWindows.slice(0, Math.min(28, cap))) {
          contours.push({
            x: match.x,
            y: match.y,
            width: match.width,
            height: match.height,
            importance:
              match.width * match.height > target.bounds.width * target.bounds.height * 0.2
                ? 1
                : 0.7,
            hierarchyDepth: 0,
          });
        }
      } catch {
        /* keep synthetic */
      }
    }

    contours = this.#filterContours(contours, target.bounds, cap);

    return {
      display: {
        x: target.bounds.x,
        y: target.bounds.y,
        width: target.bounds.width,
        height: target.bounds.height,
        scaleFactor: target.scaleFactor || 1,
      },
      contours,
      quality,
      reduceMotion,
      permissionMode: this.permissionState().mode,
    };
  }

  #targetDisplay(displayId) {
    const displays = screen.getAllDisplays();
    if (displayId != null) {
      const match = displays.find((d) => d.id === displayId);
      if (match) return match;
    }
    return screen.getPrimaryDisplay();
  }

  #prefersReducedMotion() {
    return false;
  }

  /** Nested UI-structure regions that read as a real interface scan. */
  #syntheticWindowLayout(bounds) {
    const gx = bounds.x;
    const gy = bounds.y;
    const w = bounds.width;
    const h = bounds.height;
    const regions = [
      // Primary app windows
      { x: gx + w * 0.05, y: gy + h * 0.06, width: w * 0.46, height: h * 0.62, importance: 1, hierarchyDepth: 0 },
      { x: gx + w * 0.52, y: gy + h * 0.1, width: w * 0.43, height: h * 0.66, importance: 1, hierarchyDepth: 0 },
      // Title / toolbar strips
      { x: gx + w * 0.05, y: gy + h * 0.06, width: w * 0.46, height: h * 0.055, importance: 0.75, hierarchyDepth: 1 },
      { x: gx + w * 0.52, y: gy + h * 0.1, width: w * 0.43, height: h * 0.05, importance: 0.75, hierarchyDepth: 1 },
      // Side nav / sidebar
      { x: gx + w * 0.05, y: gy + h * 0.13, width: w * 0.11, height: h * 0.5, importance: 0.7, hierarchyDepth: 1 },
      // Content panels
      { x: gx + w * 0.18, y: gy + h * 0.14, width: w * 0.31, height: h * 0.22, importance: 0.65, hierarchyDepth: 2 },
      { x: gx + w * 0.18, y: gy + h * 0.38, width: w * 0.31, height: h * 0.26, importance: 0.65, hierarchyDepth: 2 },
      { x: gx + w * 0.55, y: gy + h * 0.18, width: w * 0.37, height: h * 0.12, importance: 0.55, hierarchyDepth: 2 },
      { x: gx + w * 0.55, y: gy + h * 0.33, width: w * 0.18, height: h * 0.2, importance: 0.5, hierarchyDepth: 2 },
      { x: gx + w * 0.75, y: gy + h * 0.33, width: w * 0.17, height: h * 0.2, importance: 0.5, hierarchyDepth: 2 },
      // Rows / list items
      { x: gx + w * 0.2, y: gy + h * 0.17, width: w * 0.26, height: h * 0.035, importance: 0.35, hierarchyDepth: 3 },
      { x: gx + w * 0.2, y: gy + h * 0.22, width: w * 0.22, height: h * 0.035, importance: 0.35, hierarchyDepth: 3 },
      { x: gx + w * 0.2, y: gy + h * 0.41, width: w * 0.27, height: h * 0.032, importance: 0.32, hierarchyDepth: 3 },
      { x: gx + w * 0.2, y: gy + h * 0.46, width: w * 0.24, height: h * 0.032, importance: 0.32, hierarchyDepth: 3 },
      { x: gx + w * 0.57, y: gy + h * 0.21, width: w * 0.2, height: h * 0.03, importance: 0.32, hierarchyDepth: 3 },
      // Dock / taskbar strip + floating chrome
      { x: gx + w * 0.22, y: gy + h * 0.92, width: w * 0.56, height: h * 0.05, importance: 0.55, hierarchyDepth: 0 },
      { x: gx + w * 0.08, y: gy + h * 0.72, width: w * 0.38, height: h * 0.16, importance: 0.6, hierarchyDepth: 1 },
      { x: gx + w * 0.54, y: gy + h * 0.78, width: w * 0.34, height: h * 0.1, importance: 0.45, hierarchyDepth: 1 },
      // Buttons / chips
      { x: gx + w * 0.58, y: gy + h * 0.56, width: w * 0.1, height: h * 0.04, importance: 0.28, hierarchyDepth: 3 },
      { x: gx + w * 0.7, y: gy + h * 0.56, width: w * 0.1, height: h * 0.04, importance: 0.28, hierarchyDepth: 3 },
      { x: gx + w * 0.82, y: gy + h * 0.56, width: w * 0.08, height: h * 0.04, importance: 0.28, hierarchyDepth: 3 },
    ];
    return regions;
  }

  #filterContours(contours, bounds, cap) {
    const minArea = Math.max(400, bounds.width * bounds.height * 0.00008);
    const seen = [];
    const out = [];
    const sorted = contours
      .filter((r) => r.width >= 16 && r.height >= 10 && r.width * r.height >= minArea)
      .sort(
        (a, b) =>
          (b.importance || 0) - (a.importance || 0) || b.width * b.height - a.width * a.height,
      );

    for (const rect of sorted) {
      const duplicate = seen.some((other) => this.#iou(rect, other) > 0.92);
      if (duplicate) continue;
      seen.push(rect);
      out.push(rect);
      if (out.length >= cap) break;
    }
    return out;
  }

  #iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.width * a.height + b.width * b.height - inter;
    return union <= 0 ? 0 : inter / union;
  }

  async #linuxWindowGeometry() {
    const display = process.env.DISPLAY || ":0";
    const env = { ...process.env, DISPLAY: display };
    try {
      const { stdout } = await execFileAsync("xdotool", ["search", "--onlyvisible", "--name", "."], {
        timeout: 400,
        env,
        encoding: "utf8",
      }).catch(() => ({ stdout: "" }));
      const ids = String(stdout || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 18);
      const windows = [];
      for (const id of ids) {
        try {
          const { stdout: geom } = await execFileAsync("xdotool", ["getwindowgeometry", "--shell", id], {
            timeout: 300,
            env,
            encoding: "utf8",
          });
          const vals = Object.fromEntries(
            String(geom || "")
              .trim()
              .split("\n")
              .map((line) => line.split("="))
              .filter((p) => p.length === 2),
          );
          const title = await execFileAsync("xdotool", ["getwindowname", id], {
            timeout: 300,
            env,
            encoding: "utf8",
          })
            .then((r) => String(r.stdout || "").trim())
            .catch(() => "");
          if (/clyra|opencluely|visual scan/i.test(title)) continue;
          windows.push({
            id,
            title,
            x: Number(vals.X) || 0,
            y: Number(vals.Y) || 0,
            width: Number(vals.WIDTH) || 0,
            height: Number(vals.HEIGHT) || 0,
          });
        } catch {
          /* skip */
        }
      }
      return windows.filter((w) => w.width >= 160 && w.height >= 90);
    } catch {
      return [];
    }
  }
}

let singleton = null;

/**
 * @param {{ projectRoot?: string }} [options]
 */
export function getVisualScanManager(options = {}) {
  if (!singleton) singleton = new VisualScanManager(options);
  return singleton;
}

export function fireVisualScan(options = {}) {
  const manager = getVisualScanManager(options);
  void manager.start(options);
  return { ok: true };
}
